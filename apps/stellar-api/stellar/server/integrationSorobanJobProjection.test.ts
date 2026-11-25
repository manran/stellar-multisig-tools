import assert from 'node:assert/strict';
import test from 'node:test';
import { projectIntegrationSorobanJob } from './integrationSorobanJobProjection.js';
import type {
  StoredSorobanIntent,
  StoredSorobanIntentExecutionObservation,
  StoredSorobanIntentExecutionPreparation,
} from './sorobanIntentStore.js';
import type { SorobanIntentAuthorizationSnapshot } from './sorobanIntentAuthorizationService.js';

const DIGEST = 'a'.repeat(64);
const REVIEW_URL = 'https://stellar-testnet.multisig.tools/a#JOB1';
const BEFORE_EXPIRY = new Date('2026-09-17T00:30:00.000Z');

function stored(overrides: Partial<StoredSorobanIntent> = {}): StoredSorobanIntent {
  return {
    version: 1,
    id: 'JOB1',
    network: 'testnet',
    intent: { version: 1, network: 'testnet', hostFunctionXdr: 'AAAA', intentDigest: 'b'.repeat(64) },
    authorizationPlan: { authorizationPlanDigest: DIGEST } as StoredSorobanIntent['authorizationPlan'],
    authorizationPlanRevision: 1,
    createdAt: '2026-09-17T00:00:00.000Z',
    discoverySignerKeys: [],
    integration: { serviceId: 'fednetwork' } as StoredSorobanIntent['integration'],
    executionPolicy: { mode: 'external' },
    ...overrides,
  };
}
function authorization(
  status: SorobanIntentAuthorizationSnapshot['status'],
): SorobanIntentAuthorizationSnapshot {
  return {
    id: 'JOB1',
    network: 'testnet',
    intentDigest: 'b'.repeat(64),
    authorizationPlanDigest: DIGEST,
    executionBinding: 'detached',
    status,
    authorizationEntriesXdr: [],
    contributionCount: 0,
    authorizers: [
      {
        entryIndex: 0,
        authorizer: 'GAUTH1',
        credentialType: 'address',
        expirationLedger: 500,
        threshold: 2,
        signedWeight: 1,
        signerEvidence: [],
        activeSigners: [],
        ready: status === 'authorization_ready',
      },
    ],
  };
}

function preparation(revision = 1): StoredSorobanIntentExecutionPreparation {
  return {
    version: 1,
    transactionHash: 'c'.repeat(64),
    authorizationPlanDigest: revision === 1 ? DIGEST : 'd'.repeat(64),
    authorizationPlanRevision: revision,
    executionSource: 'GEXECUTOR',
    transactionSequence: '42',
    validUntil: '2026-09-17T01:00:00.000Z',
    latestLedger: 450,
    effectsDigest: 'e'.repeat(64),
    effectsAccepted: true,
    preparedAt: '2026-09-17T00:10:00.000Z',
  };
}
function observation(successful: boolean): StoredSorobanIntentExecutionObservation {
  return {
    version: 1,
    transactionHash: 'c'.repeat(64),
    authorizationPlanDigest: DIGEST,
    authorizationPlanRevision: 1,
    executionSource: 'GEXECUTOR',
    ledger: 460,
    successful,
    observedAt: '2026-09-17T00:20:00.000Z',
  };
}

test('projects open authorization as a simple waiting Job', () => {
  const job = projectIntegrationSorobanJob({
    stored: stored({ privateContext: { externalReference: 'fed-42' } }),
    authorization: authorization('awaiting_authorization'),
    reviewUrl: REVIEW_URL,
  });
  assert.equal(job.state, 'waiting_for_authorization');
  assert.deepEqual(job.nextActions, ['cancel']);
  assert.deepEqual(job.waitingFor, ['GAUTH1']);
  assert.equal(job.expiresAtLedger, 500);
  assert.equal(job.externalReference, 'fed-42');
  assert.equal(job.reviewUrl, REVIEW_URL);
});

