import assert from 'node:assert/strict';
import test from 'node:test';
import { accountSigningIntentForRoute, accountSigningReviewOutcome } from './accountSigningFlow.js';

test('account signing route projects standalone, offline, and treasury entry contexts', () => {
  assert.equal(accountSigningIntentForRoute('/account/signing', null, null), 'standalone');
  assert.equal(accountSigningIntentForRoute('/account/signing', null, 'offline'), 'offline');
  assert.equal(accountSigningIntentForRoute('/account/signing/edit', 'offline', null), 'offline');
  assert.equal(accountSigningIntentForRoute('/treasury/bootstrap', null, null), 'offline');
  assert.equal(accountSigningIntentForRoute('/treasury/change-signing', null, null), 'treasury');
});

test('account signing outcome follows live signer authority while offline stays export-first', () => {
  assert.equal(accountSigningReviewOutcome('standalone', true), 'sign');
  assert.equal(accountSigningReviewOutcome('standalone', false), 'export');
  assert.equal(accountSigningReviewOutcome('treasury', true), 'sign');
  assert.equal(accountSigningReviewOutcome('treasury', false), 'export');
  assert.equal(accountSigningReviewOutcome('offline', true), 'export');
  assert.equal(accountSigningReviewOutcome('offline', false), 'export');
});
