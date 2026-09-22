import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { designExactMultisigPolicy, designExistingMultisigPolicy } from './multisigDesigner.js';
import { buildMultisigSetupXdr, DEFAULT_MULTISIG_SETUP_TIMEOUT_SECONDS } from './multisigSetupXdr.js';
import type { StellarAccountSnapshot } from '../../packages/stellar-core/src/types.js';

function accountFor(master: Keypair): StellarAccountSnapshot {
  return {
    accountId: master.publicKey(),
    sequence: '123',
    subentryCount: 0,
    numSponsoring: 0,
    numSponsored: 0,
    thresholds: { low: 0, medium: 0, high: 0 },
    signers: [{ key: master.publicKey(), type: 'ed25519_public_key', weight: 1 }],
  };
}

test('builds signer additions before the final threshold/master operation', () => {
  const master = Keypair.random();
  const signerB = Keypair.random();
  const signerC = Keypair.random();
  const account = accountFor(master);
  const design = designExactMultisigPolicy(account, {
    additionalSignerKeys: [signerB.publicKey(), signerC.publicKey()],
    keepMaster: true,
    paymentQuorum: 2,
    adminQuorum: 3,
  });

  const xdr = buildMultisigSetupXdr(account, 'testnet', design);
  const transaction = TransactionBuilder.fromXdr(xdr, Networks.TESTNET) as any;
  assert.equal(transaction.operations.length, 3);

  const first = transaction.operations[0] as any;
  const second = transaction.operations[1] as any;
  const final = transaction.operations[2] as any;
  assert.equal(first.type, 'setOptions');
  assert.equal(first.signer.ed25519PublicKey, signerB.publicKey());
  assert.equal(first.signer.weight, 1);
  assert.equal(second.signer.ed25519PublicKey, signerC.publicKey());
  assert.equal(second.signer.weight, 1);
  assert.equal(final.masterWeight, 1);
  assert.equal(final.lowThreshold, 2);
  assert.equal(final.medThreshold, 2);
  assert.equal(final.highThreshold, 3);
  assert.equal(final.signer, undefined);
});

test('uses the network base fee supplied by reserve preflight', () => {
  const master = Keypair.random();
  const signerB = Keypair.random();
  const signerC = Keypair.random();
  const account = accountFor(master);
  const design = designExactMultisigPolicy(account, {
    additionalSignerKeys: [signerB.publicKey(), signerC.publicKey()],
    keepMaster: true,
    paymentQuorum: 2,
    adminQuorum: 3,
  });

  const transaction = TransactionBuilder.fromXdr(
    buildMultisigSetupXdr(account, 'testnet', design, 250),
    Networks.TESTNET,
  ) as any;
  assert.equal(transaction.fee, '750');
});

test('puts master weight zero only in the final operation when disabling the master', () => {
  const master = Keypair.random();
  const signerB = Keypair.random();
  const signerC = Keypair.random();
  const account = accountFor(master);
  const design = designExactMultisigPolicy(account, {
    additionalSignerKeys: [signerB.publicKey(), signerC.publicKey()],
    keepMaster: false,
    paymentQuorum: 2,
    adminQuorum: 2,
  });

  const transaction = TransactionBuilder.fromXdr(
    buildMultisigSetupXdr(account, 'testnet', design),
    Networks.TESTNET,
  ) as any;
  const final = transaction.operations.at(-1) as any;
  assert.equal(final.masterWeight, 0);
  assert.equal(final.highThreshold, 2);
});


test('uses a 24-hour default signing window and accepts an explicit preset', () => {
  const master = Keypair.random();
  const signerB = Keypair.random();
  const account = accountFor(master);
  const design = designExactMultisigPolicy(account, {
    additionalSignerKeys: [signerB.publicKey()],
    keepMaster: true,
    paymentQuorum: 2,
    adminQuorum: 2,
  });

  const defaultTransaction = TransactionBuilder.fromXdr(
    buildMultisigSetupXdr(account, 'testnet', design),
    Networks.TESTNET,
  ) as any;
  const oneHourTransaction = TransactionBuilder.fromXdr(
    buildMultisigSetupXdr(account, 'testnet', design, 100, 60 * 60),
    Networks.TESTNET,
  ) as any;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const defaultRemaining = Number(defaultTransaction.timeBounds.maxTime) - nowSeconds;
  const oneHourRemaining = Number(oneHourTransaction.timeBounds.maxTime) - nowSeconds;
  assert.ok(defaultRemaining >= DEFAULT_MULTISIG_SETUP_TIMEOUT_SECONDS - 10);
  assert.ok(defaultRemaining <= DEFAULT_MULTISIG_SETUP_TIMEOUT_SECONDS + 10);
  assert.ok(oneHourRemaining >= 60 * 60 - 10);
  assert.ok(oneHourRemaining <= 60 * 60 + 10);
});


test('builds existing multisig removals before additions and final thresholds', () => {
  const master = Keypair.random();
  const signerB = Keypair.random();
  const signerC = Keypair.random();
  const signerD = Keypair.random();
  const account = accountFor(master);
  account.subentryCount = 2;
  account.thresholds = { low: 2, medium: 2, high: 2 };
  account.signers.push(
    { key: signerB.publicKey(), type: 'ed25519_public_key', weight: 1 },
    { key: signerC.publicKey(), type: 'ed25519_public_key', weight: 1 },
  );
  const design = designExistingMultisigPolicy(account, {
    additionalSignerKeys: [signerC.publicKey(), signerD.publicKey()],
    keepMaster: true,
    paymentQuorum: 2,
    adminQuorum: 3,
  });
  const transaction = TransactionBuilder.fromXdr(
    buildMultisigSetupXdr(account, 'testnet', design),
    Networks.TESTNET,
  ) as any;
  assert.equal(transaction.operations.length, 3);
  assert.equal(transaction.operations[0].signer.ed25519PublicKey, signerB.publicKey());
  assert.equal(transaction.operations[0].signer.weight, 0);
  assert.equal(transaction.operations[1].signer.ed25519PublicKey, signerD.publicKey());
  assert.equal(transaction.operations[1].signer.weight, 1);
  assert.equal(transaction.operations[2].highThreshold, 3);
});
