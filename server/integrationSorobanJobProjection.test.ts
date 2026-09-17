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
  assert.deepEqual(job.nextActions, []);
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
  assert.deepEqual(job.nextActions, ['prepare_execution']);
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
  assert.deepEqual(job.nextActions, ['submit_execution', 'reconcile_execution', 'refresh_execution']);
  assert.deepEqual(job.execution, {
    owner: 'external_service',
    executor: 'GEXECUTOR',
    transactionHash: 'c'.repeat(64),
    preparedAt: '2026-09-17T00:10:00.000Z',
    validUntil: '2026-09-17T01:00:00.000Z',
  });
});

test('ignores stale preparation evidence from an older AuthorizationPlan revision', () => {
  const job = projectIntegrationSorobanJob({
    stored: stored({ authorizationPlanRevision: 2, authorizationPlan: { authorizationPlanDigest: 'f'.repeat(64) } as StoredSorobanIntent['authorizationPlan'] }),
    authorization: { ...authorization('authorization_ready'), authorizationPlanDigest: 'f'.repeat(64) },
    preparations: [preparation(1)],
    reviewUrl: REVIEW_URL,
  });
  assert.equal(job.state, 'ready');
  assert.equal(job.execution, undefined);
});

test('stale execution package returns to ready with refresh as the only safe action', () => {
  const job = projectIntegrationSorobanJob({
    stored: stored(),
    authorization: authorization('authorization_ready'),
    preparations: [preparation()],
    reviewUrl: REVIEW_URL,
    now: new Date('2026-09-17T02:00:00.000Z'),
  });
  assert.equal(job.state, 'ready');
  assert.deepEqual(job.nextActions, ['refresh_execution']);
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
test('projects expiry as an explicit replan action', () => {
  const job = projectIntegrationSorobanJob({
    stored: stored(),
    authorization: authorization('expired'),
    reviewUrl: REVIEW_URL,
  });
  assert.equal(job.state, 'expired');
  assert.deepEqual(job.nextActions, ['replan']);
});

test('projects observed execution failure without guessing a recovery action', () => {
  const job = projectIntegrationSorobanJob({
    stored: stored(),
    authorization: authorization('authorization_ready'),
    preparations: [preparation()],
    observations: [observation(false)],
    reviewUrl: REVIEW_URL,
  });
  assert.equal(job.state, 'failed');
  assert.equal(job.reason, 'execution_failed');
  assert.deepEqual(job.nextActions, []);
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
  assert.deepEqual(job.nextActions, []);
});
