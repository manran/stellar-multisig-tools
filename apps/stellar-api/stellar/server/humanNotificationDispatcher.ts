import type { Pool } from 'pg';
import { coordinationPool } from '../db/postgres.js';
import {
  claimHumanNotificationEvent,
  completeHumanNotificationDelivery,
  completeHumanNotificationEvent,
  findSucceededHumanNotificationDelivery,
  releaseHumanNotificationEvent,
  startHumanNotificationDelivery,
} from '../db/postgresHumanNotificationOutbox.js';
import {
  classifyHumanNotificationHttpStatus,
  classifyHumanNotificationTransportFailure,
} from './humanNotificationDeliveryPolicy.js';
import { buildSignatureRequestedEmail } from './humanNotificationEmail.js';
import {
  ResendEmailTransportError,
  sendResendEmail,
  type ResendEmailSendResult,
} from './resendEmailTransport.js';

export type HumanNotificationDispatchResult =
  | { status: 'not_claimed' }
  | { status: 'sent'; providerMessageId: string }
  | { status: 'retry_scheduled'; errorCode: string; nextAvailableAt: string }
  | { status: 'permanent_failure'; errorCode: string; httpStatus?: number }
  | { status: 'lease_lost' };

type SendEmail = (
  input: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
    idempotencyKey: string;
  },
) => Promise<ResendEmailSendResult>;

