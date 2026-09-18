import assert from 'node:assert/strict';
import test from 'node:test';
import {
  requestCoordinationPhase,
  sorobanCoordinationPhase,
} from './coordinationWorkflow.js';
import { sorobanExecutionRoutes } from './executionPolicy.js';

test('Classic Request and Soroban Intent project onto the same post-Review phases', () => {
  assert.equal(requestCoordinationPhase('awaiting_signatures'), 'authorization');
  assert.equal(requestCoordinationPhase('ready'), 'ready');
  assert.equal(requestCoordinationPhase('waiting_preconditions'), 'ready');
  assert.equal(requestCoordinationPhase('submitted'), 'done');
  assert.equal(requestCoordinationPhase('stale'), 'attention');
  assert.equal(sorobanCoordinationPhase('awaiting_authorization'), 'authorization');
  assert.equal(sorobanCoordinationPhase('authorization_ready'), 'ready');
  assert.equal(sorobanCoordinationPhase('expired'), 'attention');
  assert.equal(sorobanCoordinationPhase('cancelled'), 'done');
});

test('ordinary Soroban Ready exposes routing while fixed execution policy narrows it', () => {
  assert.deepEqual(sorobanExecutionRoutes(), ['current_client', 'handoff', 'multisigtools']);
  assert.deepEqual(sorobanExecutionRoutes({ mode: 'multisigtools' }), ['multisigtools']);
  assert.deepEqual(sorobanExecutionRoutes({ mode: 'external' }), ['external_service']);
});
