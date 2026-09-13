import assert from 'node:assert/strict';
import test from 'node:test';
import { computePrivateCommitmentFromHex } from '../src/stellar/privateCommitment.js';
import { PrivateCommitmentValidationError, validatePrivateCommitmentForMemo } from './requestPrivateCommitment.js';

const SALT = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';

test('accepts opening data only when it matches the transaction MEMO_HASH', () => {
  const commitment = computePrivateCommitmentFromHex('Invoice 2026-0831', SALT);
  const record = validatePrivateCommitmentForMemo(
    { text: ' Invoice 2026-0831 ', saltHex: SALT },
    { type: 'hash', value: commitment.hashHex },
    '2026-08-30T12:00:00.000Z',
  );
  assert.equal(record?.text, 'Invoice 2026-0831');
  assert.equal(record?.hashHex, commitment.hashHex);
  assert.equal(record?.createdAt, '2026-08-30T12:00:00.000Z');
});

test('rejects mismatched hashes and non-hash memo types', () => {
  assert.throws(
    () => validatePrivateCommitmentForMemo(
      { text: 'Invoice 2026-0831', saltHex: SALT },
      { type: 'hash', value: '00'.repeat(32) },
      '2026-08-30T12:00:00.000Z',
    ),
    (cause: unknown) => cause instanceof PrivateCommitmentValidationError && /does not match/i.test(cause.message),
  );
  assert.throws(
    () => validatePrivateCommitmentForMemo(
      { text: 'Invoice 2026-0831', saltHex: SALT },
      { type: 'text', value: 'public memo' },
      '2026-08-30T12:00:00.000Z',
    ),
    /does not match/i,
  );
});

test('omitting Private Commitment context leaves ordinary MEMO_HASH transactions untouched', () => {
  assert.equal(validatePrivateCommitmentForMemo(undefined, { type: 'hash', value: '00'.repeat(32) }, new Date().toISOString()), undefined);
});
