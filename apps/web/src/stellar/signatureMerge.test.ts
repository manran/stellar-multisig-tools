import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk/base';
import { mergeSignedTransactionXdr } from '../../../../packages/stellar-core/src/signatureMerge.js';

function unsignedPayment(amount = '1') {
  const source = Keypair.random();
  const second = Keypair.random();
  const account = new Account(source.publicKey(), '1');
  const transaction = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({
      destination: Keypair.random().publicKey(),
      asset: Asset.native(),
      amount,
    }))
    .setTimeout(300)
    .build();

  return { source, second, transaction };
}

test('merges unique signatures from two copies of the same transaction', () => {
  const { source, second, transaction } = unsignedPayment();
  const firstCopy = TransactionBuilder.fromXdr(transaction.toXdr(), Networks.TESTNET);
  const secondCopy = TransactionBuilder.fromXdr(transaction.toXdr(), Networks.TESTNET);
  firstCopy.sign(source);
  secondCopy.sign(second);

  const result = mergeSignedTransactionXdr(firstCopy.toXdr(), secondCopy.toXdr(), 'testnet');
  const merged = TransactionBuilder.fromXdr(result.mergedXdr, Networks.TESTNET);

  assert.equal(result.addedSignatureCount, 1);
  assert.equal(result.duplicateSignatureCount, 0);
  assert.equal(result.totalSignatureCount, 2);
  assert.equal(merged.signatures.length, 2);
});

test('does not duplicate an identical decorated signature', () => {
  const { source, transaction } = unsignedPayment();
  transaction.sign(source);

  const result = mergeSignedTransactionXdr(transaction.toXdr(), transaction.toXdr(), 'testnet');

  assert.equal(result.addedSignatureCount, 0);
  assert.equal(result.duplicateSignatureCount, 1);
  assert.equal(result.totalSignatureCount, 1);
});

test('rejects a signed envelope whose transaction body changed', () => {
  const first = unsignedPayment('1');
  const second = unsignedPayment('2');

  assert.throws(
    () => mergeSignedTransactionXdr(first.transaction.toXdr(), second.transaction.toXdr(), 'testnet'),
    /different transaction/i,
  );
});

test('rejects fee-bump merging until inner signatures are finalized', () => {
  const { source, transaction } = unsignedPayment();
  const feeSource = Keypair.random();
  transaction.sign(source);
  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    feeSource,
    '200',
    transaction,
    Networks.TESTNET,
  );

  assert.throws(
    () => mergeSignedTransactionXdr(feeBump.toXdr(), feeBump.toXdr(), 'testnet'),
    /fee-bump signature merging is not supported/i,
  );
});
