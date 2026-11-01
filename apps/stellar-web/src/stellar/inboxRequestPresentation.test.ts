import assert from 'node:assert/strict';
import test from 'node:test';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { describeInboxRequest, inboxOutgoingSignerProgress } from './inboxRequestPresentation.js';

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


test('Inbox outgoing progress keeps sender asks separate from email delivery and authenticated view', () => {
  const sender = Keypair.random().publicKey();
  const bob = Keypair.random().publicKey();
  const carol = Keypair.random().publicKey();
  const requestId = 'ABCDEF0123456789';

  const progress = inboxOutgoingSignerProgress({
    coordinationEvents: [
      {
        version: 1,
        eventId: 'ask-bob',
        requestId,
        type: 'signer_requested',
        occurredAt: '2026-11-01T01:00:00.000Z',
        actorAddress: sender,
        subjectAddress: bob,
      },
      {
        version: 1,
        eventId: 'email-bob',
        requestId,
        type: 'notification_delivered',
        occurredAt: '2026-11-01T01:01:00.000Z',
        actorAddress: sender,
        subjectAddress: bob,
        notificationKind: 'signature_requested',
      },
      {
        version: 1,
        eventId: 'view-bob',
        requestId,
        type: 'proposal_viewed',
        occurredAt: '2026-11-01T01:02:00.000Z',
        actorAddress: bob,
        subjectAddress: bob,
      },
      {
        version: 1,
        eventId: 'reminder-bob',
        requestId,
        type: 'notification_accepted',
        occurredAt: '2026-11-01T01:03:00.000Z',
        actorAddress: sender,
        subjectAddress: bob,
        notificationKind: 'signature_reminder',
      },
      {
        version: 1,
        eventId: 'ask-carol-by-someone-else',
        requestId,
        type: 'signer_requested',
        occurredAt: '2026-11-01T01:04:00.000Z',
        actorAddress: carol,
        subjectAddress: bob,
      },
    ],
  }, sender);

  assert.deepEqual(progress, [{
    signerAddress: bob,
    askedAt: '2026-11-01T01:00:00.000Z',
    viewedAt: '2026-11-01T01:02:00.000Z',
    notification: {
      label: 'Reminder accepted',
      tone: 'neutral',
      occurredAt: '2026-11-01T01:03:00.000Z',
    },
  }]);
});
