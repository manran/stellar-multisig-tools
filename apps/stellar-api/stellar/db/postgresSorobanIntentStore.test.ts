import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Address, Contract, Keypair, xdr } from '@stellar/stellar-sdk/base';
import type { SorobanExecutionPolicy } from '../../../../packages/stellar-core/src/executionPolicy.js';
import { emptySorobanEffectsSnapshot } from '../../../../packages/stellar-core/src/sorobanEffects.js';
import type { SorobanAuthorizationPlan } from '../../../../packages/stellar-core/src/sorobanAuthorizationPlan.js';
import type { SorobanIntent } from '../../../../packages/stellar-core/src/sorobanIntent.js';
import { applyCoordinationMigrations } from './migrate.js';
import { closeCoordinationPool, coordinationPool } from './postgres.js';
import { createPostgresSorobanIntentStore } from './postgresSorobanIntentStore.js';
import { listSorobanIntentActivityItems } from '../server/sorobanIntentActivity.js';
import { listSorobanIntentInbox } from '../server/sorobanIntentInbox.js';
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

test('authorizer subject backfill discovers a replacement live signer and preserves accepted input identity', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  const store = createPostgresSorobanIntentStore(coordinationPool(), new MemoryPrivateStore());
  const account = Keypair.random().publicKey(), oldSigner = Keypair.random().publicKey(), replacement = Keypair.random().publicKey();
  const contract = new Contract('CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE');
  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(new xdr.SorobanAddressCredentials({
      address: new Address(account).toScAddress(), nonce: xdr.Int64(42n), signatureExpirationLedger: 1000, signature: xdr.ScVal.scvVoid(),
    })),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({
        contractAddress: contract.address().toScAddress(), functionName: 'reserve', args: [],
      })), subInvocations: [],
    }),
  });
  const value = { ...stored('PGINTENT00000007'), discoverySignerKeys: [oldSigner],
    authorizationPlan: { ...plan(PLAN_ONE), authorizationEntriesXdr: [entry.toXdr('base64')] }, creationInputHash: 'e'.repeat(64) };
  await store.createIntent(value);
  const pool = coordinationPool();
  await pool.query('UPDATE mst_stellar.soroban_intents SET authorizer_accounts = NULL WHERE id = $1', [value.id]);
  await applyCoordinationMigrations();
  const indexed = await pool.query<{ authorizer_accounts: string[] }>('SELECT authorizer_accounts FROM mst_stellar.soroban_intents WHERE id = $1', [value.id]);
  assert.deepEqual(indexed.rows[0].authorizer_accounts, [account]);
  assert.equal((await store.getIntent(value.id))?.creationInputHash, value.creationInputHash);
  const options = { sourceAccountIds: [account], accountLoader: async () => ({
    accountId: account, sequence: '1', subentryCount: 1, numSponsoring: 0, numSponsored: 0,
    thresholds: { low: 1, medium: 1, high: 1 }, signers: [{ key: replacement, type: 'ed25519_public_key' as const, weight: 1 }],
  } as never), networkParametersLoader: async () => ({ ledgerSequence: 100, ledgerClosedAt: '2026-09-18T01:00:00.000Z', baseFeeInStroops: 100, baseReserveInStroops: 5000000 }) };
  assert.equal((await listSorobanIntentInbox(store, replacement, 'testnet', options)).find((item) => item.id === value.id)?.viewerAction, 'sign');
  assert.ok(!(await listSorobanIntentInbox(store, oldSigner, 'testnet', { ...options, sourceAccountIds: [] })).some((item) => item.id === value.id));
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
  assert.ok(!(await store.listIntentsBySigner!('testnet', 'GSIGNER')).some((item) => item.id === value.id));
  const history = await listSorobanIntentActivityItems(store, 'GSIGNER', 'testnet');
  assert.ok(history.some((item) => item.intentId === value.id && item.evidence.some((event) => event.type === 'authorization_added' && event.actorAddress === 'GSIGNER')));
  assert.ok(!JSON.stringify(history).includes('sensitive-auth-signature'));

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

