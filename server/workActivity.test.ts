import assert from 'node:assert/strict';
import test from 'node:test';
import type { SigningRequestStore } from './requestStore.js';
import type { SorobanIntentStore, StoredSorobanIntent, StoredSorobanIntentExecutionObservation } from './sorobanIntentStore.js';
import { listWorkActivityPage } from './workActivity.js';

const VIEWER = 'GVIEWER';

function stored(id: string, createdAt: string): StoredSorobanIntent {
  return {
    version: 1,
    id,
    network: 'testnet',
    intent: { version: 1, network: 'testnet', hostFunctionXdr: 'AA==', intentDigest: id.toLowerCase().padEnd(64, '0').slice(0, 64) },
    authorizationPlan: { authorizationPlanDigest: `plan-${id}` } as StoredSorobanIntent['authorizationPlan'],
    createdAt,
    creatorAddress: VIEWER,
    discoverySignerKeys: [VIEWER],
  };
}

class MemoryIntentStore implements SorobanIntentStore {
  observations = new Map<string, StoredSorobanIntentExecutionObservation[]>();
  constructor(readonly values: StoredSorobanIntent[]) {}
  async createIntent() { throw new Error('not used'); }
  async getIntent(id: string) { return this.values.find((item) => item.id === id) ?? null; }
  async updateIntent() { throw new Error('not used'); }
  async listIntentsBySigner() { return this.values; }
  async listContributions() { return []; }
  async putContribution() { throw new Error('not used'); }
  async listExecutionPreparations() { return []; }
  async listExecutionObservations(id: string) { return this.observations.get(id) ?? []; }
}

const emptyRequestStore = {
  async listRequests() { return []; },
} as unknown as SigningRequestStore;

test('Work Activity uses one stable cursor across Soroban Intent history', async () => {
  const older = stored('A'.repeat(16), '2026-09-16T01:00:00.000Z');
  const newer = stored('B'.repeat(16), '2026-09-16T02:00:00.000Z');
  const store = new MemoryIntentStore([older, newer]);
  store.observations.set(older.id, [{
    version: 1,
    transactionHash: 'ab'.repeat(32),
    authorizationPlanDigest: older.authorizationPlan.authorizationPlanDigest,
    authorizationPlanRevision: 1,
    executionSource: VIEWER,
    ledger: 123,
    successful: true,
    observedAt: '2026-09-16T03:00:00.000Z',
  }]);

  const first = await listWorkActivityPage(emptyRequestStore, store, VIEWER, {
    network: 'testnet',
    limit: 1,
  });
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0]?.workId, older.id);
  assert.ok(first.nextCursor);

  const second = await listWorkActivityPage(emptyRequestStore, store, VIEWER, {
    network: 'testnet',
    limit: 1,
    cursor: first.nextCursor,
  });
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0]?.workId, newer.id);
  assert.equal(second.nextCursor, undefined);
});
