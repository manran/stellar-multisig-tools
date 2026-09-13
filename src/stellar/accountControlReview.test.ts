import assert from 'node:assert/strict';
import test from 'node:test';
import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { summarizeAccountControlReview } from './accountControlReview.js';
import type { StellarAccountSnapshot } from './types.js';

const SIGNED_PAYLOAD = 'PA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAQACAQDAQCQMBYIBEFAWDANBYHRAEISCMKBKFQXDAMRUGY4DUPB6IBZGM';

test('derives exact signer and threshold changes from XDR plus current account state', () => {
  const master = Keypair.random();
  const removed = Keypair.random();
  const kept = Keypair.random();
  const added = Keypair.random();
  const account: StellarAccountSnapshot = {
    accountId: master.publicKey(),
    sequence: '10',
    subentryCount: 2,
    numSponsoring: 0,
    numSponsored: 0,
    thresholds: { low: 2, medium: 2, high: 2 },
    signers: [
      { key: master.publicKey(), type: 'ed25519_public_key', weight: 1 },
      { key: removed.publicKey(), type: 'ed25519_public_key', weight: 1 },
      { key: kept.publicKey(), type: 'ed25519_public_key', weight: 1 },
    ],
  };
  const xdr = new TransactionBuilder(new Account(account.accountId, account.sequence), {
    fee: '300',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: removed.publicKey(), weight: 0 } }))
    .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: added.publicKey(), weight: 1 } }))
    .addOperation(Operation.setOptions({ masterWeight: 0, lowThreshold: 1, medThreshold: 1, highThreshold: 2 }))
    .setTimeout(3600)
    .build()
    .toXDR();

  const summary = summarizeAccountControlReview(xdr, 'testnet', account);
  assert.ok(summary);
  assert.equal(summary.sourceAccount, master.publicKey());
  assert.ok(summary.changes.some((change) => change.label === 'Remove signer' && change.address === removed.publicKey()));
  assert.ok(summary.changes.some((change) => change.label === 'Add signer' && change.address === added.publicKey()));
  assert.ok(summary.changes.some((change) => change.label === 'Account key' && change.after === 'No approval power'));
  assert.ok(summary.changes.some((change) => change.label === 'Standard transactions' && change.before === 'Approval power 2' && change.after === 'Approval power 1'));
  assert.equal(summary.currentHighRequirement?.threshold, 2);
  assert.equal(summary.currentHighRequirement?.policyLabel, '2-of-3');
  assert.equal(summary.currentHighRequirement?.requirementLabel, '2 of 3 approvals');
});

test('marks a resulting unreachable threshold as a critical account-control risk', () => {
  const master = Keypair.random();
  const removed = Keypair.random();
  const account: StellarAccountSnapshot = {
    accountId: master.publicKey(),
    sequence: '10',
    subentryCount: 1,
    numSponsoring: 0,
    numSponsored: 0,
    thresholds: { low: 1, medium: 2, high: 2 },
    signers: [
      { key: master.publicKey(), type: 'ed25519_public_key', weight: 1 },
      { key: removed.publicKey(), type: 'ed25519_public_key', weight: 1 },
    ],
  };
  const xdr = new TransactionBuilder(new Account(account.accountId, account.sequence), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: removed.publicKey(), weight: 0 } }))
    .setTimeout(3600)
    .build()
    .toXDR();

  const summary = summarizeAccountControlReview(xdr, 'testnet', account);
  assert.ok(summary);
  assert.ok(summary.risks.some((risk) => risk.severity === 'critical' && risk.key === 'unreachable:high'));
});