test('successful observation is terminal under the same parent lock used by all runtime writes', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  const store = createPostgresSorobanIntentStore(coordinationPool(), new MemoryPrivateStore());
  const value = stored('PGINTENT00000005');
  await store.createIntent(value);
  const preparation = {
    version: 1 as const, transactionHash: TX_HASH,
    authorizationPlanDigest: PLAN_ONE, authorizationPlanRevision: 1,
    executionSource: 'GEXECUTOR', transactionSequence: '9', validUntil: null,
    latestLedger: 123, effectsDigest: emptySorobanEffectsSnapshot().digest,
    effectsAccepted: false, preparedAt: '2026-09-18T01:03:00.000Z',
  };
  const revised = {
    ...value, authorizationPlanRevision: 2, authorizationPlan: plan(PLAN_TWO),
    authorizationPlanHistory: [{ revision: 1, authorizationPlan: value.authorizationPlan, supersededAt: '2026-09-18T01:04:00.000Z' }],
  };
  await store.updateIntent(revised);
  await assert.rejects(() => store.updateIntent({ ...revised, authorizationPlan: plan('e'.repeat(64)) }), { code: 'authorization_plan_changed' });
  await assert.rejects(() => store.putExecutionPreparation!(value.id, preparation), { code: 'authorization_plan_changed' });
  const historical = createPostgresSorobanIntentStore(coordinationPool(), new MemoryPrivateStore(), { historicalImport: true, emitOutbox: false });
  await historical.putExecutionPreparation!(value.id, preparation);
  // A receipt for an earlier plan must still close the business Intent.
  await store.putExecutionObservation!(value.id, {
    version: 1, transactionHash: TX_HASH, authorizationPlanDigest: PLAN_ONE,
    authorizationPlanRevision: 1, executionSource: 'GEXECUTOR', ledger: 456,
    successful: true, observedAt: '2026-09-18T01:07:00.000Z',
  });
  await assert.rejects(() => store.updateIntent(revised), { code: 'intent_already_executed' });
  await assert.rejects(() => store.putExecutionPreparation!(value.id, {
    ...preparation, authorizationPlanRevision: 2, authorizationPlanDigest: PLAN_TWO,
    transactionHash: 'e'.repeat(64),
  }), { code: 'intent_already_executed' });
  await assert.rejects(() => store.putContribution(value.id, {
    version: 1, digest: 'late-auth', entryIndex: 0, signerAddress: 'GSIGNER',
    signatureBase64: 'fixture', authorizationPlanDigest: PLAN_TWO,
    authorizationPlanRevision: 2, receivedAt: '2026-09-18T01:08:00.000Z',
  }), { code: 'intent_already_executed' });
  assert.equal((await store.listExecutionPreparations!(value.id)).length, 1);
  assert.deepEqual(await store.listContributions(value.id), []);
});

