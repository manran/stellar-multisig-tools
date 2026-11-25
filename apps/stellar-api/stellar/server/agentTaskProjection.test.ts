import assert from 'node:assert/strict';
import test from 'node:test';
import type { SigningRequestSnapshot } from '../../../../packages/stellar-core/src/requestTypes.js';
import type { SorobanIntentAuthorizationSnapshot } from './sorobanIntentAuthorizationService.js';
import type { StoredSorobanIntent } from './sorobanIntentStore.js';
import {
  projectClassicAgentTask,
  projectSorobanAgentTask,
} from './agentTaskProjection.js';

const PRINCIPAL = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const OTHER = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBW4';
const DIGEST = 'a'.repeat(64);

function classic(status: SigningRequestSnapshot['status']): SigningRequestSnapshot {
  return {
    id: '0123456789ABCDEF', network: 'testnet', transactionHash: DIGEST,
    baseXdr: 'AAAA', mergedXdr: 'AAAA', createdAt: '2026-09-17T00:00:00.000Z',
    expiresAt: '2026-09-18T00:00:00.000Z', contributionCount: 0, signatureCount: 0,
    status, statusReason: status === 'awaiting_signatures' ? 'signatures_required' : 'authorization_complete',
  };
}

function stored(integration = false, creator = false): StoredSorobanIntent {
  return {
    version: 1, id: 'FEDTASK000000001', network: 'testnet', createdAt: '2026-09-17T00:00:00.000Z',
    intent: { version: 1, network: 'testnet', hostFunctionXdr: 'AAAA', intentDigest: DIGEST },
    authorizationPlan: { authorizationPlanDigest: DIGEST } as StoredSorobanIntent['authorizationPlan'],
    discoverySignerKeys: [PRINCIPAL],
    ...(creator ? { creatorAddress: PRINCIPAL } : {}),
    ...(integration ? { integration: { version: 1, serviceId: 'fednetwork' } } : {}),
  };
}
function authorization(
  status: SorobanIntentAuthorizationSnapshot['status'],
  signed = false,
): SorobanIntentAuthorizationSnapshot {
  return {
    id: 'FEDTASK000000001', network: 'testnet', intentDigest: DIGEST,
    authorizationPlanDigest: DIGEST, executionBinding: 'detached', status,
    authorizationEntriesXdr: [], contributionCount: signed ? 1 : 0,
    authorizers: [{
      entryIndex: 0, authorizer: OTHER, credentialType: 'address', expirationLedger: 500,
      threshold: 1, signedWeight: signed ? 1 : 0,
      signerEvidence: signed ? [{ publicKey: PRINCIPAL, weight: 1 }] : [],
      activeSigners: [{ publicKey: PRINCIPAL, weight: 1 }], ready: signed,
    }],
  };
}

test('Read Agent can discover a pending signature without an executable task', () => {
  const task = projectClassicAgentTask({
    request: classic('awaiting_signatures'), credentialAccess: 'read', hasSigned: false,
  });
  assert.equal(task.state, 'waiting');
  assert.equal(task.signatureRequired, true);
  assert.deepEqual(task.nextActions, [
    { code: 'contribute_signature', requiredAccess: 'sign', available: false },
    { code: 'decline', requiredAccess: 'write', available: false },
  ]);
});

test('Classic Agent Task reports Principal action separately from credential capability', () => {
  const task = projectClassicAgentTask({
    request: classic('awaiting_signatures'), credentialAccess: 'write', hasSigned: false,
  });
  assert.equal(task.state, 'action_required');
  assert.equal(task.signatureRequired, true);
  assert.deepEqual(task.nextActions, [
    { code: 'contribute_signature', requiredAccess: 'sign', available: false },
    { code: 'decline', requiredAccess: 'write', available: true },
  ]);
});

test('Sign Agent can act on a pending signature', () => {
  const task = projectClassicAgentTask({
    request: classic('awaiting_signatures'), credentialAccess: 'sign', hasSigned: false,
  });
  assert.equal(task.state, 'action_required');
  assert.equal(task.signatureRequired, true);
  assert.equal(task.nextActions.find((item) => item.code === 'contribute_signature')?.available, true);
});

test('Classic Agent Task does not notify a signer who declined', () => {
  const task = projectClassicAgentTask({
    request: classic('awaiting_signatures'), credentialAccess: 'read', hasSigned: false, declined: true,
  });
  assert.equal(task.state, 'waiting');
  assert.equal(task.signatureRequired, false);
  assert.deepEqual(task.nextActions, []);
});

test('Classic Agent Task waits after this Principal has already signed', () => {
  const task = projectClassicAgentTask({
    request: classic('awaiting_signatures'), credentialAccess: 'sign', hasSigned: true,
  });
  assert.equal(task.state, 'waiting');
  assert.equal(task.signatureRequired, false);
  assert.deepEqual(task.nextActions, []);
});
test('Classic Agent Task projects confirmed submission as completed', () => {
  const request = {
    ...classic('submitted'),
    statusReason: 'ledger_confirmed' as const,
    submission: { transactionHash: DIGEST, ledger: 42, submittedAt: '2026-09-17T00:01:00.000Z' },
  };
  const task = projectClassicAgentTask({ request, credentialAccess: 'read', hasSigned: true });
  assert.equal(task.state, 'completed');
  assert.equal(task.signatureRequired, false);
  assert.deepEqual(task.result, { transactionHash: DIGEST, ledger: 42, successful: true });
});

