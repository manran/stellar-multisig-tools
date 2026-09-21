import assert from 'node:assert/strict';
import test from 'node:test';
import {
  reconcileSorobanIntentExecution,
  SorobanIntentExecutionReconciliationServiceError,
} from './sorobanIntentExecutionReconciliationService.js';
import type {
  SorobanIntentStore,
  StoredSorobanIntent,
  StoredSorobanIntentExecutionObservation,
  StoredSorobanIntentExecutionPreparation,
} from './sorobanIntentStore.js';

const transactionHash = 'ab'.repeat(32);

function storedIntent(): StoredSorobanIntent {
  return {
    version: 1,
    id: 'R'.repeat(16),
    network: 'testnet',
    intent: { intentDigest: 'intent' } as StoredSorobanIntent['intent'],
    authorizationPlan: { authorizationPlanDigest: 'plan' } as StoredSorobanIntent['authorizationPlan'],
    authorizationPlanRevision: 2,
    createdAt: '2026-09-16T10:00:00.000Z',
    discoverySignerKeys: [],
  };
}
function preparation(): StoredSorobanIntentExecutionPreparation {
  return {
    version: 1,
    transactionHash,
    authorizationPlanDigest: 'plan',
    authorizationPlanRevision: 2,
    executionSource: 'GEXECUTOR',
    transactionSequence: '99',
    validUntil: '2026-09-16T10:10:00.000Z',
    latestLedger: 1234,
    effectsDigest: 'effects',
    effectsAccepted: false,
    preparedAt: '2026-09-16T10:01:00.000Z',
  };
}

class MemoryIntentStore implements SorobanIntentStore {
  readonly observations = new Map<string, StoredSorobanIntentExecutionObservation>();
  constructor(
    readonly stored = storedIntent(),
    readonly preparations = [preparation()],
  ) {}
  async createIntent() { throw new Error('not used'); }
  async getIntent(id: string) { return id === this.stored.id ? this.stored : null; }
  async updateIntent() { throw new Error('not used'); }
  async listContributions() { return []; }
  async putContribution() { throw new Error('not used'); }
  async listExecutionPreparations() { return this.preparations; }
  async putExecutionPreparation() { throw new Error('not used'); }
  async listExecutionObservations() { return [...this.observations.values()]; }
  async getExecutionObservation(_id: string, hash: string) { return this.observations.get(hash) ?? null; }
  async putExecutionObservation(_id: string, observation: StoredSorobanIntentExecutionObservation) {
    this.observations.set(observation.transactionHash, observation);
  }
}
test('reconciliation returns not observed without creating durable evidence', async () => {
  const store = new MemoryIntentStore();
  const result = await reconcileSorobanIntentExecution(store, store.stored.id, transactionHash, {
    transactionLoader: async () => null,
    now: new Date('2026-09-16T10:02:00.000Z'),
  });
  assert.equal(result.observed, false);
  assert.equal(result.replayed, false);
  assert.equal(store.observations.size, 0);
});

test('reconciliation persists a successful independently verified network result and replays it', async () => {
  const store = new MemoryIntentStore();
  let loads = 0;
  const loader = async () => {
    loads += 1;
    return {
      hash: transactionHash,
      ledger: 2222,
      successful: true,
      createdAt: '2026-09-16T10:03:00.000Z',
    };
  };
  const first = await reconcileSorobanIntentExecution(store, store.stored.id, transactionHash, {
    transactionLoader: loader,
    now: new Date('2026-09-16T10:04:00.000Z'),
  });
  assert.equal(first.observed, true);
  assert.equal(first.replayed, false);
  assert.equal(first.observation?.ledger, 2222);
  assert.equal(first.observation?.successful, true);
  assert.equal(first.observation?.observedAt, '2026-09-16T10:04:00.000Z');
  assert.equal(first.observation?.networkCreatedAt, '2026-09-16T10:03:00.000Z');
  const replay = await reconcileSorobanIntentExecution(store, store.stored.id, transactionHash, {
    transactionLoader: loader,
    now: new Date('2026-09-16T10:05:00.000Z'),
  });
  assert.equal(replay.observed, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.observation?.observedAt, '2026-09-16T10:04:00.000Z');
  assert.equal(loads, 1);
});

test('reconciliation records a failed ledger result without calling it confirmed', async () => {
  const store = new MemoryIntentStore();
  const result = await reconcileSorobanIntentExecution(store, store.stored.id, transactionHash, {
    transactionLoader: async () => ({ hash: transactionHash, ledger: 3333, successful: false }),
    now: new Date('2026-09-16T10:06:00.000Z'),
  });
  assert.equal(result.observed, true);
  assert.equal(result.observation?.successful, false);
  assert.equal((await store.getExecutionObservation(store.stored.id, transactionHash))?.ledger, 3333);
});

test('reconciliation refuses a hash that was never released as a persisted preparation', async () => {
  const store = new MemoryIntentStore();
  let loaded = false;
  await assert.rejects(
    () => reconcileSorobanIntentExecution(store, store.stored.id, 'cd'.repeat(32), {
      transactionLoader: async () => {
        loaded = true;
        return null;
      },
    }),
    (cause: unknown) => cause instanceof SorobanIntentExecutionReconciliationServiceError
      && cause.code === 'intent_execution_preparation_not_found',
  );
  assert.equal(loaded, false);
});
