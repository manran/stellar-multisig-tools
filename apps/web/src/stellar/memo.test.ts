import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidStellarTextMemo, stellarTextMemoByteLength } from '../../../../packages/stellar-core/src/memo.js';

test('accepts an empty or 28-byte Stellar text memo', () => {
  assert.equal(isValidStellarTextMemo(''), true);
  assert.equal(isValidStellarTextMemo('1234567890123456789012345678'), true);
});

test('rejects a Stellar text memo longer than 28 UTF-8 bytes', () => {
  assert.equal(isValidStellarTextMemo('12345678901234567890123456789'), false);
});

test('counts UTF-8 bytes rather than JavaScript characters', () => {
  assert.equal(stellarTextMemoByteLength('萤火'), 6);
  assert.equal(isValidStellarTextMemo('萤火萤火萤火萤火萤'), true);
  assert.equal(isValidStellarTextMemo('萤火萤火萤火萤火萤火'), false);
});
