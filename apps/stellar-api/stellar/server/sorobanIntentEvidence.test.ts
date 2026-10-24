import assert from 'node:assert/strict';
import test from 'node:test';
import type { StoredSorobanIntent, StoredSorobanIntentAuthorizationContribution, StoredSorobanIntentExecutionObservation, StoredSorobanIntentExecutionPreparation } from './sorobanIntentStore.js';
import { projectSorobanIntentEvidence } from './sorobanIntentEvidence.js';

const plan = (digest: string) => ({ authorizationPlanDigest: digest } as StoredSorobanIntent['authorizationPlan']);

function intent(): StoredSorobanIntent {
  return {
    version: 1,
    id: 'INTENT1',
    network: 'testnet',
    intent: { intentDigest: 'intent-digest' } as StoredSorobanIntent['intent'],
    authorizationPlan: plan('plan-3'),
    authorizationPlanRevision: 3,
    authorizationPlanHistory: [
      { revision: 1, authorizationPlan: plan('plan-1'), supersededAt: '2026-09-15T10:00:00.000Z' },
      { revision: 2, authorizationPlan: plan('plan-2'), supersededAt: '2026-09-15T11:00:00.000Z' },
    ],
    createdAt: '2026-09-15T09:00:00.000Z',
    creatorActor: { type: 'service', id: 'fednetwork', label: 'FedNetwork' },
    cancellation: {
      version: 1,
      cancelledAt: '2026-09-15T12:02:00.000Z',
      authorizationPlanDigest: 'plan-3',
      authorizationPlanRevision: 3,
      cancelledBy: { type: 'service', id: 'fednetwork', label: 'FedNetwork' },
    },
    discoverySignerKeys: [],
  };
}

const contributions: StoredSorobanIntentAuthorizationContribution[] = [
  {
    version: 1, digest: 'legacy-contribution', entryIndex: 0, signerAddress: 'GLEGACY', signatureBase64: 'LEGACY_SECRET',
    receivedAt: '2026-09-15T09:15:00.000Z',
  },
  {
    version: 1, digest: 'contribution-1', entryIndex: 0, signerAddress: 'GAAA', signatureBase64: 'SECRET',
    authorizationPlanDigest: 'plan-1', authorizationPlanRevision: 1, receivedAt: '2026-09-15T09:30:00.000Z',
    submittedBy: { type: 'agent', id: 'agent-a', label: 'Agent A', principalAddress: 'GAAA' },
  },
  {
    version: 1, digest: 'contribution-2', entryIndex: 1, signerAddress: 'GBBB', signatureBase64: 'SECRET2',
    authorizationPlanDigest: 'plan-3', authorizationPlanRevision: 3, receivedAt: '2026-09-15T11:30:00.000Z',
  },
];

const preparations: StoredSorobanIntentExecutionPreparation[] = [{
  version: 1,
  transactionHash: 'ab'.repeat(32),
  authorizationPlanDigest: 'plan-3',
  authorizationPlanRevision: 3,
  executionSource: 'GEXECUTOR',
  transactionSequence: '99',
  validUntil: '2026-09-15T12:05:00.000Z',
  latestLedger: 1234,
  effectsDigest: 'effects-3',
  effectsAccepted: false,
  preparedAt: '2026-09-15T12:00:00.000Z',
  preparedBy: { type: 'service', id: 'fednetwork', label: 'FedNetwork' },
}];

const observations: StoredSorobanIntentExecutionObservation[] = [
  {
    version: 1, transactionHash: 'ab'.repeat(32), authorizationPlanDigest: 'plan-3', authorizationPlanRevision: 3,
    executionSource: 'GEXECUTOR', ledger: 2001, successful: true, observedAt: '2026-09-15T12:03:05.000Z',
    networkCreatedAt: '2026-09-15T12:03:00.000Z',
  },
  {
    version: 1, transactionHash: 'cd'.repeat(32), authorizationPlanDigest: 'plan-3', authorizationPlanRevision: 3,
    executionSource: 'GEXECUTOR', ledger: 2002, successful: false, observedAt: '2026-09-15T12:04:05.000Z',
    networkCreatedAt: '2026-09-15T12:04:00.000Z',
  },
];

test('Soroban Intent evidence projects persisted creation, AUTH, and replan facts without signature payloads', () => {
  const evidence = projectSorobanIntentEvidence(intent(), contributions, preparations, observations);
  assert.deepEqual(evidence.map((item) => item.type), [
    'intent_created',
    'authorization_added',
    'authorization_added',
    'authorization_plan_revised',
    'authorization_plan_revised',
    'authorization_added',
    'execution_prepared',
    'intent_cancelled',
    'execution_confirmed',
    'execution_failed',
  ]);
  assert.deepEqual(evidence[0]?.actor, { type: 'service', id: 'fednetwork', label: 'FedNetwork' });
  assert.equal(evidence[0]?.authorizationPlanDigest, 'plan-1');
  assert.equal(evidence[1]?.actorAddress, 'GLEGACY');
  assert.equal(evidence[1]?.authorizationPlanDigest, 'plan-1');
  assert.equal(evidence[1]?.authorizationPlanRevision, 1);
  assert.equal(evidence[2]?.actorAddress, 'GAAA');
  assert.deepEqual(evidence[2]?.actor, { type: 'agent', id: 'agent-a', label: 'Agent A', principalAddress: 'GAAA' });
  assert.equal(evidence[3]?.previousAuthorizationPlanDigest, 'plan-1');
  assert.equal(evidence[3]?.authorizationPlanDigest, 'plan-2');
  assert.equal(evidence[4]?.previousAuthorizationPlanDigest, 'plan-2');
  assert.equal(evidence[4]?.authorizationPlanDigest, 'plan-3');
  assert.equal(evidence[6]?.transactionHash, 'ab'.repeat(32));
  assert.equal(evidence[6]?.executionSource, 'GEXECUTOR');
  assert.equal(evidence[6]?.effectsDigest, 'effects-3');
  assert.deepEqual(evidence[6]?.actor, { type: 'service', id: 'fednetwork', label: 'FedNetwork' });
  assert.equal(evidence[7]?.type, 'intent_cancelled');
  assert.deepEqual(evidence[7]?.actor, { type: 'service', id: 'fednetwork', label: 'FedNetwork' });
  assert.equal(evidence[8]?.ledger, 2001);
  assert.equal(evidence[8]?.successful, true);
  assert.equal(evidence[8]?.observedAt, '2026-09-15T12:03:05.000Z');
  assert.equal(evidence[9]?.type, 'execution_failed');
  assert.equal(evidence[9]?.successful, false);
  assert.equal(JSON.stringify(evidence).includes('SECRET'), false);
  assert.equal(JSON.stringify(evidence).includes('xdr'), false);
});
