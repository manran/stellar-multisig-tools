import assert from 'node:assert/strict';
import test from 'node:test';
import type { SigningRequestSnapshot } from '../../../../packages/stellar-core/src/requestTypes.js';
import { emptySorobanEffectsSnapshot } from '../../../../packages/stellar-core/src/sorobanEffects.js';
import type { SorobanIntentAuthorizationSnapshot } from './sorobanIntentAuthorizationService.js';
import type { SigningRequestStore, StoredSigningRequest } from './requestStore.js';
import type { SorobanIntentStore, StoredSorobanIntent } from './sorobanIntentStore.js';
import {
  createIntegrationWebhookPayloadBuilder,
  integrationWebhookEnvelope,
  IntegrationWebhookProjectionError,
  projectClassicIntegrationWebhook,
  projectSorobanIntegrationWebhook,
} from './integrationWebhookPayload.js';

const CLASSIC_ID = 'REQWEBHOOK000001';
const INTENT_ID = 'INTWEBHOOK000001';

test('Classic webhook projection omits XDR and private context while preserving business status', () => {
  const stored: StoredSigningRequest = {
    version: 1,
    id: CLASSIC_ID,
    network: 'testnet',
    baseXdr: 'SECRET_BASE_XDR',
    transactionHash: 'a'.repeat(64),
    createdAt: '2026-09-18T01:00:00.000Z',
    expiresAt: '2026-09-19T01:00:00.000Z',
    integration: {
      version: 1,
      serviceId: 'fednetwork',
      correlationId: 'transfer-42',
    },
    executionPolicy: { mode: 'external' },
    initialPrivateNote: {
      version: 1,
      revisionId: 'initial',
      text: 'SECRET_PRIVATE_NOTE',
      createdAt: '2026-09-18T01:00:00.000Z',
    },
  };
  const snapshot: SigningRequestSnapshot = {
    id: CLASSIC_ID,
    network: 'testnet',
    transactionHash: 'a'.repeat(64),
    baseXdr: 'SECRET_BASE_XDR',
    mergedXdr: 'SECRET_MERGED_XDR',
    createdAt: stored.createdAt,
    expiresAt: stored.expiresAt,
    contributionCount: 2,
    signatureCount: 2,
    status: 'ready',
    statusReason: 'authorization_complete',
    execution: {
      mode: 'external',
      executor: { type: 'service', id: 'fednetwork' },
    },
  };

  const projection = projectClassicIntegrationWebhook(stored, snapshot);
  assert.equal(projection.request.status, 'ready');
  assert.equal(projection.request.externalReference, 'transfer-42');
  const encoded = JSON.stringify(projection);
  assert.doesNotMatch(encoded, /SECRET_BASE_XDR|SECRET_MERGED_XDR|SECRET_PRIVATE_NOTE/);
  assert.doesNotMatch(encoded, /baseXdr|mergedXdr|privateNote/);
});

test('Soroban webhook projection omits detached AUTH XDR and private note while preserving Job state', () => {
  const stored: StoredSorobanIntent = {
    version: 1,
    id: INTENT_ID,
    network: 'testnet',
    intent: {
      version: 1,
      network: 'testnet',
      hostFunctionXdr: 'SECRET_HOST_FUNCTION_XDR',
      intentDigest: 'b'.repeat(64),
    },
    authorizationPlan: {
      version: 1,
      network: 'testnet',
      intentDigest: 'b'.repeat(64),
      authorizationPlanDigest: 'c'.repeat(64),
      authorizationEntriesXdr: ['SECRET_PLAN_AUTH_XDR'],
      effects: emptySorobanEffectsSnapshot(),
      executionBinding: 'detached',
    },
    authorizationPlanRevision: 1,
    createdAt: '2026-09-18T01:00:00.000Z',
    discoverySignerKeys: [],
    integration: {
      version: 1,
      serviceId: 'fednetwork',
      correlationId: 'contract-42',
    },
    privateContext: {
      externalReference: 'contract-42',
      initialPrivateNote: {
        version: 1,
        revisionId: 'initial',
        text: 'SECRET_SOROBAN_NOTE',
        createdAt: '2026-09-18T01:00:00.000Z',
      },
    },
  };
  const authorization: SorobanIntentAuthorizationSnapshot = {
    id: INTENT_ID,
    network: 'testnet',
    intentDigest: 'b'.repeat(64),
    authorizationPlanDigest: 'c'.repeat(64),
    executionBinding: 'detached',
    status: 'authorization_ready',
    authorizationEntriesXdr: ['SECRET_RUNTIME_AUTH_XDR'],
    contributionCount: 1,
    authorizers: [],
  };

  const projection = projectSorobanIntegrationWebhook(
    stored,
    authorization,
    [],
    [],
    'https://stellar-testnet.multisig.tools',
    new Date('2026-09-18T01:05:00.000Z'),
  );
  assert.equal(projection.job.state, 'ready');
  assert.equal(projection.job.externalReference, 'contract-42');
  const encoded = JSON.stringify(projection);
  assert.doesNotMatch(encoded, /SECRET_HOST_FUNCTION_XDR|SECRET_PLAN_AUTH_XDR|SECRET_RUNTIME_AUTH_XDR|SECRET_SOROBAN_NOTE/);
  assert.doesNotMatch(encoded, /authorizationEntriesXdr|hostFunctionXdr|privateNote/);
});

