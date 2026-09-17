import assert from 'node:assert/strict';
import test from 'node:test';
import type { SorobanIntentStore, StoredSorobanIntent, StoredSorobanIntentAuthorizationContribution } from './sorobanIntentStore.js';
import { listSorobanIntentActivityItems } from './sorobanIntentActivity.js';

function stored(id: string, creatorAddress?: string): StoredSorobanIntent {
  return {
    version: 1,
    id,
    network: 'testnet',
    intent: { version: 1, network: 'testnet', hostFunctionXdr: 'AA==', intentDigest: id.toLowerCase().padEnd(64, '0').slice(0, 64) },
    authorizationPlan: { authorizationPlanDigest: `plan-${id}` } as StoredSorobanIntent['authorizationPlan'],
    createdAt: '2026-09-16T00:00:00.000Z',
    ...(creatorAddress ? { creatorAddress } : {}),
    discoverySignerKeys: [],
  };
}

class MemoryStore implements SorobanIntentStore {
  contributions = new Map<string, StoredSorobanIntentAuthorizationContribution[]>();
  constructor(readonly values: StoredSorobanIntent[]) {}
  async createIntent() { throw new Error('not used'); }
  async getIntent(id: string) { return this.values.find((item) => item.id === id) ?? null; }
  async updateIntent() { throw new Error('not used'); }
  async listIntentsBySigner() { return this.values; }
  async listContributions(id: string) { return this.contributions.get(id) ?? []; }
  async putContribution() { throw new Error('not used'); }
  async listExecutionPreparations() { return []; }
  async listExecutionObservations() { return []; }
}

test('Intent Activity retains creator and proven AUTH contributor but not discovery-only candidates', async () => {
  const creator = 'GCREATOR';
  const signer = 'GSIGNER';
  const creatorIntent = stored('A'.repeat(16), creator);
  const signerIntent = stored('B'.repeat(16));
  const candidateOnly = stored('C'.repeat(16));
  const store = new MemoryStore([creatorIntent, signerIntent, candidateOnly]);
  store.contributions.set(signerIntent.id, [{
    version: 1, digest: 'contribution', entryIndex: 0, signerAddress: signer,
    signatureBase64: 'secret-not-projected', receivedAt: '2026-09-16T00:01:00.000Z',
  }]);

  const creatorItems = await listSorobanIntentActivityItems(store, creator, 'testnet');
  assert.deepEqual(creatorItems.map((item) => item.intentId), [creatorIntent.id]);

  const signerItems = await listSorobanIntentActivityItems(store, signer, 'testnet');
  assert.deepEqual(signerItems.map((item) => item.intentId), [signerIntent.id]);
  assert.equal(JSON.stringify(signerItems).includes('secret-not-projected'), false);

  const candidateItems = await listSorobanIntentActivityItems(store, 'GCANDIDATE', 'testnet');
  assert.deepEqual(candidateItems, []);
});
