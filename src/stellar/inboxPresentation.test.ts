import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inboxActionCountPresentations,
  inboxViewerActionNeedsAction,
  inboxViewerActionPresentation,
  projectInboxViewerAction,
  summarizeInboxActions,
} from './inboxPresentation.js';

test('Inbox viewer action stays separate from canonical Request status', () => {
  assert.equal(projectInboxViewerAction('awaiting_signatures', { hasSigned: false }), 'sign');
  assert.equal(projectInboxViewerAction('awaiting_signatures', { hasSigned: true }), 'waiting_for_others');
  assert.equal(projectInboxViewerAction('awaiting_signatures', { hasSigned: false, declined: true }), 'declined');
  assert.equal(projectInboxViewerAction('ready', { hasSigned: false }), 'submit');
  assert.equal(projectInboxViewerAction('ready', { hasSigned: false, externalExecution: true }), 'waiting_execution');
  assert.equal(projectInboxViewerAction('waiting_preconditions', { hasSigned: false }), 'waiting_preconditions');
  assert.equal(projectInboxViewerAction('stale', { hasSigned: false }), 'attention');
  assert.equal(projectInboxViewerAction('blocked', { hasSigned: false }), 'attention');
});

test('Inbox action counts describe what the current viewer can do now', () => {
  const counts = summarizeInboxActions([
    { viewerAction: 'sign' },
    { viewerAction: 'submit' },
    { viewerAction: 'attention' },
    { viewerAction: 'waiting_for_others' },
    { viewerAction: 'waiting_preconditions' },
    { viewerAction: 'declined' },
  ]);
  assert.deepEqual(counts, {
    actionRequired: 3,
    signatureNeeded: 1,
    readyToSubmit: 1,
    needsAttention: 1,
    waiting: 3,
    contractAuthorizationNeeded: 0,
    readyForExecutionRouting: 0,
  });
  assert.equal(inboxViewerActionNeedsAction('sign'), true);
  assert.equal(inboxViewerActionNeedsAction('waiting_for_others'), false);

  const withIntents = summarizeInboxActions([], [
    { viewerAction: 'authorize' },
    { viewerAction: 'route_execution' },
    { viewerAction: 'attention' },
    { viewerAction: 'waiting' },
  ]);
  assert.deepEqual(withIntents, {
    actionRequired: 3,
    signatureNeeded: 0,
    readyToSubmit: 0,
    needsAttention: 1,
    waiting: 1,
    contractAuthorizationNeeded: 1,
    readyForExecutionRouting: 1,
  });
});

test('Inbox Human copy distinguishes viewer action from transaction-wide status', () => {
  assert.equal(inboxViewerActionPresentation('sign').label, 'Your signature is needed');
  assert.equal(inboxViewerActionPresentation('submit').cta, 'Review & submit');
  assert.equal(inboxViewerActionPresentation('waiting_execution').cta, 'View status');
  assert.match(inboxViewerActionPresentation('waiting_for_others').label, /You signed/);
  assert.match(inboxViewerActionPresentation('waiting_preconditions').label, /waiting for ledger/);
  assert.match(inboxViewerActionPresentation('declined').label, /You declined/);
});

test('Dashboard action summary reuses the Human semantic tones', () => {
  assert.deepEqual(inboxActionCountPresentations({
    actionRequired: 4,
    signatureNeeded: 2,
    readyToSubmit: 1,
    needsAttention: 1,
    waiting: 3,
    contractAuthorizationNeeded: 1,
    readyForExecutionRouting: 1,
  }), [
    { key: 'contract-auth', label: '1 contract auth', tone: 'warning' },
    { key: 'execution-route', label: '1 to choose execution', tone: 'success' },
    { key: 'sign', label: '2 to sign', tone: 'warning' },
    { key: 'submit', label: '1 to submit', tone: 'success' },
    { key: 'attention', label: '1 need review', tone: 'danger' },
    { key: 'waiting', label: '3 waiting', tone: 'neutral' },
  ]);
});