test('concurrent preparations and replanning fail closed until the previous hash is resolved', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  const store = createPostgresSorobanIntentStore(coordinationPool(), new MemoryPrivateStore());
  const value = stored('PGINTENT00000006');
  await store.createIntent(value);
  const prepared = {
    version: 1 as const, transactionHash: TX_HASH,
    authorizationPlanDigest: PLAN_ONE, authorizationPlanRevision: 1,
    executionSource: 'GEXECUTOR', transactionSequence: '9', validUntil: '2026-09-18T02:00:00.000Z',
    latestLedger: 123, effectsDigest: emptySorobanEffectsSnapshot().digest,
    effectsAccepted: false, preparedAt: '2026-09-18T01:03:00.000Z',
  };
  const attempts = await Promise.allSettled([
    store.putExecutionPreparation!(value.id, prepared),
    store.putExecutionPreparation!(value.id, { ...prepared, transactionHash: 'b'.repeat(64) }),
  ]);
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = attempts.find((result) => result.status === 'rejected');
  assert.equal(rejected?.reason.code, 'intent_execution_outcome_unknown');
  const [first] = await store.listExecutionPreparations!(value.id);
  const lateContribution = { version: 1 as const, digest: 'unresolved-auth', entryIndex: 0, signerAddress: 'GSIGNER',
    signatureBase64: 'fixture', authorizationPlanDigest: PLAN_ONE, authorizationPlanRevision: 1, receivedAt: '2026-09-18T01:03:01.000Z' };
  await assert.rejects(() => store.putContribution(value.id, lateContribution), { code: 'intent_execution_outcome_unknown' });
  const revised = {
    ...value, authorizationPlanRevision: 2, authorizationPlan: plan(PLAN_TWO),
    authorizationPlanHistory: [{ revision: 1, authorizationPlan: value.authorizationPlan, supersededAt: '2026-09-18T01:04:00.000Z' }],
  };
  await assert.rejects(() => store.updateIntent(revised), { code: 'intent_execution_outcome_unknown' });
  const proof = { oldestLedger: 123, latestLedger: 500, latestLedgerClosedAt: '2026-09-18T02:00:05.000Z', checkedAt: '2026-09-18T02:00:06.000Z' };
  await assert.rejects(() => store.recordExecutionNonInclusion!(value.id, first.transactionHash, { ...proof, oldestLedger: 124 }), { code: 'intent_execution_outcome_unknown' });
  await assert.rejects(() => store.recordExecutionNonInclusion!(value.id, first.transactionHash, { ...proof, latestLedgerClosedAt: prepared.validUntil }), { code: 'intent_execution_outcome_unknown' });
  await store.recordExecutionNonInclusion!(value.id, first.transactionHash, proof);
  assert.deepEqual((await store.listExecutionPreparations!(value.id))[0].nonInclusionProof, proof);
  assert.deepEqual(await store.listExecutionObservations!(value.id), []);
  await store.updateIntent(revised);
  await assert.rejects(() => store.putContribution(value.id, lateContribution), { code: 'authorization_plan_changed' });
  await store.putExecutionPreparation!(value.id, { ...prepared, authorizationPlanRevision: 2, authorizationPlanDigest: PLAN_TWO, transactionHash: 'e'.repeat(64), preparedAt: '2026-09-18T02:01:00.000Z' });
  assert.equal((await store.listExecutionPreparations!(value.id)).length, 2);
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

test('Postgres cancellation cannot race a released unresolved execution', { skip: !TEST_URL || !RESET_ALLOWED }, async () => {
  const store = createPostgresSorobanIntentStore(coordinationPool(), new MemoryPrivateStore());
  const value = stored('PGINTENT00000091');
  await store.createIntent(value);
  await store.putExecutionPreparation!(value.id, {
    version: 1, transactionHash: TX_HASH, authorizationPlanDigest: PLAN_ONE,
    authorizationPlanRevision: 1, executionSource: 'GEXECUTOR', transactionSequence: '9',
    validUntil: '2026-09-18T01:04:00.000Z', latestLedger: 123,
    effectsDigest: emptySorobanEffectsSnapshot().digest, effectsAccepted: false,
    preparedAt: '2026-09-18T01:03:00.000Z',
  });
  const cancel = { version: 1 as const, cancelledAt: '2026-09-18T01:05:00.000Z',
    authorizationPlanDigest: PLAN_ONE, authorizationPlanRevision: 1 };
  await assert.rejects(() => store.cancelIntent!(value.id, cancel),
    (cause: unknown) => cause instanceof SorobanIntentStoreConflictError && cause.code === 'intent_execution_outcome_unknown');
  assert.equal((await store.getIntent(value.id))?.cancellation, undefined);
  await store.putExecutionObservation!(value.id, { version: 1, transactionHash: TX_HASH,
    authorizationPlanDigest: PLAN_ONE, authorizationPlanRevision: 1, executionSource: 'GEXECUTOR',
    ledger: 124, successful: false, observedAt: '2026-09-18T01:04:00.000Z' });
  assert.equal((await store.cancelIntent!(value.id, cancel)).created, true);
});
