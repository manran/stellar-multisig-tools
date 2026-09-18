import type { Pool } from 'pg';
import { coordinationPool } from '../db/postgres.js';
import {
  claimIntegrationOutboxEvent,
  markIntegrationOutboxPublished,
  releaseIntegrationOutboxEvent,
  type IntegrationOutboxRecord,
} from '../db/postgresIntegrationOutboxDispatch.js';
import {
  completeIntegrationWebhookDelivery,
  startIntegrationWebhookDelivery,
} from '../db/postgresIntegrationWebhookDeliveryHistory.js';
import type { IntegrationCredentialStore } from './integrationCredentialStore.js';
import {
  classifyIntegrationWebhookHttpStatus,
  classifyIntegrationWebhookTransportFailure,
} from './integrationWebhookDeliveryPolicy.js';
import type { IntegrationWebhookHttpTransport } from './integrationWebhookHttpTransport.js';
import { signIntegrationWebhookPayload } from './integrationWebhookSigning.js';

export type IntegrationWebhookDispatchResult =
  | { status: 'not_claimed' }
  | { status: 'skipped'; reason: 'service_unavailable' | 'webhook_disabled' }
  | { status: 'delivered'; httpStatus: number }
  | { status: 'retry_scheduled'; errorCode: string; nextAvailableAt: string }
  | { status: 'permanent_failure'; errorCode: string; httpStatus?: number }
  | { status: 'lease_lost' };

export interface IntegrationWebhookPayloadBuilder {
  build(record: IntegrationOutboxRecord): Promise<unknown>;
}

async function completeTerminal(
  eventId: string,
  leaseToken: string,
  pool: Pool,
): Promise<boolean> {
  return markIntegrationOutboxPublished(eventId, leaseToken, { pool });
}

