import type { Pool } from 'pg';
import { STELLAR_MAINNET_ORIGIN, STELLAR_TESTNET_ORIGIN } from '../../../../packages/stellar-core/src/deploymentOrigins.js';
import { coordinationPool } from '../db/postgres.js';
import { createPostgresSigningRequestStore } from '../db/postgresSigningRequestStore.js';
import { createPostgresSorobanIntentStore } from '../db/postgresSorobanIntentStore.js';
import { blobIntegrationCredentialStore } from './blobIntegrationCredentialStore.js';
import type { RequestPrivateDataStore } from './requestPrivateDataStore.js';
import type { SorobanIntentPrivateDataStore } from './sorobanIntentPrivateDataStore.js';
import { dispatchIntegrationWebhookEvent } from './integrationWebhookDispatcher.js';
import { NodeIntegrationWebhookHttpTransport } from './nodeIntegrationWebhookHttpTransport.js';
import { createIntegrationWebhookPayloadBuilder } from './integrationWebhookPayload.js';

const redactedRequestPrivateStore: RequestPrivateDataStore = {
  async getRequestPrivateData() { return null; },
  async putRequestPrivateData() { throw new Error('Webhook projection cannot write Request private data.'); },
  async listPrivateNoteRevisions() { return []; },
  async putPrivateNoteRevision() { throw new Error('Webhook projection cannot write Request private data.'); },
};

const redactedSorobanPrivateStore: SorobanIntentPrivateDataStore = {
  async getIntentPrivateData() { return null; },
  async putIntentPrivateData() { throw new Error('Webhook projection cannot write Soroban private data.'); },
};

export function integrationWebhookReviewOrigin(network: 'public' | 'testnet'): string {
  return network === 'public' ? STELLAR_MAINNET_ORIGIN : STELLAR_TESTNET_ORIGIN;
}

export function createRuntimeIntegrationWebhookPayloadBuilder(pool: Pool = coordinationPool()) {
  const requests = createPostgresSigningRequestStore(
    pool,
    redactedRequestPrivateStore,
    { emitOutbox: false },
  );
  const intents = createPostgresSorobanIntentStore(
    pool,
    redactedSorobanPrivateStore,
    { emitOutbox: false },
  );
  return createIntegrationWebhookPayloadBuilder({
    requests,
    intents,
    reviewOriginFor: integrationWebhookReviewOrigin,
  });
}

export function dispatchRuntimeIntegrationWebhookEvent(
  eventId: string,
  options: {
    pool?: Pool;
    timeoutMs?: number;
    webhookMasterSecret?: string;
  } = {},
) {
  const pool = options.pool ?? coordinationPool();
  return dispatchIntegrationWebhookEvent(eventId, {
    credentials: blobIntegrationCredentialStore,
    transport: new NodeIntegrationWebhookHttpTransport(),
    payloadBuilder: createRuntimeIntegrationWebhookPayloadBuilder(pool),
    pool,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.webhookMasterSecret ? { webhookMasterSecret: options.webhookMasterSecret } : {}),
  });
}
