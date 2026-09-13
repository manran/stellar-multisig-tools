import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Account,
  Asset,
  Keypair,
  Memo,
  Networks,
  Operation,
  TimeoutInfinite,
  TransactionBuilder,
} from '@stellar/stellar-sdk/base';
import {
  computePrivateCommitment,
  computePrivateCommitmentFromHex,
  hexToBytes,
  normalizePrivateCommitmentText,
  privateCommitmentMatchesHash,
  privateCommitmentPayloadByteLength,
} from './privateCommitment.js';
import { inspectTransactionXdr } from './transactionXdr.js';

const VECTOR_SALT = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const VECTOR_HASH = '190635ec5f6ee4f8b16eed2065e9f6e13183b3ebbf04681e9ab89e363f547fe7';

test('Private Commitment v1 has a stable binary test vector', () => {
  const commitment = computePrivateCommitmentFromHex('Invoice 2026-0831', VECTOR_SALT);
  assert.equal(commitment.text, 'Invoice 2026-0831');
  assert.equal(commitment.saltHex, VECTOR_SALT);
  assert.equal(commitment.hashHex, VECTOR_HASH);
  assert.equal(privateCommitmentMatchesHash(commitment, VECTOR_HASH), true);
});

test('canonicalizes whitespace and Unicode to NFC before hashing', () => {
  const salt = new Uint8Array(32);
  const composed = computePrivateCommitment('  Caf\u00e9  ', salt);
  const decomposed = computePrivateCommitment('Cafe\u0301', salt);
  assert.equal(composed.text, 'Caf\u00e9');
  assert.equal(composed.hashHex, decomposed.hashHex);
  assert.equal(privateCommitmentPayloadByteLength(' Cafe\u0301 '), 5);
});

test('rejects empty payloads and salts that are not exactly 32 bytes', () => {
  assert.throws(() => normalizePrivateCommitmentText('   '), /cannot be empty/i);
  assert.throws(() => computePrivateCommitment('hello', new Uint8Array(31)), /exactly 32 bytes/i);
});

test('salt changes the commitment for the same low-entropy text', () => {
  const first = computePrivateCommitment('approved', new Uint8Array(32));
  const secondSalt = new Uint8Array(32);
  secondSalt[31] = 1;
  const second = computePrivateCommitment('approved', secondSalt);
  assert.notEqual(first.hashHex, second.hashHex);
});

test('the computed 32-byte digest round-trips through Stellar MEMO_HASH inspection', () => {
  const source = Keypair.random();
  const destination = Keypair.random();
  const commitment = computePrivateCommitmentFromHex('Invoice 2026-0831', VECTOR_SALT);
  const transaction = new TransactionBuilder(new Account(source.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({ destination: destination.publicKey(), asset: Asset.native(), amount: '1' }))
    .addMemo(Memo.hash(hexToBytes(commitment.hashHex)))
    .setTimeout(TimeoutInfinite)
    .build();

  const inspection = inspectTransactionXdr(transaction.toXDR(), 'testnet');
  assert.equal(inspection.memo.type, 'hash');
  assert.equal(inspection.memo.value, commitment.hashHex);
});