test('public webhook envelope shares identity without inventing a universal Work state machine', () => {
  const projection = {
    type: 'classic_request' as const,
    request: {
      version: 1 as const,
      id: CLASSIC_ID,
      network: 'testnet' as const,
      transactionHash: 'a'.repeat(64),
      createdAt: '2026-09-18T01:00:00.000Z',
      expiresAt: '2026-09-19T01:00:00.000Z',
      contributionCount: 0,
      signatureCount: 0,
      status: 'awaiting_signatures' as const,
      statusReason: 'signatures_required' as const,
    },
  };
  const envelope = integrationWebhookEnvelope({
    eventId: 'evt-1',
    serviceId: 'fednetwork',
    resourceKind: 'classic_request',
    resourceId: CLASSIC_ID,
    eventType: 'coordination.changed',
    eventVersion: 1,
    payload: { version: 1, change: 'created' },
    createdAt: '2026-09-18T01:00:00.000Z',
    availableAt: '2026-09-18T01:00:00.000Z',
    attemptCount: 1,
  }, 'testnet', projection, 'transfer-42');

  assert.equal(envelope.schema, 'multisigtools-integration-webhook-v1');
  assert.equal(envelope.type, 'work.changed');
  assert.deepEqual(envelope.data.work, {
    kind: 'classic_request',
    id: CLASSIC_ID,
    network: 'testnet',
    externalReference: 'transfer-42',
  });
  assert.equal('state' in envelope.data.work, false);
});

test('payload builder derives the Classic envelope from canonical facts without exposing private fields', async () => {
  const stored: StoredSigningRequest = {
    version: 1,
    id: CLASSIC_ID,
    network: 'testnet',
    baseXdr: 'SECRET_BUILDER_BASE_XDR',
    transactionHash: 'e'.repeat(64),
    createdAt: '2026-09-18T02:00:00.000Z',
    expiresAt: '2026-09-19T02:00:00.000Z',
    integration: {
      version: 1,
      serviceId: 'fednetwork',
      correlationId: 'builder-42',
    },
    capabilityHash: 'SECRET_CAPABILITY_HASH',
    initialPrivateNote: {
      version: 1,
      revisionId: 'initial',
      text: 'SECRET_BUILDER_NOTE',
      createdAt: '2026-09-18T02:00:00.000Z',
    },
  };
  const snapshot: SigningRequestSnapshot = {
    id: CLASSIC_ID,
    network: 'testnet',
    transactionHash: stored.transactionHash,
    baseXdr: 'SECRET_BUILDER_BASE_XDR',
    mergedXdr: 'SECRET_BUILDER_MERGED_XDR',
    createdAt: stored.createdAt,
    expiresAt: stored.expiresAt,
    contributionCount: 1,
    signatureCount: 1,
    status: 'awaiting_signatures',
    statusReason: 'signatures_required',
  };
  const requests = {
    async getRequest(id: string) { return id === CLASSIC_ID ? stored : null; },
  } as unknown as SigningRequestStore;
  const intents = {
    async getIntent() { return null; },
  } as unknown as SorobanIntentStore;
  const builder = createIntegrationWebhookPayloadBuilder({
    requests,
    intents,
    reviewOriginFor: () => 'https://stellar-testnet.multisig.tools',
    loadClassicSnapshot: async () => snapshot,
  });
  const payload = await builder.build({
    eventId: 'evt-builder-classic',
    serviceId: 'fednetwork',
    resourceKind: 'classic_request',
    resourceId: CLASSIC_ID,
    eventType: 'coordination.changed',
    eventVersion: 1,
    payload: { version: 1, change: 'authorization_contributed' },
    createdAt: '2026-09-18T02:01:00.000Z',
    availableAt: '2026-09-18T02:01:00.000Z',
    attemptCount: 1,
  });

  const encoded = JSON.stringify(payload);
  assert.match(encoded, /builder-42/);
  assert.match(encoded, /awaiting_signatures/);
  assert.doesNotMatch(encoded, /SECRET_BUILDER_BASE_XDR|SECRET_BUILDER_MERGED_XDR|SECRET_BUILDER_NOTE|SECRET_CAPABILITY_HASH/);
  assert.doesNotMatch(encoded, /baseXdr|mergedXdr|capabilityHash|initialPrivateNote/);
});

