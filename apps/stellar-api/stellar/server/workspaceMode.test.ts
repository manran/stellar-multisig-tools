import assert from 'node:assert/strict';
import test from 'node:test';
import {
  onboardingModeDestination,
  resolveWorkspaceMode,
  workspaceHomePath,
  workspaceModeForExclusiveRoute,
} from '../../../../src/workspaceMode.js';

test('exclusive workspace routes identify their owning mode', () => {
  assert.equal(workspaceModeForExclusiveRoute('/'), null);
  assert.equal(workspaceModeForExclusiveRoute('/stellar/inbox'), 'sign');
  assert.equal(workspaceModeForExclusiveRoute('/activity'), 'sign');
  assert.equal(workspaceModeForExclusiveRoute('/stellar/activity'), 'sign');
  assert.equal(workspaceModeForExclusiveRoute('/address-book'), 'sign');
  assert.equal(workspaceModeForExclusiveRoute('/stellar/address-book'), 'sign');

  assert.equal(workspaceModeForExclusiveRoute('/treasury'), 'setup');
  assert.equal(workspaceModeForExclusiveRoute('/treasury/activity'), 'setup');
  assert.equal(workspaceModeForExclusiveRoute('/stellar/treasury/change-signing'), 'setup');

  assert.equal(workspaceModeForExclusiveRoute('/demo'), null);
  assert.equal(workspaceModeForExclusiveRoute('/new'), null);
  assert.equal(workspaceModeForExclusiveRoute('/new/payment'), null);
  assert.equal(workspaceModeForExclusiveRoute('/new/import'), null);
  assert.equal(workspaceModeForExclusiveRoute('/contract'), null);
  assert.equal(workspaceModeForExclusiveRoute('/s'), null);
  assert.equal(workspaceModeForExclusiveRoute('/signing-room'), null);
  assert.equal(workspaceModeForExclusiveRoute('/transaction'), null);

  assert.equal(workspaceModeForExclusiveRoute('/accounts'), null);
  assert.equal(workspaceModeForExclusiveRoute('/signers'), null);
  assert.equal(workspaceModeForExclusiveRoute('/designer'), null);
  assert.equal(workspaceModeForExclusiveRoute('/request'), null);
});

test('explicit route intent overrides the saved workspace preference', () => {
  assert.equal(resolveWorkspaceMode('/treasury', 'sign'), 'setup');
  assert.equal(resolveWorkspaceMode('/treasury/activity', 'sign'), 'setup');
  assert.equal(resolveWorkspaceMode('/stellar/treasury/change-signing', 'sign'), 'setup');

  assert.equal(resolveWorkspaceMode('/inbox', 'setup'), 'sign');
  assert.equal(resolveWorkspaceMode('/activity', 'setup'), 'sign');
  assert.equal(resolveWorkspaceMode('/stellar/address-book', 'setup'), 'sign');

  assert.equal(resolveWorkspaceMode('/', 'sign'), 'sign');
  assert.equal(resolveWorkspaceMode('/', 'setup'), 'setup');
  assert.equal(resolveWorkspaceMode('/new', 'sign'), 'sign');
  assert.equal(resolveWorkspaceMode('/new', 'setup'), 'setup');
  assert.equal(resolveWorkspaceMode('/s', 'setup'), 'setup');
});

test('workspace modes have explicit workspace homes', () => {
  assert.equal(workspaceHomePath('sign'), '/inbox');
  assert.equal(workspaceHomePath('setup'), '/treasury');
});

test('first-use mode choice routes public home into a workspace without disrupting neutral request routes', () => {
  assert.equal(onboardingModeDestination('sign', '/'), '/inbox');
  assert.equal(onboardingModeDestination('sign', '/stellar'), '/inbox');
  assert.equal(onboardingModeDestination('sign', '/treasury'), '/inbox');
  assert.equal(onboardingModeDestination('sign', '/s'), null);
  assert.equal(onboardingModeDestination('sign', '/signing-room'), null);
  assert.equal(onboardingModeDestination('setup', '/'), '/treasury');
  assert.equal(onboardingModeDestination('setup', '/s'), '/treasury');
});
