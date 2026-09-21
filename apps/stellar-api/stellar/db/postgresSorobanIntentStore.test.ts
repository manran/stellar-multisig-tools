import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { SorobanExecutionPolicy } from '../../../../src/stellar/executionPolicy.js';
import { emptySorobanEffectsSnapshot } from '../../../../src/stellar/sorobanEffects.js';
import type { SorobanAuthorizationPlan } from '../../../../src/stellar/sorobanAuthorizationPlan.js';
import type { SorobanIntent } from '../../../../src/stellar/sorobanIntent.js';
import { applyCoordinationMigrations } from './migrate.js';
import { closeCoordinationPool, coordinationPool } from './postgres.js';
import { createPostgresSorobanIntentStore } from './postgresSorobanIntentStore.js';
import type {
  SorobanIntentPrivateDataStore,
  StoredSorobanIntentPrivateData,
} from '../server/sorobanIntentPrivateDataStore.js';
import {
  SorobanIntentStoreConflictError,
  type StoredSorobanIntent,
} from '../server/sorobanIntentStore.js';

const TEST_URL = process.env.MST_POSTGRES_TEST_URL?.trim();
const RESET_ALLOWED = process.env.MST_POSTGRES_TEST_ALLOW_RESET === '1';
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

const INTENT_DIGEST = 'b'.repeat(64);
const PLAN_ONE = 'a'.repeat(64);
const PLAN_TWO = 'c'.repeat(64);
const TX_HASH = 'd'.repeat(64);

class MemoryPrivateStore implements SorobanIntentPrivateDataStore {
  readonly values = new Map<string, StoredSorobanIntentPrivateData>();
  async getIntentPrivateData(id: string) { return this.values.get(id) ?? null; }
  async putIntentPrivateData(id: string, value: StoredSorobanIntentPrivateData) {
    const existing = this.values.get(id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(value)) throw new Error('private mismatch');
    this.values.set(id, value);
  }
}

function intent(): SorobanIntent {
  return {
    version: 1,
    network: 'testnet',
    hostFunctionXdr: 'AAAA',
    intentDigest: INTENT_DIGEST,
  };
}

function plan(digest: string): SorobanAuthorizationPlan {
  return {
    version: 1,
    network: 'testnet',
    intentDigest: INTENT_DIGEST,
    authorizationPlanDigest: digest,
    authorizationEntriesXdr: [],
    effects: emptySorobanEffectsSnapshot(),
    executionBinding: 'detached',
  };
}

function stored(id = 'PGINTENT00000001'): StoredSorobanIntent {
  return {
    version: 1,
    id,
    network: 'testnet',
    intent: intent(),
    authorizationPlan: plan(PLAN_ONE),
    authorizationPlanRevision: 1,
    createdAt: '2026-09-18T01:00:00.000Z',
    creatorAddress: 'GCREATOR',
    creatorActor: { type: 'service', id: 'fednetwork', label: 'FedNetwork' },
    discoverySignerKeys: ['GCREATOR', 'GSIGNER'],
    integration: {
      version: 1,
      serviceId: 'fednetwork',
      serviceLabel: 'FedNetwork',
      correlationId: 'fed-42',
    },
    executionPolicy: { mode: 'external' },
    privateContext: {
      externalReference: 'fed-42',
      initialPrivateNote: {
        version: 1,
        revisionId: 'initial',
        text: 'secret operator note',
        createdAt: '2026-09-18T01:00:00.000Z',
      },
    },
  };
}

before(async () => {
  if (!TEST_URL || !RESET_ALLOWED) return;
  const pool = coordinationPool();
  await pool.query('DROP SCHEMA IF EXISTS mst_stellar CASCADE');
  await applyCoordinationMigrations();
});

after(async () => {
  await closeCoordinationPool();
});

