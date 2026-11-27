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
    { code: 'contribute_signature', operationId: 'proposal.contribute', requiredInputs: ['signedXdr'], requiredAccess: 'sign', available: false },
    { code: 'decline', operationId: 'proposal.decline', bodyDefaults: { decision: 'decline' }, requiredAccess: 'write', available: false },
  ]);
});

test('Classic Agent Task reports Principal action separately from credential capability', () => {
  const task = projectClassicAgentTask({
    request: classic('awaiting_signatures'), credentialAccess: 'write', hasSigned: false,
  });
  assert.equal(task.state, 'action_required');
  assert.equal(task.signatureRequired, true);
  assert.deepEqual(task.nextActions, [
    { code: 'contribute_signature', operationId: 'proposal.contribute', requiredInputs: ['signedXdr'], requiredAccess: 'sign', available: false },
    { code: 'decline', operationId: 'proposal.decline', bodyDefaults: { decision: 'decline' }, requiredAccess: 'write', available: true },
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

test('Classic Agent Task exposes optional reconsideration without a mandatory signature demand', () => {
  const task = projectClassicAgentTask({
    request: classic('awaiting_signatures'), credentialAccess: 'read', hasSigned: false, declined: true,
  });
  assert.equal(task.state, 'waiting');
  assert.equal(task.signatureRequired, false);
  assert.deepEqual(task.nextActions, [{ code: 'contribute_signature', operationId: 'proposal.contribute', requiredInputs: ['signedXdr'], requiredAccess: 'sign', available: false, reviewRequired: true }]);
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
    { code: 'contribute_authorization', operationId: 'contract.intent.contribute', requiredInputs: ['entryIndex', 'signatureBase64'], requiredAccess: 'sign', available: false },
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
    { code: 'prepare_execution', operationId: 'contract.intent.execution.prepare', bodyDefaults: { action: 'prepare_execution' }, requiredInputs: ['executor'], requiredAccess: 'write', available: true },
  ]);
});
test('Soroban Agent Task reconciles a stale prepared package before refresh', () => {
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
    { code: 'reconcile_execution', operationId: 'contract.intent.execution.reconcile', bodyDefaults: { action: 'reconcile_execution', transactionHash: DIGEST }, requiredAccess: 'write', available: true },
  ]);
});

