import assert from 'node:assert/strict';
import test from 'node:test';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { describeInboxRequest } from './inboxRequestPresentation.js';

function paymentXdr() {
  const source = Keypair.random().publicKey();
  const destination = Keypair.random().publicKey();
  return new TransactionBuilder(new Account(source, '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({ destination, asset: Asset.native(), amount: '10' }))
    .setTimeout(3600)
    .build()
    .toXDR();
}

test('Inbox uses reusable template name as business label while preserving MST system type', () => {
  const xdr = paymentXdr();
  const description = describeInboxRequest({
    id: '0123456789ABCDEF',
    network: 'testnet',
    transactionHash: 'hash',
    baseXdr: xdr,
    mergedXdr: xdr,
    createdAt: '2026-10-31T00:00:00Z',
    expiresAt: '2026-11-01T00:00:00Z',
    contributionCount: 0,
    signatureCount: 0,
    status: 'awaiting_signatures',
    statusReason: 'signatures_required',
    template: {
      id: 'tpl_abcdefghijklmnop',
      version: 1,
      name: 'Monthly payroll',
      kind: 'payment',
    },
  });

  assert.equal(description.title, 'Monthly payroll');
  assert.equal(description.summary, 'Payment');
  assert.equal(description.systemType, 'Payment');
});