test('projects ready authorization into one explicit next action', () => {
  const job = projectIntegrationSorobanJob({
    stored: stored(),
    authorization: authorization('authorization_ready'),
    reviewUrl: REVIEW_URL,
  });
  assert.equal(job.state, 'ready');
  assert.deepEqual(job.nextActions, ['prepare_execution', 'cancel']);
});
test('legacy Intent with unavailable executor does not advertise prepare or refresh', () => {
  const job = projectIntegrationSorobanJob({ stored: stored(), authorization: authorization('authorization_ready'), reviewUrl: REVIEW_URL, executionAvailable: false });
  assert.equal(job.reason, 'execution_unavailable');
  assert.deepEqual(job.nextActions, ['cancel']);
});
test('unavailable execution never advertises rejected replan or refresh actions', () => {
  const expired = projectIntegrationSorobanJob({
    stored: stored(), authorization: authorization('expired'), reviewUrl: REVIEW_URL, executionAvailable: false,
  });
  assert.equal(expired.reason, 'execution_unavailable');
  assert.deepEqual(expired.nextActions, ['cancel']);
  const executing = projectIntegrationSorobanJob({
    stored: stored(), authorization: authorization('authorization_ready'), preparations: [preparation()],
    reviewUrl: REVIEW_URL, executionAvailable: false, now: BEFORE_EXPIRY,
  });
  assert.equal(executing.reason, 'execution_outcome_unknown');
  assert.deepEqual(executing.nextActions, ['reconcile_execution', 'cancel']);
});
test('projects a current execution package as executing', () => {
  const job = projectIntegrationSorobanJob({
    stored: stored({ executionPolicy: { mode: 'external', executor: { address: 'GEXECUTOR', source: 'service_default' } } }),
    authorization: authorization('authorization_ready'),
    preparations: [preparation()],
    reviewUrl: REVIEW_URL,
    now: BEFORE_EXPIRY,
  });
  assert.equal(job.state, 'executing');
  assert.deepEqual(job.nextActions, ['submit_execution', 'reconcile_execution', 'cancel']);
  assert.deepEqual(job.execution, {
    owner: 'external_service',
    executor: 'GEXECUTOR',
    transactionHash: 'c'.repeat(64),
    preparedAt: '2026-09-17T00:10:00.000Z',
    validUntil: '2026-09-17T01:00:00.000Z',
  });
});

test('retains unresolved preparation evidence from an older AuthorizationPlan revision', () => {
  const job = projectIntegrationSorobanJob({
    stored: stored({ authorizationPlanRevision: 2, authorizationPlan: { authorizationPlanDigest: 'f'.repeat(64) } as StoredSorobanIntent['authorizationPlan'] }),
    authorization: { ...authorization('authorization_ready'), authorizationPlanDigest: 'f'.repeat(64) },
    preparations: [preparation(1)],
    reviewUrl: REVIEW_URL,
  });
  assert.equal(job.state, 'execution_unknown');
  assert.deepEqual(job.nextActions, ['reconcile_execution', 'cancel']);
  assert.deepEqual(job.unresolvedTransactionHashes, ['c'.repeat(64)]);
});

test('elapsed execution package must be reconciled before refresh', () => {
  const job = projectIntegrationSorobanJob({
    stored: stored(),
    authorization: authorization('authorization_ready'),
    preparations: [preparation()],
    reviewUrl: REVIEW_URL,
    now: new Date('2026-09-17T02:00:00.000Z'),
  });
  assert.equal(job.state, 'execution_unknown');
  assert.deepEqual(job.nextActions, ['reconcile_execution', 'cancel']);
  const cleared = projectIntegrationSorobanJob({
    stored: stored(), authorization: authorization('authorization_ready'),
    preparations: [{ ...preparation(), nonInclusionProof: { oldestLedger: 1, latestLedger: 500, latestLedgerClosedAt: '2026-09-17T02:00:00.000Z', checkedAt: '2026-09-17T02:00:01.000Z' } }],
    reviewUrl: REVIEW_URL, now: new Date('2026-09-17T02:00:02.000Z'),
  });
  assert.equal(cleared.state, 'ready');
  assert.deepEqual(cleared.nextActions, ['refresh_execution', 'cancel']);
});

