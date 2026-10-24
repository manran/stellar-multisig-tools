import type { IntegrationSorobanJobProjection } from '../../../../packages/stellar-core/src/sorobanIntentApiTypes.js';
import type {
  SigningRequestSnapshot,
  SigningRequestStatus,
  SigningRequestStatusReason,
} from '../../../../packages/stellar-core/src/requestTypes.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';
import type { IntegrationOutboxRecord } from '../db/postgresIntegrationOutboxDispatch.js';
import { projectIntegrationSorobanJob } from './integrationSorobanJobProjection.js';
import type { IntegrationWebhookPayloadBuilder } from './integrationWebhookDispatcher.js';
import { getSigningRequestForStoredRequest } from './requestService.js';
import type { SigningRequestStore, StoredSigningRequest } from './requestStore.js';
import {
  getSorobanIntentAuthorization,
  type SorobanIntentAuthorizationSnapshot,
} from './sorobanIntentAuthorizationService.js';
import type {
  SorobanIntentStore,
  StoredSorobanIntent,
} from './sorobanIntentStore.js';

export interface IntegrationClassicRequestWebhookProjection {
  type: 'classic_request';
  request: {
    version: 1;
    id: string;
    network: StellarNetwork;
    transactionHash: string;
    createdAt: string;
    expiresAt: string;
    contributionCount: number;
    signatureCount: number;
    status: SigningRequestStatus;
    statusReason: SigningRequestStatusReason;
    executionMode?: 'multisigtools' | 'external';
    externalReference?: string;
    result?: {
      transactionHash: string;
      ledger: number;
      submittedAt: string;
    };
  };
}

export interface IntegrationSorobanWebhookProjection {
  type: 'soroban_job';
  job: IntegrationSorobanJobProjection;
}

export type IntegrationWebhookProjection =
  | IntegrationClassicRequestWebhookProjection
  | IntegrationSorobanWebhookProjection;

export interface IntegrationWebhookEnvelopeV1 {
  schema: 'multisigtools-integration-webhook-v1';
  id: string;
  type: 'work.changed';
  createdAt: string;
  serviceId: string;
  data: {
    work: {
      kind: 'classic_request' | 'soroban_intent';
      id: string;
      network: StellarNetwork;
      externalReference?: string;
    };
    projection: IntegrationWebhookProjection;
  };
}

export class IntegrationWebhookProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrationWebhookProjectionError';
  }
}

export function projectClassicIntegrationWebhook(
  stored: StoredSigningRequest,
  snapshot: SigningRequestSnapshot,
): IntegrationClassicRequestWebhookProjection {
  return {
    type: 'classic_request',
    request: {
      version: 1,
      id: snapshot.id,
      network: snapshot.network,
      transactionHash: snapshot.transactionHash,
      createdAt: snapshot.createdAt,
      expiresAt: snapshot.expiresAt,
      contributionCount: snapshot.contributionCount,
      signatureCount: snapshot.signatureCount,
      status: snapshot.status,
      statusReason: snapshot.statusReason,
      ...(stored.executionPolicy?.mode ? { executionMode: stored.executionPolicy.mode } : {}),
      ...(stored.integration?.correlationId
        ? { externalReference: stored.integration.correlationId }
        : {}),
      ...(snapshot.submission ? {
        result: {
          transactionHash: snapshot.submission.transactionHash,
          ledger: snapshot.submission.ledger,
          submittedAt: snapshot.submission.submittedAt,
        },
      } : {}),
    },
  };
}

function reviewUrl(origin: string, id: string): string {
  const url = new URL('/a', origin);
  url.hash = id;
  return url.toString();
}

export function projectSorobanIntegrationWebhook(
  stored: StoredSorobanIntent,
  authorization: SorobanIntentAuthorizationSnapshot,
  preparations: Awaited<ReturnType<NonNullable<SorobanIntentStore['listExecutionPreparations']>>>,
  observations: Awaited<ReturnType<NonNullable<SorobanIntentStore['listExecutionObservations']>>>,
  reviewOrigin: string,
  now = new Date(),
): IntegrationSorobanWebhookProjection {
  return {
    type: 'soroban_job',
    job: projectIntegrationSorobanJob({
      stored,
      authorization,
      preparations,
      observations,
      reviewUrl: reviewUrl(reviewOrigin, stored.id),
      now,
    }),
  };
}

export function integrationWebhookEnvelope(
  record: IntegrationOutboxRecord,
  network: StellarNetwork,
  projection: IntegrationWebhookProjection,
  externalReference?: string,
): IntegrationWebhookEnvelopeV1 {
  return {
    schema: 'multisigtools-integration-webhook-v1',
    id: record.eventId,
    type: 'work.changed',
    createdAt: record.createdAt,
    serviceId: record.serviceId,
    data: {
      work: {
        kind: record.resourceKind,
        id: record.resourceId,
        network,
        ...(externalReference ? { externalReference } : {}),
      },
      projection,
    },
  };
}

export function createIntegrationWebhookPayloadBuilder(input: {
  requests: SigningRequestStore;
  intents: SorobanIntentStore;
  reviewOriginFor: (network: StellarNetwork) => string;
  loadClassicSnapshot?: (
    store: SigningRequestStore,
    stored: StoredSigningRequest,
  ) => Promise<SigningRequestSnapshot>;
  loadSorobanAuthorization?: (
    store: SorobanIntentStore,
    id: string,
  ) => Promise<SorobanIntentAuthorizationSnapshot>;
  now?: () => Date;
}): IntegrationWebhookPayloadBuilder {
  const loadClassic = input.loadClassicSnapshot
    ?? ((store, stored) => getSigningRequestForStoredRequest(store, stored));
  const loadAuthorization = input.loadSorobanAuthorization
    ?? ((store, id) => getSorobanIntentAuthorization(store, id));
  const now = input.now ?? (() => new Date());

  return {
    async build(record) {
      if (record.resourceKind === 'classic_request') {
        const stored = await input.requests.getRequest(record.resourceId);
        if (!stored || stored.integration?.serviceId !== record.serviceId) {
          throw new IntegrationWebhookProjectionError(
            'Classic Integration work is unavailable or no longer owned by this Service.',
          );
        }
        const snapshot = await loadClassic(input.requests, stored);
        const projection = projectClassicIntegrationWebhook(stored, snapshot);
        return integrationWebhookEnvelope(
          record,
          stored.network,
          projection,
          stored.integration.correlationId,
        );
      }

      const stored = await input.intents.getIntent(record.resourceId);
      if (!stored || stored.integration?.serviceId !== record.serviceId) {
        throw new IntegrationWebhookProjectionError(
          'Soroban Integration work is unavailable or no longer owned by this Service.',
        );
      }
      const [authorization, preparations, observations] = await Promise.all([
        loadAuthorization(input.intents, stored.id),
        input.intents.listExecutionPreparations?.(stored.id) ?? Promise.resolve([]),
        input.intents.listExecutionObservations?.(stored.id) ?? Promise.resolve([]),
      ]);
      const projection = projectSorobanIntegrationWebhook(
        stored,
        authorization,
        preparations,
        observations,
        input.reviewOriginFor(stored.network),
        now(),
      );
      return integrationWebhookEnvelope(
        record,
        stored.network,
        projection,
        stored.privateContext?.externalReference,
      );
    },
  };
}