function requiredConfig(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is not configured.`);
  return normalized;
}

function transportErrorCode(cause: unknown): string {
  if (cause instanceof ResendEmailTransportError) return cause.code;
  if (cause instanceof Error && cause.name === 'TimeoutError') return 'timeout';
  if (cause instanceof Error && cause.name === 'AbortError') return 'timeout';
  return 'network_error';
}

export async function dispatchHumanNotificationEvent(
  eventId: string,
  dependencies: {
    pool?: Pool;
    now?: () => Date;
    from?: string;
    webOrigin?: string;
    sendEmail?: SendEmail;
  } = {},
): Promise<HumanNotificationDispatchResult> {
  const pool = dependencies.pool ?? coordinationPool();
  const now = dependencies.now ?? (() => new Date());
  const claimed = await claimHumanNotificationEvent(eventId, {
    pool,
    now: now(),
  });
  if (!claimed) return { status: 'not_claimed' };

  const { record, leaseToken } = claimed;
  const previousSuccess = await findSucceededHumanNotificationDelivery(eventId, pool);
  if (previousSuccess?.providerMessageId) {
    const completedAt = now();
    const completed = await completeHumanNotificationEvent(eventId, leaseToken, {
      outcome: 'sent',
      completedAt,
      providerMessageId: previousSuccess.providerMessageId,
    }, pool);
    return completed
      ? { status: 'sent', providerMessageId: previousSuccess.providerMessageId }
      : { status: 'lease_lost' };
  }

  const startedAt = now();
  const delivery = await startHumanNotificationDelivery({
    eventId,
    attempt: record.attemptCount,
    startedAt,
  }, pool);

  if (!record.destinationEmail) {
    const completedAt = now();
    await completeHumanNotificationDelivery(delivery.deliveryId, {
      outcome: 'permanent_failure',
      completedAt,
      errorCode: 'destination_email_unavailable',
      durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    }, pool);
    const completed = await completeHumanNotificationEvent(eventId, leaseToken, {
      outcome: 'permanent_failure',
      completedAt,
      errorCode: 'destination_email_unavailable',
    }, pool);
    return completed
      ? { status: 'permanent_failure', errorCode: 'destination_email_unavailable' }
      : { status: 'lease_lost' };
  }

  let from: string;
  let webOrigin: string;
  try {
    from = requiredConfig('MULTISIG_HUMAN_EMAIL_FROM', dependencies.from ?? process.env.MULTISIG_HUMAN_EMAIL_FROM);
    webOrigin = requiredConfig('MULTISIG_HUMAN_WEB_ORIGIN', dependencies.webOrigin ?? process.env.MULTISIG_HUMAN_WEB_ORIGIN);
  } catch {
    const outcome = classifyHumanNotificationTransportFailure(
      'notification_config_unavailable',
      record.attemptCount,
      now(),
    );
    const completedAt = now();
    await completeHumanNotificationDelivery(delivery.deliveryId, {
      outcome: outcome.outcome === 'retry' ? 'retry' : 'permanent_failure',
      completedAt,
      errorCode: outcome.errorCode,
      durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    }, pool);
    if (outcome.outcome === 'retry') {
      const released = await releaseHumanNotificationEvent(eventId, leaseToken, outcome.nextAvailableAt, pool);
      return released
        ? {
            status: 'retry_scheduled',
            errorCode: outcome.errorCode,
            nextAvailableAt: outcome.nextAvailableAt.toISOString(),
          }
        : { status: 'lease_lost' };
    }
    const completed = await completeHumanNotificationEvent(eventId, leaseToken, {
      outcome: 'permanent_failure',
      completedAt,
      errorCode: outcome.errorCode,
    }, pool);
    return completed
      ? { status: 'permanent_failure', errorCode: outcome.errorCode }
      : { status: 'lease_lost' };
  }

  const email = buildSignatureRequestedEmail({
    requestId: record.requestId,
    network: record.network,
    expiresAt: record.expiresAt,
    webOrigin,
  });
  const sendEmail = dependencies.sendEmail ?? ((input) => sendResendEmail(input));

  try {
    const response = await sendEmail({
      from,
      to: record.destinationEmail,
      subject: email.subject,
      text: email.text,
      html: email.html,
      idempotencyKey: record.eventId,
    });
    const outcome = classifyHumanNotificationHttpStatus(
      response.status,
      record.attemptCount,
      now(),
    );
    if (outcome.outcome === 'succeeded' && !response.providerMessageId) {
      throw new ResendEmailTransportError(
        'Resend did not return an email id.',
        'resend_invalid_response',
      );
    }

    const completedAt = now();
    await completeHumanNotificationDelivery(delivery.deliveryId, {
      outcome: outcome.outcome,
      completedAt,
      ...(response.providerMessageId ? { providerMessageId: response.providerMessageId } : {}),
      httpStatus: response.status,
      ...(outcome.outcome === 'succeeded' ? {} : { errorCode: outcome.errorCode }),
      durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    }, pool);

    if (outcome.outcome === 'succeeded') {
      const completed = await completeHumanNotificationEvent(eventId, leaseToken, {
        outcome: 'sent',
        completedAt,
        providerMessageId: response.providerMessageId,
      }, pool);
      return completed
        ? { status: 'sent', providerMessageId: response.providerMessageId }
        : { status: 'lease_lost' };
    }

    if (outcome.outcome === 'retry') {
      const released = await releaseHumanNotificationEvent(eventId, leaseToken, outcome.nextAvailableAt, pool);
      return released
        ? {
            status: 'retry_scheduled',
            errorCode: outcome.errorCode,
            nextAvailableAt: outcome.nextAvailableAt.toISOString(),
          }
        : { status: 'lease_lost' };
    }

    const completed = await completeHumanNotificationEvent(eventId, leaseToken, {
      outcome: 'permanent_failure',
      completedAt,
      errorCode: outcome.errorCode,
    }, pool);
    return completed
      ? {
          status: 'permanent_failure',
          errorCode: outcome.errorCode,
          httpStatus: response.status,
        }
      : { status: 'lease_lost' };
  } catch (cause) {
    const outcome = classifyHumanNotificationTransportFailure(
      transportErrorCode(cause),
      record.attemptCount,
      now(),
    );
    const completedAt = now();
    await completeHumanNotificationDelivery(delivery.deliveryId, {
      outcome: outcome.outcome === 'retry' ? 'retry' : 'permanent_failure',
      completedAt,
      errorCode: outcome.errorCode,
      durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    }, pool);

    if (outcome.outcome === 'retry') {
      const released = await releaseHumanNotificationEvent(eventId, leaseToken, outcome.nextAvailableAt, pool);
      return released
        ? {
            status: 'retry_scheduled',
            errorCode: outcome.errorCode,
            nextAvailableAt: outcome.nextAvailableAt.toISOString(),
          }
        : { status: 'lease_lost' };
    }

    const completed = await completeHumanNotificationEvent(eventId, leaseToken, {
      outcome: 'permanent_failure',
      completedAt,
      errorCode: outcome.errorCode,
    }, pool);
    return completed
      ? { status: 'permanent_failure', errorCode: outcome.errorCode }
      : { status: 'lease_lost' };
  }
}
