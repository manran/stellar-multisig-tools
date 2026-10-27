import assert from 'node:assert/strict';
import test from 'node:test';
import { HUMAN_WORKFLOW_STEPS, proposalWorkflowStage, requestStatusPresentation, requestWorkflowStage, sorobanAuthorizationStatusPresentation, sorobanIntentWorkflowStage } from './humanWorkflow';

test('Human workflow is the canonical five-step transaction journey', () => {
  assert.deepEqual(HUMAN_WORKFLOW_STEPS.map((step) => step.label), ['Prepare', 'Review', 'Sign', 'Submit', 'Done']);
});

test('Request status projects onto the Human workflow without turning views into lifecycle steps', () => {
  assert.equal(requestWorkflowStage('awaiting_signatures'), 'sign');
  assert.equal(requestWorkflowStage('ready'), 'submit');
  assert.equal(requestWorkflowStage('waiting_preconditions'), 'submit');
  assert.equal(requestWorkflowStage('submitted'), 'done');
  assert.equal(requestWorkflowStage('stale', false), 'sign');
  assert.equal(requestWorkflowStage('stale', true), 'submit');
});

test('Proposal stays in Review until the Human review boundary is completed', () => {
  assert.equal(proposalWorkflowStage('awaiting_signatures', { reviewComplete: false }), 'review');
  assert.equal(proposalWorkflowStage('awaiting_signatures', { reviewComplete: true }), 'sign');
  assert.equal(proposalWorkflowStage('ready', { reviewComplete: true, signaturesComplete: true }), 'submit');
  assert.equal(proposalWorkflowStage('submitted', { reviewComplete: true, signaturesComplete: true }), 'done');
});

test('Soroban AUTH stays in Sign and execution routing remains inside Submit', () => {
  assert.equal(sorobanIntentWorkflowStage('awaiting_authorization'), 'sign');
  assert.equal(sorobanIntentWorkflowStage('authorization_ready'), 'submit');
  assert.equal(sorobanIntentWorkflowStage('expired'), 'sign');
  assert.equal(sorobanIntentWorkflowStage('blocked'), 'sign');
  assert.equal(sorobanIntentWorkflowStage('cancelled'), 'done');
});

test('Request status colors keep waiting, success, failure, and expiry semantically distinct', () => {
  assert.deepEqual(requestStatusPresentation('awaiting_signatures'), { label: 'Collecting signatures', tone: 'warning' });
  assert.deepEqual(requestStatusPresentation('ready'), { label: 'Authorization complete', tone: 'success' });
  assert.deepEqual(requestStatusPresentation('blocked'), { label: 'Needs attention', tone: 'danger' });
  assert.deepEqual(requestStatusPresentation('expired'), { label: 'Expired', tone: 'neutral' });
  assert.deepEqual(sorobanAuthorizationStatusPresentation('awaiting_authorization'), { label: 'Collecting contract authorization', tone: 'warning' });
  assert.deepEqual(sorobanAuthorizationStatusPresentation('authorization_ready'), { label: 'Contract authorization complete', tone: 'success' });
  assert.deepEqual(sorobanAuthorizationStatusPresentation('cancelled'), { label: 'Intent cancelled', tone: 'neutral' });
});