test('Postgres Soroban store round-trips coordination facts while private note stays out of SQL/outbox', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  const pool = coordinationPool();
  const privateStore = new MemoryPrivateStore();
  const store = createPostgresSorobanIntentStore(pool, privateStore);
  const value = stored();

  await store.createIntent(value);
  const loaded = await store.getIntent(value.id);
  assert.deepEqual(loaded, value);
  assert.deepEqual(
    (await store.listIntentsBySigner('testnet', 'GSIGNER')).map((item) => item.id),
    [value.id],
  );

  const sql = await pool.query<{ body: string }>(
    `SELECT row_to_json(i)::text AS body
       FROM mst_stellar.soroban_intents i
      WHERE id = $1`,
    [value.id],
  );
  assert.doesNotMatch(sql.rows[0]?.body ?? '', /secret operator note/);

  const outbox = await pool.query<{ payload: unknown }>(
    'SELECT payload FROM mst_stellar.integration_outbox WHERE resource_id = $1 ORDER BY created_at',
    [value.id],
  );
  assert.deepEqual(outbox.rows.map((row) => row.payload), [{ version: 1, change: 'created' }]);
  assert.doesNotMatch(JSON.stringify(outbox.rows), /secret operator note/);
});

test('AUTH, replan, executor binding and execution evidence preserve deterministic facts and outbox ids', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  const pool = coordinationPool();
  const privateStore = new MemoryPrivateStore();
  const store = createPostgresSorobanIntentStore(pool, privateStore);
  const value = stored('PGINTENT00000002');
  await store.createIntent(value);

  const contribution = {
    version: 1 as const,
    digest: 'auth-digest-1',
    entryIndex: 0,
    signerAddress: 'GSIGNER',
    signatureBase64: 'sensitive-auth-signature',
    authorizationPlanDigest: PLAN_ONE,
    authorizationPlanRevision: 1,
    receivedAt: '2026-09-18T01:01:00.000Z',
  };
  await store.putContribution(value.id, contribution);
  await store.putContribution(value.id, contribution);
  assert.deepEqual(await store.listContributions(value.id), [contribution]);

  const updated: StoredSorobanIntent = {
    ...value,
    authorizationPlan: plan(PLAN_TWO),
    authorizationPlanRevision: 2,
    authorizationPlanHistory: [{
      revision: 1,
      authorizationPlan: value.authorizationPlan,
      supersededAt: '2026-09-18T01:02:00.000Z',
    }],
    discoverySignerKeys: ['GCREATOR', 'GNEWSIGNER'],
  };
  await store.updateIntent(updated);
  const replanned = await store.getIntent(value.id);
  assert.equal(replanned?.authorizationPlanRevision, 2);
  assert.deepEqual(replanned?.discoverySignerKeys, ['GCREATOR', 'GNEWSIGNER']);

  const policy: SorobanExecutionPolicy = {
    mode: 'external',
    executor: { address: 'GEXECUTOR', source: 'service_prepare' },
  };
  assert.deepEqual(await store.bindExecutionPolicy(value.id, policy), policy);
  assert.deepEqual(await store.bindExecutionPolicy(value.id, {
    mode: 'external',
    executor: { address: 'GOTHER', source: 'service_prepare' },
  }), policy);

  const preparation = {
    version: 1 as const,
    transactionHash: TX_HASH,
    authorizationPlanDigest: PLAN_TWO,
    authorizationPlanRevision: 2,
    executionSource: 'GEXECUTOR',
    transactionSequence: '9',
    validUntil: '2026-09-18T02:00:00.000Z',
    latestLedger: 123,
    effectsDigest: emptySorobanEffectsSnapshot().digest,
    effectsAccepted: false,
    preparedAt: '2026-09-18T01:03:00.000Z',
  };
  await store.putExecutionPreparation(value.id, preparation);
  assert.deepEqual(await store.listExecutionPreparations(value.id), [preparation]);

  const observation = {
    version: 1 as const,
    transactionHash: TX_HASH,
    authorizationPlanDigest: PLAN_TWO,
    authorizationPlanRevision: 2,
    executionSource: 'GEXECUTOR',
    ledger: 456,
    successful: false,
    observedAt: '2026-09-18T01:04:00.000Z',
    networkCreatedAt: '2026-09-18T01:03:30.000Z',
  };
  await store.putExecutionObservation(value.id, observation);
  assert.deepEqual(await store.getExecutionObservation(value.id, TX_HASH), observation);
  assert.deepEqual(await store.listExecutionObservations(value.id), [observation]);

  const events = await pool.query<{ event_id: string; payload: { change: string } }>(
    `SELECT event_id, payload
       FROM mst_stellar.integration_outbox
      WHERE resource_id = $1
      ORDER BY created_at, event_id`,
    [value.id],
  );
  assert.equal(events.rows.filter((row) => row.event_id.includes('auth:')).length, 1);
  assert.doesNotMatch(JSON.stringify(events.rows), /sensitive-auth-signature/);
  assert.deepEqual(events.rows.map((row) => row.payload.change).sort(), [
    'authorization_contributed',
    'authorization_plan_revised',
    'created',
    'execution_failed',
    'execution_prepared',
    'executor_bound',
  ]);
});