test('payload builder fails closed when an outbox event does not belong to the owning Service', async () => {
  const stored: StoredSigningRequest = {
    version: 1,
    id: CLASSIC_ID,
    network: 'testnet',
    baseXdr: 'AAAA',
    transactionHash: 'f'.repeat(64),
    createdAt: '2026-09-18T02:00:00.000Z',
    expiresAt: '2026-09-19T02:00:00.000Z',
    integration: { version: 1, serviceId: 'other-service' },
  };
  const requests = {
    async getRequest() { return stored; },
  } as unknown as SigningRequestStore;
  const intents = {
    async getIntent() { return null; },
  } as unknown as SorobanIntentStore;
  const builder = createIntegrationWebhookPayloadBuilder({
    requests,
    intents,
    reviewOriginFor: () => 'https://stellar-testnet.multisig.tools',
    loadClassicSnapshot: async () => { throw new Error('ownership must fail before projection'); },
  });

  await assert.rejects(
    () => builder.build({
      eventId: 'evt-owner-mismatch',
      serviceId: 'fednetwork',
      resourceKind: 'classic_request',
      resourceId: CLASSIC_ID,
      eventType: 'coordination.changed',
      eventVersion: 1,
      payload: {},
      createdAt: '2026-09-18T02:01:00.000Z',
      availableAt: '2026-09-18T02:01:00.000Z',
      attemptCount: 1,
    }),
    IntegrationWebhookProjectionError,
  );
});

test('payload builder derives Soroban Job without leaking Intent or detached AUTH material', async () => {
  const stored: StoredSorobanIntent = {
    version: 1,
    id: INTENT_ID,
    network: 'testnet',
    intent: {
      version: 1,
      network: 'testnet',
      hostFunctionXdr: 'SECRET_BUILDER_HOST_XDR',
      intentDigest: '1'.repeat(64),
    },
    authorizationPlan: {
      version: 1,
      network: 'testnet',
      intentDigest: '1'.repeat(64),
      authorizationPlanDigest: '2'.repeat(64),
      authorizationEntriesXdr: ['SECRET_BUILDER_PLAN_AUTH'],
      effects: emptySorobanEffectsSnapshot(),
      executionBinding: 'detached',
    },
    authorizationPlanRevision: 1,
    createdAt: '2026-09-18T03:00:00.000Z',
    discoverySignerKeys: [],
    integration: {
      version: 1,
      serviceId: 'fednetwork',
      correlationId: 'soroban-builder-42',
    },
    privateContext: {
      externalReference: 'soroban-builder-42',
      initialPrivateNote: {
        version: 1,
        revisionId: 'initial',
        text: 'SECRET_BUILDER_SOROBAN_NOTE',
        createdAt: '2026-09-18T03:00:00.000Z',
      },
    },
  };
  const authorization: SorobanIntentAuthorizationSnapshot = {
    id: INTENT_ID,
    network: 'testnet',
    intentDigest: '1'.repeat(64),
    authorizationPlanDigest: '2'.repeat(64),
    executionBinding: 'detached',
    status: 'authorization_ready',
    authorizationEntriesXdr: ['SECRET_BUILDER_RUNTIME_AUTH'],
    contributionCount: 2,
    authorizers: [],
  };
  const requests = {
    async getRequest() { return null; },
  } as unknown as SigningRequestStore;
  const intents = {
    async getIntent(id: string) { return id === INTENT_ID ? stored : null; },
    async listExecutionPreparations() { return []; },
    async listExecutionObservations() { return []; },
  } as unknown as SorobanIntentStore;
  const builder = createIntegrationWebhookPayloadBuilder({
    requests,
    intents,
    reviewOriginFor: () => 'https://stellar-testnet.multisig.tools',
    loadSorobanAuthorization: async () => authorization,
    now: () => new Date('2026-09-18T03:05:00.000Z'),
  });
  const payload = await builder.build({
    eventId: 'evt-builder-soroban',
    serviceId: 'fednetwork',
    resourceKind: 'soroban_intent',
    resourceId: INTENT_ID,
    eventType: 'coordination.changed',
    eventVersion: 1,
    payload: { version: 1, change: 'authorization_contributed' },
    createdAt: '2026-09-18T03:01:00.000Z',
    availableAt: '2026-09-18T03:01:00.000Z',
    attemptCount: 1,
  });

  const encoded = JSON.stringify(payload);
  assert.match(encoded, /soroban_job/);
  assert.match(encoded, /soroban-builder-42/);
  assert.match(encoded, /stellar-testnet\.multisig\.tools\/a#INTWEBHOOK000001/);
  assert.doesNotMatch(encoded, /SECRET_BUILDER_HOST_XDR|SECRET_BUILDER_PLAN_AUTH|SECRET_BUILDER_RUNTIME_AUTH|SECRET_BUILDER_SOROBAN_NOTE/);
  assert.doesNotMatch(encoded, /hostFunctionXdr|authorizationEntriesXdr|initialPrivateNote/);
});