test('warns when a proposed policy reduces signer-loss tolerance', () => {
  const master = Keypair.random();
  const removed = Keypair.random();
  const kept = Keypair.random();
  const account: StellarAccountSnapshot = {
    accountId: master.publicKey(),
    sequence: '10',
    subentryCount: 2,
    numSponsoring: 0,
    numSponsored: 0,
    thresholds: { low: 1, medium: 2, high: 2 },
    signers: [
      { key: master.publicKey(), type: 'ed25519_public_key', weight: 1 },
      { key: removed.publicKey(), type: 'ed25519_public_key', weight: 1 },
      { key: kept.publicKey(), type: 'ed25519_public_key', weight: 1 },
    ],
  };
  const xdr = new TransactionBuilder(new Account(account.accountId, account.sequence), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: removed.publicKey(), weight: 0 } }))
    .setTimeout(3600)
    .build()
    .toXDR();

  const summary = summarizeAccountControlReview(xdr, 'testnet', account);
  assert.ok(summary);
  assert.ok(summary.risks.some((risk) => risk.severity === 'warning' && risk.key === 'resilience:high'));
});

test('warns when account-control changes introduce a single high-threshold controller', () => {
  const master = Keypair.random();
  const signerA = Keypair.random();
  const signerB = Keypair.random();
  const account: StellarAccountSnapshot = {
    accountId: master.publicKey(),
    sequence: '10',
    subentryCount: 2,
    numSponsoring: 0,
    numSponsored: 0,
    thresholds: { low: 1, medium: 2, high: 2 },
    signers: [
      { key: master.publicKey(), type: 'ed25519_public_key', weight: 1 },
      { key: signerA.publicKey(), type: 'ed25519_public_key', weight: 1 },
      { key: signerB.publicKey(), type: 'ed25519_public_key', weight: 1 },
    ],
  };
  const xdr = new TransactionBuilder(new Account(account.accountId, account.sequence), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.setOptions({ highThreshold: 1 }))
    .setTimeout(3600)
    .build()
    .toXDR();

  const summary = summarizeAccountControlReview(xdr, 'testnet', account);
  assert.ok(summary);
  assert.ok(summary.risks.some((risk) => risk.key === 'single-high-controller'));
});

test('still describes proposed SetOptions when current Horizon state is unavailable', () => {
  const master = Keypair.random();
  const signer = Keypair.random();
  const xdr = new TransactionBuilder(new Account(master.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: signer.publicKey(), weight: 0 } }))
    .setTimeout(3600)
    .build()
    .toXDR();
  const summary = summarizeAccountControlReview(xdr, 'testnet');
  assert.equal(summary?.changes[0]?.label, 'Remove signer');
  assert.equal(summary?.changes[0]?.address, signer.publicKey());
  assert.deepEqual(summary?.risks, []);
});

test('describes an imported signed-payload signer when current Horizon state is unavailable', () => {
  const master = Keypair.random();
  const xdr = new TransactionBuilder(new Account(master.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.setOptions({ signer: { ed25519SignedPayload: SIGNED_PAYLOAD, weight: 1 } }))
    .setTimeout(3600)
    .build()
    .toXDR();

  const summary = summarizeAccountControlReview(xdr, 'testnet');
  assert.equal(summary?.changes[0]?.label, 'Set signer');
  assert.equal(summary?.changes[0]?.address, SIGNED_PAYLOAD);
  assert.equal(summary?.changes[0]?.after, 'Approval power 1');
});

test('derives signed-payload signer removal from current account state', () => {
  const master = Keypair.random();
  const account: StellarAccountSnapshot = {
    accountId: master.publicKey(),
    sequence: '10',
    subentryCount: 1,
    numSponsoring: 0,
    numSponsored: 0,
    thresholds: { low: 1, medium: 1, high: 1 },
    signers: [
      { key: master.publicKey(), type: 'ed25519_public_key', weight: 1 },
      { key: SIGNED_PAYLOAD, type: 'ed25519_signed_payload', weight: 1 },
    ],
  };
  const xdr = new TransactionBuilder(new Account(account.accountId, account.sequence), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.setOptions({ signer: { ed25519SignedPayload: SIGNED_PAYLOAD, weight: 0 } }))
    .setTimeout(3600)
    .build()
    .toXDR();

  const summary = summarizeAccountControlReview(xdr, 'testnet', account);
  assert.ok(summary);
  assert.ok(summary.changes.some((change) =>
    change.label === 'Remove signer'
    && change.address === SIGNED_PAYLOAD
    && change.before === 'Approval power 1'
    && change.after === 'Removed',
  ));
});
