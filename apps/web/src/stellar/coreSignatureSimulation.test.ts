import assert from 'node:assert/strict';
import test from 'node:test';
import { simulateCoreSignatureCheck } from '../../../../packages/stellar-core/src/coreSignatureSimulation.js';

test('stops as soon as the needed weight is reached', () => {
  const result = simulateCoreSignatureCheck([
    { signerKey: 'GA', signerType: 'ed25519', kind: 'ed25519', weight: 1, matchingSignatureIndexes: [0] },
    { signerKey: 'GB', signerType: 'ed25519', kind: 'ed25519', weight: 1, matchingSignatureIndexes: [1] },
  ], 2, 1);

  assert.equal(result.satisfied, true);
  assert.deepEqual(result.usedSignatureIndexes, [0]);
  assert.deepEqual(result.matchedSigners.map((item) => item.signerKey), ['GA']);
});

test('threshold zero still requires a matching signer', () => {
  assert.equal(simulateCoreSignatureCheck([], 0, 0).satisfied, false);
  assert.equal(simulateCoreSignatureCheck([
    { signerKey: 'GA', signerType: 'ed25519', kind: 'ed25519', weight: 1, matchingSignatureIndexes: [0] },
  ], 1, 0).satisfied, true);
});

test('preauth is checked before decorated signatures', () => {
  const result = simulateCoreSignatureCheck([
    { signerKey: 'T1', signerType: 'preauth_tx', kind: 'preauth', weight: 2, automaticMatch: true },
    { signerKey: 'GA', signerType: 'ed25519', kind: 'ed25519', weight: 2, matchingSignatureIndexes: [0] },
  ], 1, 2);

  assert.equal(result.satisfied, true);
  assert.deepEqual(result.usedSignatureIndexes, []);
  assert.equal(result.matchedSigners[0]?.signerKey, 'T1');
});

test('uses Core signer-type order hashx then ed25519 then signed payload', () => {
  const result = simulateCoreSignatureCheck([
    { signerKey: 'GA', signerType: 'ed25519', kind: 'ed25519', weight: 1, matchingSignatureIndexes: [0] },
    { signerKey: 'X1', signerType: 'sha256_hash', kind: 'hashx', weight: 1, matchingSignatureIndexes: [1] },
    { signerKey: 'P1', signerType: 'ed25519_signed_payload', kind: 'signed_payload', weight: 1, matchingSignatureIndexes: [2] },
  ], 3, 2);

  assert.equal(result.satisfied, true);
  assert.deepEqual(result.matchedSigners.map((item) => item.signerKey), ['X1', 'GA']);
  assert.deepEqual(result.usedSignatureIndexes, [0, 1]);
});

test('one decorated signature can be reused by different signer-type groups', () => {
  const result = simulateCoreSignatureCheck([
    { signerKey: 'X1', signerType: 'sha256_hash', kind: 'hashx', weight: 1, matchingSignatureIndexes: [0] },
    { signerKey: 'GA', signerType: 'ed25519', kind: 'ed25519', weight: 1, matchingSignatureIndexes: [0] },
  ], 1, 2);

  assert.equal(result.satisfied, true);
  assert.equal(result.matchedWeight, 2);
  assert.deepEqual(result.usedSignatureIndexes, [0]);
});

test('caps legacy signer weight at uint8 max like current Core', () => {
  const result = simulateCoreSignatureCheck([
    { signerKey: 'GA', signerType: 'ed25519', kind: 'ed25519', weight: 300, matchingSignatureIndexes: [0] },
  ], 1, 255);

  assert.equal(result.satisfied, true);
  assert.equal(result.matchedWeight, 255);
  assert.equal(result.matchedSigners[0]?.weight, 255);
});
