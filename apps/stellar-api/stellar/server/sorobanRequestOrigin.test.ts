import assert from 'node:assert/strict';
import test from 'node:test';
import { verifySorobanRequestOrigin, SorobanRequestOriginError } from './sorobanRequestOrigin.js';
import type { SorobanIntentStore, StoredSorobanIntent } from './sorobanIntentStore.js';

function fixture(external = false) {
  const intent = {
    version: 1,
    id: 'R'.repeat(16),
    network: 'testnet',
    intent: { intentDigest: 'intent-digest' },
    authorizationPlan: { authorizationPlanDigest: 'plan-2' },
    authorizationPlanRevision: 2,
    createdAt: '2026-09-16T01:00:00.000Z',
    discoverySignerKeys: [],
    ...(external ? { executionPolicy: { mode: 'external' as const } } : {}),
  } as StoredSorobanIntent;
  const preparations = [{
    version: 1 as const,
    transactionHash: 'ab'.repeat(32),
    authorizationPlanDigest: 'plan-2',
    authorizationPlanRevision: 2,
    executionSource: 'GEXECUTOR',
    transactionSequence: '9',
    validUntil: '2026-09-16T01:05:00.000Z',
    latestLedger: 123,
    effectsDigest: 'effects-2',
    effectsAccepted: false,
    preparedAt: '2026-09-16T01:01:00.000Z',
  }];
  const store: SorobanIntentStore = {
    async createIntent() { throw new Error('not used'); },
    async getIntent(id) { return id === intent.id ? intent : null; },
    async updateIntent() { throw new Error('not used'); },
    async listContributions() { return []; },
    async putContribution() { throw new Error('not used'); },
    async listExecutionPreparations() { return preparations; },
  };
  return { intent, store, preparations };
}

test('verified Soroban Request origin is derived from durable preparation, not caller claims', async () => {
  const f = fixture();
  const origin = await verifySorobanRequestOrigin(f.store, { intentId: f.intent.id, network: 'testnet', transactionHash: 'ab'.repeat(32) });
  assert.deepEqual(origin, {
    version: 1, intentId: f.intent.id, authorizationPlanDigest: 'plan-2', authorizationPlanRevision: 2,
    executionPreparedAt: '2026-09-16T01:01:00.000Z', effectsDigest: 'effects-2',
  });
});

test('Soroban Request origin rejects wrong transaction, stale plan, and external-only Intent', async () => {
  const f = fixture();
  await assert.rejects(
    () => verifySorobanRequestOrigin(f.store, { intentId: f.intent.id, network: 'testnet', transactionHash: 'cd'.repeat(32) }),
    (cause: unknown) => cause instanceof SorobanRequestOriginError && cause.code === 'soroban_intent_origin_mismatch',
  );
  f.preparations[0].authorizationPlanRevision = 1;
  await assert.rejects(
    () => verifySorobanRequestOrigin(f.store, { intentId: f.intent.id, network: 'testnet', transactionHash: 'ab'.repeat(32) }),
    (cause: unknown) => cause instanceof SorobanRequestOriginError && cause.code === 'soroban_intent_origin_mismatch',
  );
  const external = fixture(true);
  await assert.rejects(
    () => verifySorobanRequestOrigin(external.store, { intentId: external.intent.id, network: 'testnet', transactionHash: 'ab'.repeat(32) }),
    (cause: unknown) => cause instanceof SorobanRequestOriginError && cause.code === 'external_executor_required',
  );
});