test('creator Agent gets explicit cancellation as a write action', () => {
  const task = projectSorobanAgentTask({
    stored: stored(false, true), authorization: authorization('awaiting_authorization'),
    credentialAccess: 'write', principalAddress: PRINCIPAL,
  });
  assert.equal(task.state, 'action_required');
  assert.deepEqual(task.nextActions, [
    { code: 'contribute_authorization', operationId: 'contract.intent.contribute', requiredInputs: ['entryIndex', 'signatureBase64'], requiredAccess: 'sign', available: false },
    { code: 'cancel', operationId: 'contract.intent.cancel', bodyDefaults: { action: 'cancel' }, requiredAccess: 'write', available: true },
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
  assert.deepEqual(task.nextActions, [{ code: 'cancel', operationId: 'contract.intent.cancel', bodyDefaults: { action: 'cancel' }, requiredAccess: 'write', available: true }]);
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
test('external Classic task distinguishes approval closure from actual payment evidence for every credential level', () => {
  const submittedAt = '2026-09-17T00:01:00.000Z';
  const failed = { outcome: 'failed' as const, observed: true as const, observation: { transactionHash: DIGEST, ledger: 42, submittedAt, successful: false as const } };
  const absent = { outcome: 'not_included' as const, observed: false as const, nonInclusionProof: {
    oldestLedger: 1, latestLedger: 42, oldestLedgerClosedAt: '2026-09-16T23:59:00Z', latestLedgerClosedAt: '2026-09-17T00:02:00Z',
    validAfter: '2026-09-17T00:00:00Z', validUntil: '2026-09-17T00:01:00Z', checkedAt: '2026-09-17T00:02:01Z',
  } };
  for (const credentialAccess of ['read', 'write', 'sign'] as const) {
    for (const status of ['blocked', 'stale', 'expired'] as const) {
      const task = projectClassicAgentTask({ request: { ...classic(status), executionOutcome: { outcome: 'unknown', observed: false } }, credentialAccess, hasSigned: true });
      assert.equal(task.state, 'execution_unknown');
      assert.deepEqual(task.executionOutcome, { outcome: 'unknown', observed: false });
      assert.equal(task.signatureRequired, false);
      assert.deepEqual(task.nextActions, []);
      assert.equal(task.result, undefined);
    }
    const failure = projectClassicAgentTask({ request: { ...classic('blocked'), executionOutcome: failed }, credentialAccess, hasSigned: true });
    assert.equal(failure.state, 'failed');
    assert.deepEqual(failure.executionOutcome, failed);
    assert.deepEqual(failure.result, { transactionHash: DIGEST, ledger: 42, successful: false });
    const nonIncluded = projectClassicAgentTask({ request: { ...classic('expired'), executionOutcome: absent }, credentialAccess, hasSigned: true });
    assert.equal(nonIncluded.state, 'expired');
    assert.deepEqual(nonIncluded.executionOutcome, absent);
    const pending = projectClassicAgentTask({ request: { ...classic('awaiting_signatures'), executionOutcome: { outcome: 'unknown', observed: false } }, credentialAccess, hasSigned: false });
    assert.equal(pending.signatureRequired, true);
  }
});

test('Soroban Agent retry actions mark resolved prior evidence for explicit review', () => {
  const preparation = {
    version: 1 as const, transactionHash: DIGEST, authorizationPlanDigest: DIGEST,
    authorizationPlanRevision: 1, executionSource: PRINCIPAL, transactionSequence: '1',
    validUntil: '2026-09-17T00:01:00.000Z', latestLedger: 10, effectsDigest: DIGEST,
    effectsAccepted: true, preparedAt: '2026-09-17T00:00:30.000Z',
  };
  const observation = {
    version: 1 as const, transactionHash: DIGEST, authorizationPlanDigest: DIGEST,
    authorizationPlanRevision: 1, executionSource: PRINCIPAL, ledger: 11,
    successful: false, observedAt: '2026-09-17T00:00:50.000Z',
  };
  const input = { stored: stored(), credentialAccess: 'write' as const, principalAddress: PRINCIPAL, preparations: [preparation], observations: [observation] };
  const ready = projectSorobanAgentTask({ ...input, authorization: authorization('authorization_ready', true) });
  assert.equal(ready.nextActions[0].code, 'refresh_execution');
  assert.equal(ready.nextActions[0].reviewRequired, true);
  const expired = projectSorobanAgentTask({ ...input, authorization: authorization('expired') });
  assert.equal(expired.nextActions[0].code, 'replan');
  assert.equal(expired.nextActions[0].reviewRequired, true);
  const integration = projectSorobanAgentTask({ ...input, stored: stored(true), authorization: authorization('authorization_ready', true) });
  assert.deepEqual(integration.nextActions, []);
});

test('unreachable quorum exposes only optional reviewed signature action, preserving credential limits', () => {
  const request = { ...classic('awaiting_signatures'), statusReason: 'quorum_unreachable' as const };
  for (const credentialAccess of ['read', 'write', 'sign'] as const) {
    for (const declined of [true, false]) {
      const task = projectClassicAgentTask({ request, credentialAccess, hasSigned: false, declined });
      assert.equal(task.state, 'waiting');
      assert.equal(task.signatureRequired, false);
      assert.deepEqual(task.nextActions, [{ code: 'contribute_signature', operationId: 'proposal.contribute', requiredInputs: ['signedXdr'], requiredAccess: 'sign', available: credentialAccess === 'sign', reviewRequired: true }]);
    }
    assert.deepEqual(projectClassicAgentTask({ request, credentialAccess, hasSigned: true }).nextActions, []);
  }
});

test('reconciliation requires explicit hash selection when multiple Soroban preparations remain unresolved', () => {
  const prep = { version: 1 as const, transactionHash: DIGEST, authorizationPlanDigest: DIGEST, authorizationPlanRevision: 1, executionSource: PRINCIPAL,
    transactionSequence: '1', validUntil: '2026-09-17T00:01:00Z', latestLedger: 10, effectsDigest: DIGEST, effectsAccepted: true, preparedAt: '2026-09-17T00:00:30Z' };
  const task = projectSorobanAgentTask({ stored: stored(false, true), authorization: authorization('authorization_ready', true), credentialAccess: 'write', principalAddress: PRINCIPAL,
    preparations: [prep, { ...prep, transactionHash: 'b'.repeat(64) }], now: new Date('2026-09-17T00:02:00Z') });
  assert.deepEqual(task.nextActions, [{ code: 'reconcile_execution', operationId: 'contract.intent.execution.reconcile', bodyDefaults: { action: 'reconcile_execution' }, requiredInputs: ['transactionHash'], requiredAccess: 'write', available: true }]);
  assert.equal(task.unresolvedTransactionHashes?.length, 2);
});

test('all emitted Agent action defaults and required inputs match their logical operation contracts', async () => {
  const { createOpenApiDocument } = await import('./openApiDocument.js');
  const doc = createOpenApiDocument() as any;
  const contracts = doc['x-multisig-operations'];
  const seen = new Set<string>();
  const prep = {
    version: 1 as const, transactionHash: DIGEST, authorizationPlanDigest: DIGEST,
    authorizationPlanRevision: 1, executionSource: PRINCIPAL, transactionSequence: '1',
    validUntil: '2026-09-17T01:00:00.000Z', latestLedger: 10, effectsDigest: DIGEST,
    effectsAccepted: true, preparedAt: '2026-09-17T00:00:30.000Z',
    preparedByAddress: PRINCIPAL, hasReleasedExecution: true,
  };
  const check = (task: ReturnType<typeof projectClassicAgentTask>) => {
    for (const action of task.nextActions) {
      const contract = contracts[action.operationId];
      assert.ok(contract, action.operationId);
      assert.equal(contract.access, 'principal:' + action.requiredAccess, action.operationId);
      let schema = contract.requestBody.content['application/json'].schema;
      if (schema.$ref) schema = doc.components.schemas[schema.$ref.split('/').at(-1)];
      const defaults = action.bodyDefaults ?? {};
      const keys = new Set([...Object.keys(defaults), ...(action.requiredInputs ?? [])]);
      for (const field of schema.required ?? []) assert.ok(keys.has(field), action.operationId + ': ' + field);
      for (const field of keys) assert.ok(schema.properties[field], action.operationId + ': ' + field);
      for (const [field, value] of Object.entries(defaults)) {
        const property = schema.properties[field];
        if (property.const !== undefined) assert.equal(value, property.const);
        if (property.enum) assert.ok(property.enum.includes(value));
      }
      seen.add(action.code);
    }
  };
  for (const credentialAccess of ['read', 'write', 'sign'] as const) {
    for (const declined of [true, false]) {
      check(projectClassicAgentTask({ request: classic('awaiting_signatures'), credentialAccess, hasSigned: false, declined }));
    }
    for (const status of ['awaiting_authorization', 'authorization_ready', 'expired', 'blocked', 'cancelled'] as const) {
      for (const preparations of [[], [prep], [prep, { ...prep, transactionHash: 'b'.repeat(64) }]]) {
        check(projectSorobanAgentTask({ stored: stored(false, true), authorization: authorization(status, status === 'authorization_ready'),
          credentialAccess, principalAddress: PRINCIPAL, preparations, now: new Date('2026-09-17T00:30:00.000Z') }));
      }
    }
  }
  check(projectSorobanAgentTask({ stored: stored(false, true), authorization: authorization('authorization_ready', true),
    credentialAccess: 'write', principalAddress: PRINCIPAL, preparations: [prep], observations: [{
      version: 1, transactionHash: DIGEST, authorizationPlanDigest: DIGEST, authorizationPlanRevision: 1,
      executionSource: PRINCIPAL, ledger: 20, successful: false, observedAt: '2026-09-17T00:40:00.000Z',
    }] }));
  assert.deepEqual([...seen].sort(), ['cancel', 'contribute_authorization', 'contribute_signature', 'decline', 'prepare_execution', 'reconcile_execution', 'refresh_execution', 'replan', 'resume_execution']);
});
