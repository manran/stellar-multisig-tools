import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk/base';
import { addSavedSignerRow, analyzeSignerInputs, removeSignerInputRow, updateSignerInputRows } from './signerInputs';

test('analyzes exact signer addresses independently of display identity', () => {
  const master = Keypair.random().publicKey();
  const alice = Keypair.random().publicKey();
  const bob = Keypair.random().publicKey();
  const state = analyzeSignerInputs([alice, bob, ''], master);

  assert.deepEqual(state.signerKeys, [alice, bob]);
  assert.deepEqual(state.errors, ['', '', '']);
});

test('rejects the account key and duplicate signer rows', () => {
  const master = Keypair.random().publicKey();
  const alice = Keypair.random().publicKey();
  const state = analyzeSignerInputs([master, alice, alice, 'not-a-stellar-key', ''], master);

  assert.equal(state.errors[0], 'The account key is already managed above.');
  assert.equal(state.errors[1], '');
  assert.equal(state.errors[2], 'This signer is already listed.');
  assert.equal(state.errors[3], 'Enter a valid Stellar G... address.');
});

test('editing signer rows keeps one trailing empty row after a valid address', () => {
  const alice = Keypair.random().publicKey();
  const bob = Keypair.random().publicKey();
  const first = updateSignerInputRows([''], 0, alice);
  assert.deepEqual(first, [alice, '']);

  const second = updateSignerInputRows(first, 1, bob);
  assert.deepEqual(second, [alice, bob, '']);

  assert.deepEqual(removeSignerInputRow(second, 0), [bob, '']);
  assert.deepEqual(removeSignerInputRow([''], 0), ['']);
});

test('saved signer selection fills the trailing row and refuses duplicates', () => {
  const alice = Keypair.random().publicKey();
  const bob = Keypair.random().publicKey();
  assert.deepEqual(addSavedSignerRow([alice, ''], bob), [alice, bob, '']);
  assert.deepEqual(addSavedSignerRow([alice, ''], alice), [alice, '']);
  assert.deepEqual(addSavedSignerRow([alice, ''], 'invalid'), [alice, '']);
});