export async function dispatchIntegrationWebhookEvent(
  eventId: string,
  dependencies: {
    credentials: IntegrationCredentialStore;
    transport: IntegrationWebhookHttpTransport;
    payloadBuilder: IntegrationWebhookPayloadBuilder;
    pool?: Pool;
    now?: () => Date;
    webhookMasterSecret?: string;
    timeoutMs?: number;
  },
): Promise<IntegrationWebhookDispatchResult> {
  const pool = dependencies.pool ?? coordinationPool();
  const now = dependencies.now ?? (() => new Date());
  const claimed = await claimIntegrationOutboxEvent(eventId, {
    pool,
    now: now(),
  });
  if (!claimed) return { status: 'not_claimed' };

  const { record, leaseToken } = claimed;
  let stored;
  try {
    stored = await dependencies.credentials.getCredential(record.serviceId);
  } catch {
    const outcome = classifyIntegrationWebhookTransportFailure(
      'credential_store_unavailable',
      record.attemptCount,
      now(),
    );
    if (outcome.outcome === 'retry') {
      const released = await releaseIntegrationOutboxEvent(eventId, leaseToken, {
        pool,
        nextAvailableAt: outcome.nextAvailableAt,
      });
      return released
        ? {
            status: 'retry_scheduled',
            errorCode: outcome.errorCode,
            nextAvailableAt: outcome.nextAvailableAt.toISOString(),
          }
        : { status: 'lease_lost' };
    }
    return await completeTerminal(eventId, leaseToken, pool)
      ? { status: 'permanent_failure', errorCode: outcome.errorCode }
      : { status: 'lease_lost' };
  }

  if (!stored || !stored.enabled) {
    return await completeTerminal(eventId, leaseToken, pool)
      ? { status: 'skipped', reason: 'service_unavailable' }
      : { status: 'lease_lost' };
  }
  if (!stored.webhook?.enabled) {
    return await completeTerminal(eventId, leaseToken, pool)
      ? { status: 'skipped', reason: 'webhook_disabled' }
      : { status: 'lease_lost' };
  }

  const startedAt = now();
  const delivery = await startIntegrationWebhookDelivery({
    eventId,
    serviceId: record.serviceId,
    attempt: record.attemptCount,
    endpointUrl: stored.webhook.url,
    startedAt,
  }, pool);

  let payload: unknown;
  try {
    payload = await dependencies.payloadBuilder.build(record);
  } catch {
    const outcome = classifyIntegrationWebhookTransportFailure(
      'projection_error',
      record.attemptCount,
      now(),
    );
    const completedAt = now();
    await completeIntegrationWebhookDelivery(delivery.deliveryId, {
      outcome: outcome.outcome === 'retry' ? 'retry' : 'permanent_failure',
      completedAt,
      errorCode: outcome.errorCode,
      durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    }, pool);
    if (outcome.outcome === 'retry') {
      const released = await releaseIntegrationOutboxEvent(eventId, leaseToken, {
        pool,
        nextAvailableAt: outcome.nextAvailableAt,
      });
      return released
        ? {
            status: 'retry_scheduled',
            errorCode: outcome.errorCode,
            nextAvailableAt: outcome.nextAvailableAt.toISOString(),
          }
        : { status: 'lease_lost' };
    }
    return await completeTerminal(eventId, leaseToken, pool)
      ? { status: 'permanent_failure', errorCode: outcome.errorCode }
      : { status: 'lease_lost' };
  }

  let signed;
  try {
    signed = signIntegrationWebhookPayload({
      serviceId: record.serviceId,
      secretVersion: stored.webhook.secretVersion,
      eventId: record.eventId,
      timestamp: startedAt,
      payload,
      masterSecret: dependencies.webhookMasterSecret,
    });
  } catch {
    const outcome = classifyIntegrationWebhookTransportFailure(
      'signing_unavailable',
      record.attemptCount,
      now(),
    );
    const completedAt = now();
    await completeIntegrationWebhookDelivery(delivery.deliveryId, {
      outcome: outcome.outcome === 'retry' ? 'retry' : 'permanent_failure',
      completedAt,
      errorCode: outcome.errorCode,
      durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    }, pool);
    if (outcome.outcome === 'retry') {
      const released = await releaseIntegrationOutboxEvent(eventId, leaseToken, {
        pool,
        nextAvailableAt: outcome.nextAvailableAt,
      });
      return released
        ? {
            status: 'retry_scheduled',
            errorCode: outcome.errorCode,
            nextAvailableAt: outcome.nextAvailableAt.toISOString(),
          }
        : { status: 'lease_lost' };
    }
    return await completeTerminal(eventId, leaseToken, pool)
      ? { status: 'permanent_failure', errorCode: outcome.errorCode }
      : { status: 'lease_lost' };
  }

  try {
    const response = await dependencies.transport.post({
      url: stored.webhook.url,
      body: signed.body,
      headers: signed.headers,
      timeoutMs: dependencies.timeoutMs,
    });
    const outcome = classifyIntegrationWebhookHttpStatus(
      response.status,
      record.attemptCount,
      now(),
    );
    const completedAt = now();
    await completeIntegrationWebhookDelivery(delivery.deliveryId, {
      outcome: outcome.outcome,
      completedAt,
      httpStatus: response.status,
      ...(outcome.outcome === 'succeeded' ? {} : { errorCode: outcome.errorCode }),
      durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    }, pool);

    if (outcome.outcome === 'succeeded') {
      return await completeTerminal(eventId, leaseToken, pool)
        ? { status: 'delivered', httpStatus: response.status }
        : { status: 'lease_lost' };
    }
    if (outcome.outcome === 'retry') {
      const released = await releaseIntegrationOutboxEvent(eventId, leaseToken, {
        pool,
        nextAvailableAt: outcome.nextAvailableAt,
      });
      return released
        ? {
            status: 'retry_scheduled',
            errorCode: outcome.errorCode,
            nextAvailableAt: outcome.nextAvailableAt.toISOString(),
          }
        : { status: 'lease_lost' };
    }
    return await completeTerminal(eventId, leaseToken, pool)
      ? {
          status: 'permanent_failure',
          errorCode: outcome.errorCode,
          httpStatus: response.status,
        }
      : { status: 'lease_lost' };
  } catch (cause) {
    const errorCode = cause && typeof cause === 'object' && 'code' in cause
      && typeof cause.code === 'string'
      ? cause.code
      : 'network_error';
    const outcome = classifyIntegrationWebhookTransportFailure(
      errorCode,
      record.attemptCount,
      now(),
    );
    const completedAt = now();
    await completeIntegrationWebhookDelivery(delivery.deliveryId, {
      outcome: outcome.outcome === 'retry' ? 'retry' : 'permanent_failure',
      completedAt,
      errorCode: outcome.errorCode,
      durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    }, pool);

    if (outcome.outcome === 'retry') {
      const released = await releaseIntegrationOutboxEvent(eventId, leaseToken, {
        pool,
        nextAvailableAt: outcome.nextAvailableAt,
      });
      return released
        ? {
            status: 'retry_scheduled',
            errorCode: outcome.errorCode,
            nextAvailableAt: outcome.nextAvailableAt.toISOString(),
          }
        : { status: 'lease_lost' };
    }
    return await completeTerminal(eventId, leaseToken, pool)
      ? { status: 'permanent_failure', errorCode: outcome.errorCode }
      : { status: 'lease_lost' };
  }
}