test('projects confirmed execution into a compact result', () => {
  const job = projectIntegrationSorobanJob({
    stored: stored(),
    authorization: authorization('authorization_ready'),
    preparations: [preparation()],
    observations: [observation(true)],
    reviewUrl: REVIEW_URL,
  });
  assert.equal(job.state, 'completed');
  assert.deepEqual(job.nextActions, []);
  assert.deepEqual(job.result, { transactionHash: 'c'.repeat(64), ledger: 460, successful: true });
});
test('a late receipt for any prior revision wins over later failure or authorization expiry', () => {
  const job = projectIntegrationSorobanJob({
    stored: stored({ authorizationPlanRevision: 2, authorizationPlan: { authorizationPlanDigest: 'd'.repeat(64) } as StoredSorobanIntent['authorizationPlan'] }),
    authorization: authorization('expired'),
    preparations: [preparation(1), { ...preparation(2), transactionHash: 'e'.repeat(64) }],
    observations: [observation(true), { ...observation(false), authorizationPlanRevision: 2, authorizationPlanDigest: 'd'.repeat(64), transactionHash: 'e'.repeat(64), observedAt: '2026-09-17T00:30:00.000Z' }],
    reviewUrl: REVIEW_URL,
  });
  assert.equal(job.state, 'completed');
  assert.deepEqual(job.nextActions, []);
  assert.equal(job.result?.successful, true);
  assert.equal(job.execution?.transactionHash, job.result?.transactionHash);
});

test('projects expiry as an explicit replan action', () => {
  const job = projectIntegrationSorobanJob({
    stored: stored(),
    authorization: authorization('expired'),
    reviewUrl: REVIEW_URL,
  });
  assert.equal(job.state, 'expired');
  assert.deepEqual(job.nextActions, ['replan', 'cancel']);
});

test('projects verified execution failure with safe refresh', () => {
  const job = projectIntegrationSorobanJob({
    stored: stored(),
    authorization: authorization('authorization_ready'),
    preparations: [preparation()],
    observations: [observation(false)],
    reviewUrl: REVIEW_URL,
  });
  assert.equal(job.state, 'failed');
  assert.equal(job.reason, 'execution_failed');
  assert.deepEqual(job.nextActions, ['refresh_execution', 'cancel']);
});

test('managed execution does not tell an external Service to submit', () => {
  const job = projectIntegrationSorobanJob({
    stored: stored({ executionPolicy: { mode: 'external', executor: { address: 'GEXECUTOR', source: 'multisigtools_managed' } } }),
    authorization: authorization('authorization_ready'),
    preparations: [preparation()],
    reviewUrl: REVIEW_URL,
    now: BEFORE_EXPIRY,
  });
  assert.equal(job.state, 'executing');
  assert.equal(job.execution?.owner, 'multisigtools');
  assert.deepEqual(job.nextActions, ['reconcile_execution', 'cancel']);
});

test('cancelled Integration work allows only reconciliation of released execution', () => {
  const job = projectIntegrationSorobanJob({
    stored: stored({
      cancellation: {
        version: 1,
        cancelledAt: '2026-09-17T00:25:00.000Z',
        authorizationPlanDigest: DIGEST,
        authorizationPlanRevision: 1,
        cancelledBy: { type: 'service', id: 'fednetwork' },
      },
    }),
    authorization: authorization('cancelled'),
    preparations: [preparation()],
    reviewUrl: REVIEW_URL,
    now: BEFORE_EXPIRY,
  });
  assert.equal(job.state, 'cancelled');
  assert.deepEqual(job.nextActions, ['reconcile_execution']);
  assert.equal(job.execution?.transactionHash, 'c'.repeat(64));
});
