import assert from 'node:assert/strict';
import test from 'node:test';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { describeInboxRequest, inboxOutgoingSignerProgress, proposalNextStep } from './inboxRequestPresentation.js';

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
  assert.equal(description.summary, '10.0000000 XLM · Payment');
  assert.equal(description.systemType, 'Payment');
});


test('Payment titles stay readable while exact destination remains in transaction evidence', () => {
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
  });
  const recipient = description.inspection.operations[0]?.fields.find((field) => field.label === 'Destination')?.value;
  assert.equal(description.title, 'Send 10.0000000 XLM');
  assert.match(description.summary, /^To G[A-Z2-7]{9}…[A-Z2-7]{8}$/);
  assert.equal(recipient?.length, 56);
  assert.doesNotMatch(description.title, /G[A-Z2-7]{55}/);
  assert.ok(recipient && !description.summary.includes(recipient));
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


test('Proposal presents the next task without claiming an unauthorized wallet can sign', () => {
  const options = { reviewComplete: false, walletAlreadySigned: false, executionRoutedToMst: false };
  assert.deepEqual(proposalNextStep('awaiting_signatures', options), {
    heading: 'Next step',
    title: 'Review this transaction',
    detail: 'Check the affected accounts, recipients, and changes before continuing to signatures.',
    action: { label: 'Review transaction', target: 'review' },
  });
  const waiting = proposalNextStep('awaiting_signatures', { ...options, reviewComplete: true });
  assert.equal(waiting.title, 'Collect the required signatures');
  assert.doesNotMatch(waiting.detail, /your signature is needed/i);
  const signed = proposalNextStep('awaiting_signatures', { ...options, reviewComplete: true, walletAlreadySigned: true });
  assert.equal(signed.heading, 'Current status');
  assert.equal(signed.title, 'Your signature is recorded');
  assert.equal(signed.action.target, 'signatures');
  assert.match(signed.detail, /Your part is done for now/);
  const sender = proposalNextStep('awaiting_signatures', {
    ...options, reviewComplete: true, walletAlreadySigned: true,
    isCreator: true, canCoordinate: true,
  });
  assert.equal(sender.heading, 'Next step');
  assert.equal(sender.action.label, 'Invite or remind signers');
  assert.equal(sender.action.target, 'signatures');
  const noInvitePermission = proposalNextStep('awaiting_signatures', {
    ...options, reviewComplete: true, walletAlreadySigned: true,
    isCreator: true, canCoordinate: false,
  });
  assert.equal(noInvitePermission.action.label, 'View signing progress');
  const recipient = proposalNextStep('awaiting_signatures', {
    ...options, reviewComplete: true, walletAlreadySigned: true,
    isCreator: false, canCoordinate: true,
  });
  assert.equal(recipient.action.label, 'View signing progress');
});

test('Proposal distinguishes self-managed, external and unchosen execution', () => {
  const options = { reviewComplete: true, walletAlreadySigned: false, executionRoutedToMst: false };
  const ready = proposalNextStep('ready', options);
  assert.equal(ready.title, 'Ready to submit');
  assert.equal(ready.action.target, 'submission');
  assert.match(ready.detail, /has not been submitted/);
  const signedRecipient = proposalNextStep('ready', {
    ...options, walletAlreadySigned: true, isCreator: false,
  });
  assert.match(signedRecipient.detail, /Your signature is recorded/);
  assert.match(signedRecipient.detail, /Choose how to submit it/);
  assert.doesNotMatch(signedRecipient.detail, /authorized signer must/);
  assert.match(ready.detail, /All required signatures are in/);
  assert.equal(proposalNextStep('ready', { ...options, executionRoutedToMst: true }).title, 'Review and submit');
  const external = proposalNextStep('ready', { ...options, executionMode: 'external', executionRoutedToMst: true });
  assert.equal(external.heading, 'Current status');
  assert.equal(external.title, 'Waiting for the originating service');
  assert.equal(external.action.target, 'submission');
});

test('Proposal terminal and blocked statuses take precedence over the review step', () => {
  const options = { reviewComplete: false, walletAlreadySigned: false, executionRoutedToMst: false };
  assert.equal(proposalNextStep('submitted', options).title, 'Confirmed on Stellar');
  assert.equal(proposalNextStep('waiting_preconditions', options).heading, 'Current status');
  assert.equal(proposalNextStep('blocked', options).title, 'This proposal needs review');
  assert.equal(proposalNextStep('stale', options).heading, 'Current status');
  assert.equal(proposalNextStep('expired', options).title, 'This proposal has expired');
});

test('Proposal expiry distinguishes the collaboration window from the Stellar time limit', () => {
  const options = { reviewComplete: true, walletAlreadySigned: true, executionRoutedToMst: true };
  const closed = proposalNextStep('expired', { ...options, statusReason: 'request_expired' });
  assert.match(closed.detail, /exported transaction may still be valid/);
  assert.match(closed.detail, /Check its network record/);
  assert.equal(closed.action.target, 'issue');
  const expiredTransaction = proposalNextStep('expired', { ...options, statusReason: 'transaction_expired' });
  assert.match(expiredTransaction.detail, /Stellar transaction time limit has passed/);
  assert.doesNotMatch(expiredTransaction.detail, /may still be valid/);
});

test('Proposal next step names the current wallet action only after authorization is checked', () => {
  const options = { reviewComplete: true, walletAlreadySigned: false, executionRoutedToMst: false };
  const eligible = proposalNextStep('awaiting_signatures', { ...options, walletSigningState: 'can_sign' });
  assert.equal(eligible.title, 'Your signature is needed');
  assert.equal(eligible.action.label, 'Review and sign');
  assert.match(eligible.detail, /Signing does not submit/);
  const other = proposalNextStep('awaiting_signatures', { ...options, walletSigningState: 'other_signer' });
  assert.equal(other.heading, 'Current status');
  assert.equal(other.title, 'Waiting for an authorized signer');
  const unknown = proposalNextStep('awaiting_signatures', { ...options, walletSigningState: 'unknown' });
  assert.equal(unknown.title, 'Collect the required signatures');
  const signed = proposalNextStep('awaiting_signatures', { ...options, walletAlreadySigned: true, walletSigningState: 'signed' });
  assert.equal(signed.title, 'Your signature is recorded');
  const needsReview = proposalNextStep('awaiting_signatures', { ...options, walletSigningState: 'needs_review' });
  assert.equal(needsReview.title, 'Signing details need review');
  assert.equal(needsReview.action.target, 'signatures');
  const expired = proposalNextStep('expired', { ...options, walletSigningState: 'can_sign' });
  assert.equal(expired.title, 'This proposal has expired');
});
