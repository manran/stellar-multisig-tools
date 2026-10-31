import assert from 'node:assert/strict';
import test from 'node:test';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { transactionSystemTypeLabel } from './transactionPresentation.js';
import { inspectTransactionXdr } from './transactionXdr.js';

function transactionWith(...operations: Parameters<TransactionBuilder['addOperation']>[0][]) {
  const source = Keypair.random().publicKey();
  let builder = new TransactionBuilder(new Account(source, '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  });
  for (const operation of operations) builder = builder.addOperation(operation);
  return builder.setTimeout(3600).build();
}

test('projects stable Human system types from exact transaction semantics', () => {
  const first = Keypair.random().publicKey();
  const second = Keypair.random().publicKey();

  const payment = transactionWith(Operation.payment({
    destination: first,
    asset: Asset.native(),
    amount: '1',
  }));
  assert.equal(transactionSystemTypeLabel(inspectTransactionXdr(payment.toXDR(), 'testnet')), 'Payment');

  const batch = transactionWith(
    Operation.payment({ destination: first, asset: Asset.native(), amount: '1' }),
    Operation.payment({ destination: second, asset: Asset.native(), amount: '2' }),
  );
  assert.equal(transactionSystemTypeLabel(inspectTransactionXdr(batch.toXDR(), 'testnet')), 'Batch payment');

  const signingChange = transactionWith(Operation.setOptions({ masterWeight: 1, medThreshold: 2 }));
  assert.equal(transactionSystemTypeLabel(inspectTransactionXdr(signingChange.toXDR(), 'testnet')), 'Account signing change');
});
