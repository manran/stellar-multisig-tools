import assert from 'node:assert/strict';
import test from 'node:test';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk/base';
import type { ClassicTerminalExecutionEvidence } from '../../../../packages/stellar-core/src/requestTypes.js';
import { getSigningRequestForStoredRequest } from './requestService.js';
import { reconcileClassicExecution } from './classicExecutionReconciliationService.js';
import { probeClassicExecution } from './sorobanIntentExecutionReconciliationService.js';
import type { SigningRequestStore, StoredSigningRequest, StoredSubmissionResult } from './requestStore.js';

const start = '2026-09-18T01:00:00.000Z';
const end = '2026-09-18T01:01:00.000Z';
const now = new Date('2026-09-18T01:02:00.000Z');
const epoch = (value: string) => Math.floor(Date.parse(value) / 1000);
const proof = {
  oldestLedger: 10, latestLedger: 100,
  oldestLedgerClosedAt: '2026-09-18T00:59:00.000Z',
  latestLedgerClosedAt: '2026-09-18T01:01:05.000Z',
  validAfter: start, validUntil: end, checkedAt: now.toISOString(),
};
function fixture(minTime = epoch(start)) {
  const key = Keypair.random();
  const tx = new TransactionBuilder(new Account(key.publicKey(), '1'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: key.publicKey(), asset: Asset.native(), amount: '1' }))
    .setTimebounds(minTime, epoch(end)).build();
  const request: StoredSigningRequest = {
    version: 1, id: 'CLASSICRESULT001', network: 'testnet', baseXdr: tx.toXDR(),
    transactionHash: Buffer.from(tx.hash()).toString('hex'),
    createdAt: start, expiresAt: end, integration: { version: 1, serviceId: 'receipt-test' },
    executionPolicy: { mode: 'external' },
  };
  let submission: StoredSubmissionResult | null = null;
  let evidence: ClassicTerminalExecutionEvidence | null = null;
  const store: SigningRequestStore = {
    async createRequest() {}, async getRequest() { return request; },
    async listContributions() { return []; }, async putContribution() {},
    async getSubmission() { return submission; },
    async putSubmission(_id, value) { submission = value; },
    async getExecutionEvidence() { return evidence; },
    async putExecutionEvidence(_id, value) { evidence = value; },
  };
  return { request, store, tx, key };
}
const missing = async () => null;
const unavailable = async (): Promise<never> => { throw new Error('offline'); };

test('Classic missing hash and expired Request are not evidence of non-inclusion', async () => {
  const { request, store } = fixture();
  const result = await reconcileClassicExecution(store, request, { now, transactionLoader: missing, rpcProbe: unavailable });
  assert.equal(result.outcome, 'unknown');
  assert.equal(result.observed, false);
  assert.equal(await store.getExecutionEvidence!(request.id), null);
  assert.equal(await store.getSubmission(request.id, request.transactionHash), null);
  assert.equal((await getSigningRequestForStoredRequest(store, request, { now, transactionLoader: missing })).executionOutcome?.outcome, 'unknown');
});

test('Classic imported envelope with unbounded start cannot prove non-inclusion', async () => {
  const { request, store } = fixture(0);
  const result = await reconcileClassicExecution(store, request, { now, transactionLoader: missing, rpcProbe: async () => ({ proof }) });
  assert.equal(result.outcome, 'unknown');
});

test('Classic proven non-inclusion is durable and replayable without a network call', async () => {
  const { request, store } = fixture();
  const result = await reconcileClassicExecution(store, request, { now, transactionLoader: missing, rpcProbe: async () => ({ proof }) });
  assert.equal(result.outcome, 'not_included');
  assert.deepEqual(result.outcome === 'not_included' && result.nonInclusionProof, proof);
  assert.equal(result.replayed, false);
  const replay = await reconcileClassicExecution(store, request, { now, transactionLoader: unavailable, rpcProbe: unavailable });
  assert.deepEqual(replay, { ...result, replayed: true });
  const snapshot = await getSigningRequestForStoredRequest(store, request, { now, transactionLoader: unavailable, accountLoader: unavailable });
  assert.equal(snapshot.status, 'expired');
  assert.equal(snapshot.statusReason, 'execution_not_included');
  assert.equal(snapshot.submission, undefined);
  assert.equal(snapshot.executionOutcome?.outcome, 'not_included');
});

for (const successful of [true, false]) {
  test('Classic observed ' + (successful ? 'success' : 'failure') + ' persists exact receipt, including a fee bump hash', async () => {
    const { request, store } = fixture();
    const receipt = { hash: request.transactionHash, ledger: 100, successful, createdAt: now.toISOString(), ledgerTransactionHash: 'b'.repeat(64) };
    const result = await reconcileClassicExecution(store, request, { now, transactionLoader: async () => receipt, rpcProbe: unavailable });
    assert.equal(result.outcome, successful ? 'successful' : 'failed');
    assert.equal(result.observed, true);
    assert.equal(result.observed && result.observation.successful, successful);
    assert.equal(result.observed && result.observation.ledgerTransactionHash, receipt.ledgerTransactionHash);
    assert.deepEqual(await reconcileClassicExecution(store, request, { now, transactionLoader: unavailable, rpcProbe: unavailable }), { ...result, replayed: true });
    const snapshot = await getSigningRequestForStoredRequest(store, request, { now, transactionLoader: unavailable, accountLoader: unavailable });
    assert.equal(snapshot.status, successful ? 'submitted' : 'blocked');
    assert.equal(snapshot.executionOutcome?.outcome, result.outcome);
    assert.equal(Boolean(snapshot.submission), successful);
  });
}