test('cancellation is write-once, blocks new coordination writes, but still allows later reconciliation evidence', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  const pool = coordinationPool();
  const store = createPostgresSorobanIntentStore(pool, new MemoryPrivateStore());
  const value = stored('PGINTENT00000003');
  await store.createIntent(value);

  const cancellation = {
    version: 1 as const,
    cancelledAt: '2026-09-18T01:05:00.000Z',
    authorizationPlanDigest: PLAN_ONE,
    authorizationPlanRevision: 1,
    cancelledBy: { type: 'service' as const, id: 'fednetwork', label: 'FedNetwork' },
  };
  assert.equal((await store.cancelIntent!(value.id, cancellation)).created, true);
  assert.equal((await store.cancelIntent!(value.id, {
    ...cancellation,
    cancelledAt: '2026-09-18T01:06:00.000Z',
  })).created, false);

  await store.putContribution(value.id, {
    version: 1,
    digest: 'late-auth',
    entryIndex: 0,
    signerAddress: 'GSIGNER',
    signatureBase64: 'late',
    authorizationPlanDigest: PLAN_ONE,
    authorizationPlanRevision: 1,
    receivedAt: '2026-09-18T01:06:00.000Z',
  });
  assert.deepEqual(await store.listContributions(value.id), []);

  await store.putExecutionPreparation!(value.id, {
    version: 1,
    transactionHash: TX_HASH,
    authorizationPlanDigest: PLAN_ONE,
    authorizationPlanRevision: 1,
    executionSource: 'GEXECUTOR',
    transactionSequence: '9',
    validUntil: null,
    latestLedger: 123,
    effectsDigest: emptySorobanEffectsSnapshot().digest,
    effectsAccepted: false,
    preparedAt: '2026-09-18T01:06:00.000Z',
  });
  assert.deepEqual(await store.listExecutionPreparations!(value.id), []);

  const observation = {
    version: 1 as const,
    transactionHash: TX_HASH,
    authorizationPlanDigest: PLAN_ONE,
    authorizationPlanRevision: 1,
    executionSource: 'GEXECUTOR',
    ledger: 456,
    successful: true,
    observedAt: '2026-09-18T01:07:00.000Z',
  };
  await store.putExecutionObservation!(value.id, observation);
  assert.deepEqual(await store.getExecutionObservation!(value.id, TX_HASH), observation);

  const loaded = await store.getIntent(value.id);
  assert.equal(loaded?.cancellation?.cancelledAt, cancellation.cancelledAt);
});

test('successful execution observed before cancellation wins the cancellation race', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  const store = createPostgresSorobanIntentStore(coordinationPool(), new MemoryPrivateStore());
  const value = stored('PGINTENT00000004');
  await store.createIntent(value);
  await store.putExecutionObservation!(value.id, {
    version: 1,
    transactionHash: TX_HASH,
    authorizationPlanDigest: PLAN_ONE,
    authorizationPlanRevision: 1,
    executionSource: 'GEXECUTOR',
    ledger: 456,
    successful: true,
    observedAt: '2026-09-18T01:07:00.000Z',
  });

  await assert.rejects(
    () => store.cancelIntent!(value.id, {
      version: 1,
      cancelledAt: '2026-09-18T01:08:00.000Z',
      authorizationPlanDigest: PLAN_ONE,
      authorizationPlanRevision: 1,
    }),
    (cause: unknown) => cause instanceof SorobanIntentStoreConflictError
      && cause.code === 'intent_already_executed',
  );
});
