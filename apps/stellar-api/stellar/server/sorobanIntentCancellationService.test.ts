import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSorobanIntentCancellationOwner,
  cancelSorobanIntent,
  SorobanIntentCancellationServiceError,
} from './sorobanIntentCancellationService.js';
import { SorobanIntentStoreConflictError } from './sorobanIntentStore.js';
import type {
  SorobanIntentStore,
  StoredSorobanIntent,
  StoredSorobanIntentCancellation,
  StoredSorobanIntentExecutionObservation,
} from './sorobanIntentStore.js';

const DIGEST = 'a'.repeat(64);

class MemoryStore implements SorobanIntentStore {
  value: StoredSorobanIntent;
  cancellation: StoredSorobanIntentCancellation | null = null;
  observations: StoredSorobanIntentExecutionObservation[] = [];

  constructor() {
    this.value = {
      version: 1,
      id: 'CANCEL0000000001',
      network: 'testnet',
      intent: { version: 1, network: 'testnet', hostFunctionXdr: 'AAAA', intentDigest: 'b'.repeat(64) },
      authorizationPlan: { authorizationPlanDigest: DIGEST } as StoredSorobanIntent['authorizationPlan'],
      authorizationPlanRevision: 3,
      createdAt: '2026-09-18T00:00:00.000Z',
      creatorAddress: 'GCREATOR',
      discoverySignerKeys: ['GCREATOR'],
    };
  }

  async createIntent(value: StoredSorobanIntent) { this.value = value; }
  async getIntent() { return { ...this.value, ...(this.cancellation ? { cancellation: this.cancellation } : {}) }; }
  async updateIntent(value: StoredSorobanIntent) { this.value = value; }
  async listContributions() { return []; }
  async putContribution() {}
  async listExecutionObservations() { return this.observations; }
  async cancelIntent(_id: string, cancellation: StoredSorobanIntentCancellation) {
    if (this.cancellation) return { cancellation: this.cancellation, created: false };
    this.cancellation = cancellation;
    return { cancellation, created: true };
  }
}

test('cancellation is a durable idempotent terminal coordination fact', async () => {
  const store = new MemoryStore();
  const first = await cancelSorobanIntent(
    store,
    store.value.id,
    { cancelledByAddress: 'GCREATOR' },
    { now: new Date('2026-09-18T01:00:00.000Z') },
  );
  assert.equal(first.replayed, false);
  assert.equal(first.cancellation.authorizationPlanRevision, 3);
  assert.equal(first.cancellation.authorizationPlanDigest, DIGEST);
  assert.equal(first.cancellation.cancelledByAddress, 'GCREATOR');
  assert.equal(first.intent.cancellation?.cancelledAt, '2026-09-18T01:00:00.000Z');

  const second = await cancelSorobanIntent(
    store,
    store.value.id,
    { cancelledByAddress: 'GOTHER' },
    { now: new Date('2026-09-18T02:00:00.000Z') },
  );
  assert.equal(second.replayed, true);
  assert.equal(second.cancellation.cancelledByAddress, 'GCREATOR');
  assert.equal(second.cancellation.cancelledAt, '2026-09-18T01:00:00.000Z');
});

test('only the creator or owning Integration Service can cancel an Intent', () => {
  const store = new MemoryStore();
  assert.doesNotThrow(() => assertSorobanIntentCancellationOwner(store.value, { principalAddress: 'GCREATOR' }));
  assert.throws(
    () => assertSorobanIntentCancellationOwner(store.value, { principalAddress: 'GSIGNER' }),
    (cause: unknown) => cause instanceof SorobanIntentCancellationServiceError
      && cause.code === 'intent_cancel_not_owner',
  );

  const integration = {
    ...store.value,
    creatorAddress: undefined,
    integration: { version: 1, serviceId: 'fednetwork' },
  } as StoredSorobanIntent;
  assert.doesNotThrow(() => assertSorobanIntentCancellationOwner(integration, { serviceId: 'fednetwork' }));
  assert.throws(
    () => assertSorobanIntentCancellationOwner(integration, { serviceId: 'other-service' }),
    (cause: unknown) => cause instanceof SorobanIntentCancellationServiceError
      && cause.code === 'intent_cancel_not_owner',
  );
});

test('store-level executed race is translated to the stable cancellation service error', async () => {
  const store = new MemoryStore();
  store.cancelIntent = async () => { throw new SorobanIntentStoreConflictError('intent_already_executed'); };
  await assert.rejects(
    () => cancelSorobanIntent(store, store.value.id, { cancelledByAddress: 'GCREATOR' }),
    (cause: unknown) => cause instanceof SorobanIntentCancellationServiceError
      && cause.code === 'intent_already_executed'
      && cause.status === 409,
  );
});

test('known successful execution cannot be relabelled as cancelled', async () => {
  const store = new MemoryStore();
  store.observations = [{
    version: 1,
    transactionHash: 'c'.repeat(64),
    authorizationPlanDigest: DIGEST,
    authorizationPlanRevision: 3,
    executionSource: 'GEXECUTOR',
    ledger: 42,
    successful: true,
    observedAt: '2026-09-18T00:30:00.000Z',
  }];
  await assert.rejects(
    () => cancelSorobanIntent(store, store.value.id, { cancelledByAddress: 'GCREATOR' }),
    (cause: unknown) => cause instanceof SorobanIntentCancellationServiceError
      && cause.code === 'intent_already_executed',
  );
});
