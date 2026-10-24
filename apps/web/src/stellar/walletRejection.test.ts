import assert from 'node:assert/strict';
import test from 'node:test';
import { isWalletMessageSigningUnsupported, isWalletUserRejected } from './walletKit.js';

test('wallet rejection is recognized as cancellation without implying unsupported signing', () => {
  const cause = new Error('The user rejected this request.');
  assert.equal(isWalletUserRejected(cause), true);
  assert.equal(isWalletMessageSigningUnsupported(cause), false);
});

test('unsupported signMessage remains a distinct fallback signal', () => {
  const cause = new Error('signMessage is not supported');
  assert.equal(isWalletUserRejected(cause), false);
  assert.equal(isWalletMessageSigningUnsupported(cause), true);
});