test('Soroban Agent Task exposes required Sign access without granting it', () => {
  const task = projectSorobanAgentTask({
    stored: stored(), authorization: authorization('awaiting_authorization'),
    credentialAccess: 'read', principalAddress: PRINCIPAL,
  });
  assert.equal(task.state, 'waiting');
  assert.equal(task.signatureRequired, true);
  assert.deepEqual(task.waitingFor, [OTHER]);
  assert.deepEqual(task.nextActions, [
    { code: 'contribute_authorization', requiredAccess: 'sign', available: false },
  ]);
});

test('Soroban Sign Agent sees an executable authorization task', () => {
  const task = projectSorobanAgentTask({
    stored: stored(), authorization: authorization('awaiting_authorization'),
    credentialAccess: 'sign', principalAddress: PRINCIPAL,
  });
  assert.equal(task.state, 'action_required');
  assert.equal(task.signatureRequired, true);
  assert.equal(task.nextActions[0]?.available, true);
});

test('Soroban Agent Task tells a Write Agent to prepare after authorization', () => {
  const task = projectSorobanAgentTask({
    stored: stored(), authorization: authorization('authorization_ready', true),
    credentialAccess: 'write', principalAddress: PRINCIPAL,
  });
  assert.equal(task.state, 'action_required');
  assert.equal(task.signatureRequired, false);
  assert.deepEqual(task.nextActions, [
    { code: 'prepare_execution', requiredAccess: 'write', available: true },
  ]);
});
test('Soroban Agent Task refreshes a stale prepared package instead of suggesting submit', () => {
  const task = projectSorobanAgentTask({
    stored: stored(), authorization: authorization('authorization_ready', true),
    credentialAccess: 'write', principalAddress: PRINCIPAL,
    preparations: [{
      version: 1, transactionHash: DIGEST, authorizationPlanDigest: DIGEST,
      authorizationPlanRevision: 1, executionSource: PRINCIPAL, transactionSequence: '1',
      validUntil: '2026-09-17T00:01:00.000Z', latestLedger: 10, effectsDigest: DIGEST,
      effectsAccepted: true, preparedAt: '2026-09-17T00:00:30.000Z',
    }],
    now: new Date('2026-09-17T00:02:00.000Z'),
  });
  assert.equal(task.state, 'action_required');
  assert.deepEqual(task.nextActions, [
    { code: 'refresh_execution', requiredAccess: 'write', available: true },
  ]);
});

test('creator Agent gets explicit cancellation as a write action', () => {
  const task = projectSorobanAgentTask({
    stored: stored(false, true), authorization: authorization('awaiting_authorization'),
    credentialAccess: 'write', principalAddress: PRINCIPAL,
  });
  assert.equal(task.state, 'action_required');
  assert.deepEqual(task.nextActions, [
    { code: 'contribute_authorization', requiredAccess: 'sign', available: false },
    { code: 'cancel', requiredAccess: 'write', available: true },
  ]);
});

test('cancelled Soroban Agent Task is terminal', () => {
  const value = stored(false, true);
  value.cancellation = {
    version: 1,
    cancelledAt: '2026-09-17T00:02:00.000Z',
    authorizationPlanDigest: DIGEST,
    authorizationPlanRevision: 1,
    cancelledByAddress: PRINCIPAL,
  };
  const task = projectSorobanAgentTask({
    stored: value, authorization: authorization('cancelled'),
    credentialAccess: 'write', principalAddress: PRINCIPAL,
  });
  assert.equal(task.state, 'cancelled');
  assert.deepEqual(task.nextActions, []);
});

test('Integration-owned Soroban work does not make a signer Agent its executor', () => {
  const task = projectSorobanAgentTask({
    stored: stored(true), authorization: authorization('authorization_ready', true),
    credentialAccess: 'sign', principalAddress: PRINCIPAL,
  });
  assert.equal(task.state, 'waiting');
  assert.deepEqual(task.nextActions, []);
});
test('expired Integration Intent does not offer a signer Agent an Integration-only action', () => {
  for (const credentialAccess of ['read', 'write', 'sign'] as const) {
    const task = projectSorobanAgentTask({
      stored: stored(true), authorization: authorization('expired'),
      credentialAccess, principalAddress: PRINCIPAL,
    });
    assert.equal(task.state, 'expired');
    assert.equal(task.signatureRequired, false);
    assert.deepEqual(task.nextActions, []);
  }
});

test('creator Agent waiting on others can cancel without falsely reporting a pending signature', () => {
  const auth = authorization('awaiting_authorization');
  auth.authorizers[0].activeSigners = [{ publicKey: OTHER, weight: 1 }];
  const task = projectSorobanAgentTask({
    stored: stored(false, true), authorization: auth,
    credentialAccess: 'write', principalAddress: PRINCIPAL,
  });
  assert.equal(task.state, 'action_required');
  assert.equal(task.signatureRequired, false);
  assert.deepEqual(task.nextActions, [{ code: 'cancel', requiredAccess: 'write', available: true }]);
});

test('Soroban Agent Task projects observed result without asking the Agent to interpret evidence', () => {
  const task = projectSorobanAgentTask({
    stored: stored(), authorization: authorization('authorization_ready', true),
    credentialAccess: 'read', principalAddress: PRINCIPAL,
    observations: [{
      version: 1, transactionHash: DIGEST, authorizationPlanDigest: DIGEST,
      authorizationPlanRevision: 1, executionSource: PRINCIPAL, ledger: 77,
      successful: true, observedAt: '2026-09-17T00:03:00.000Z',
    }],
  });
  assert.equal(task.state, 'completed');
  assert.deepEqual(task.result, { transactionHash: DIGEST, ledger: 77, successful: true });
  assert.deepEqual(task.nextActions, []);
});