test('Classic RPC non-inclusion requires coverage before and after hash lookup', async () => {
  const { request } = fixture();
  const base = { oldestLedger: 10, latestLedger: 100, oldestLedgerCloseTime: epoch(proof.oldestLedgerClosedAt), latestLedgerCloseTime: epoch(proof.latestLedgerClosedAt) };
  for (const [health, lookup, expected] of [
    [{}, {}, true],
    [{ latestLedgerCloseTime: epoch(end) }, {}, false],
    [{ oldestLedgerCloseTime: epoch(start) }, {}, false],
    [{}, { oldestLedgerCloseTime: epoch(start) + 1 }, false],
    [{}, { oldestLedgerCloseTime: undefined }, false],
    [{ status: 'unhealthy' }, {}, false],
    [{}, { latestLedger: 99 }, false],
  ] as const) {
    const methods: string[] = [];
    const fake: typeof fetch = async (_url, init) => {
      const method = JSON.parse(String(init?.body)).method;
      methods.push(method);
      return Response.json({ result: method === 'getHealth' ? { ...base, status: 'healthy', ...health } : { ...base, status: 'NOT_FOUND', ...lookup } });
    };
    const result = await probeClassicExecution(request.transactionHash, 'testnet', start, end, fake, now);
    assert.deepEqual(methods, ['getHealth', 'getTransaction']);
    assert.equal(Boolean(result.proof), expected, JSON.stringify({ health, lookup }));
    if (expected) assert.deepEqual(result.proof, proof);
  }
});

test('Classic RPC verifies the exact inner hash of a fee bump and rejects unrelated envelopes', async () => {
  const { request, tx, key } = fixture();
  tx.sign(key);
  const bumped = TransactionBuilder.buildFeeBumpTransaction(key.publicKey(), '1000', tx, Networks.TESTNET);
  bumped.sign(key);
  const fake: typeof fetch = async (_url, init) => {
    const method = JSON.parse(String(init?.body)).method;
    return Response.json({ result: method === 'getHealth' ? { status: 'healthy' } : { status: 'SUCCESS', envelopeXdr: bumped.toXDR(), ledger: 100, createdAt: epoch(now.toISOString()) } });
  };
  const result = await probeClassicExecution(request.transactionHash, 'testnet', start, end, fake, now);
  assert.equal(result.receipt?.hash, request.transactionHash);
  assert.equal(result.receipt?.ledgerTransactionHash, Buffer.from(bumped.hash()).toString('hex'));
  await assert.rejects(probeClassicExecution('a'.repeat(64), 'testnet', start, end, fake, now), /Inconsistent/);
});

test('expired external work stays visible until actual terminal evidence, without demanding a new signature', async () => {
  const { request, store, key } = fixture();
  const record = { ...request, id: '0'.repeat(16) };
  const { listSignerInbox, projectHumanInboxRequests } = await import('./requestInbox.js');
  const { projectClassicAgentTask } = await import('./agentTaskProjection.js');
  const { projectIntegrationClassicJob } = await import('./integrationClassicJobProjection.js');
  const address = key.publicKey();
  const accountLoader = async () => ({ accountId: address, sequence: '1', subentryCount: 0, numSponsoring: 0, numSponsored: 0,
    nativeBalance: '100', nativeSellingLiabilities: '0', balances: [], thresholds: { low: 1, medium: 1, high: 1 },
    signers: [{ key: address, type: 'ed25519_public_key' as const, weight: 1 }] });
  const inboxStore = { ...store, listRequests: async () => [record], getRequest: async () => record };
  const options = { network: 'testnet' as const, now, accountLoader };
  const visible = await listSignerInbox(inboxStore, address, options);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].executionOutcome?.outcome, 'unknown');
  assert.equal((await projectHumanInboxRequests(inboxStore, address, visible))[0].viewerAction, 'execution_unknown');
  const task = projectClassicAgentTask({ request: visible[0], credentialAccess: 'sign', hasSigned: false });
  assert.equal(task.state, 'execution_unknown');
  assert.equal(task.signatureRequired, false);
  assert.deepEqual(task.nextActions, []);
  const job = projectIntegrationClassicJob(visible[0]);
  assert.equal(job.state, 'execution_unknown');
  assert.deepEqual(job.nextActions, ['reconcile_execution']);
  assert.deepEqual(await listSignerInbox(inboxStore, Keypair.random().publicKey(), options), []);
  const ordinary = { ...record, executionPolicy: undefined, integration: undefined };
  assert.deepEqual(await listSignerInbox({ ...inboxStore, listRequests: async () => [ordinary] }, address, options), []);
  const result = await reconcileClassicExecution(store, request, { now, transactionLoader: missing, rpcProbe: async () => ({ proof }) });
  assert.equal(result.outcome, 'not_included');
  assert.deepEqual(await listSignerInbox(inboxStore, address, options), []);
});
