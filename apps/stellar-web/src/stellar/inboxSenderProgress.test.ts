import assert from 'node:assert/strict';
import test from 'node:test';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { inboxSenderProgress } from './inboxSenderProgress.js';
import type { InboxOutgoingSignerProgress } from './inboxRequestPresentation.js';

function fixture() {
  const alice = Keypair.random();
  const bob = Keypair.random();
  const carol = Keypair.random();
  const transaction = new TransactionBuilder(new Account(alice.publicKey(), '1'), {
    fee: '100', networkPassphrase: Networks.TESTNET,
  }).addOperation(Operation.payment({ destination: carol.publicKey(), asset: Asset.native(), amount: '10' }))
    .setTimeout(300).build();
  const asked = [alice, bob, carol].map((key): InboxOutgoingSignerProgress => ({
    signerAddress: key.publicKey(), askedAt: '2026-11-19T12:00:00Z',
  }));
  return { alice, bob, carol, transaction, asked };
}

test('sender progress marks only a verified signature for the exact transaction and network', () => {
  const { alice, bob, transaction, asked } = fixture();
  transaction.sign(alice);
  const rows = inboxSenderProgress({ mergedXdr: transaction.toXDR(), network: 'testnet', status: 'awaiting_signatures' }, asked);
  assert.equal(rows.find((row) => row.signerAddress === alice.publicKey())?.label, 'Signed');
  assert.equal(rows.find((row) => row.signerAddress === bob.publicKey())?.signature, 'none');

  const wrongNetwork = inboxSenderProgress({ mergedXdr: transaction.toXDR(), network: 'public', status: 'awaiting_signatures' }, asked);
  assert.ok(wrongNetwork.every((row) => row.signature === 'none'));
});

test('sender progress separates email, verified view and signing; unresolved delivery failures appear first', () => {
  const { alice, bob, carol, transaction, asked } = fixture();
  transaction.sign(alice);
  asked[0].notification = { label: 'Email bounced', tone: 'danger', occurredAt: '2026-11-19T12:01:00Z' };
  asked[1].notification = { label: 'Email delivered', tone: 'success', occurredAt: '2026-11-19T12:01:00Z' };
  asked[1].viewedAt = '2026-11-19T12:02:00Z';
  asked[2].notification = { label: 'Reminder failed', tone: 'danger', occurredAt: '2026-11-19T12:03:00Z' };
  const rows = inboxSenderProgress({ mergedXdr: transaction.toXDR(), network: 'testnet', status: 'awaiting_signatures' }, asked);

  assert.deepEqual(rows.map((row) => row.signerAddress), [carol.publicKey(), bob.publicKey(), alice.publicKey()]);
  assert.equal(rows[0].needsAttention, true);
  assert.match(rows[0].detail, /contact email/);
  assert.equal(rows[1].signature, 'none');
  assert.equal(rows[1].viewedAt, asked[1].viewedAt);
  assert.equal(rows[1].notification?.label, 'Email delivered');
  assert.equal(rows[2].needsAttention, false);
  assert.equal(rows[2].notification?.label, 'Email bounced');
});

test('complete authorization does not claim every invited signer has signed or needs a reminder', () => {
  const { transaction, asked } = fixture();
  asked[0].notification = { label: 'Email failed', tone: 'danger', occurredAt: '2026-11-19T12:01:00Z' };
  for (const status of ['ready', 'waiting_preconditions', 'submitted'] as const) {
    const rows = inboxSenderProgress({ mergedXdr: transaction.toXDR(), network: 'testnet', status }, asked);
    assert.ok(rows.every((row) => row.signature === 'none' && !row.needsAttention));
    assert.ok(rows.every((row) => /No signature reminder/.test(row.detail)));
  }
});

test('fee-bump signatures retain their scope instead of claiming the underlying transaction is signed', () => {
  const { alice, bob, transaction, asked } = fixture();
  transaction.sign(alice);
  const feeBump = TransactionBuilder.buildFeeBumpTransaction(bob, '100', transaction, Networks.TESTNET);
  feeBump.sign(bob);
  const rows = inboxSenderProgress({ mergedXdr: feeBump.toXDR(), network: 'testnet', status: 'awaiting_signatures' }, asked);
  assert.equal(rows.find((row) => row.signerAddress === alice.publicKey())?.signature, 'transaction');
  assert.equal(rows.find((row) => row.signerAddress === bob.publicKey())?.label, 'Fee signed');
});

test('unreadable signature evidence preserves coordination facts without declaring a signer done', () => {
  const { asked } = fixture();
  asked[0].viewedAt = '2026-11-19T12:02:00Z';
  const rows = inboxSenderProgress({ mergedXdr: 'invalid', network: 'testnet', status: 'awaiting_signatures' }, asked);
  assert.equal(rows[0].viewedAt, asked[0].viewedAt);
  assert.ok(rows.every((row) => row.signature === 'unknown' && row.needsAttention));
});
