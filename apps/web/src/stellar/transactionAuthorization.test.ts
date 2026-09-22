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
import { analyzeTransactionAuthorization } from '../../../../packages/stellar-core/src/transactionAuthorization.js';
import { inspectTransactionXdr } from '../../../../packages/stellar-core/src/transactionXdr.js';
import type { StellarAccountSnapshot } from '../../../../packages/stellar-core/src/types.js';

function accountSnapshot(
  accountId: string,
  signerKey = accountId,
  thresholds = { low: 1, medium: 1, high: 1 },
): StellarAccountSnapshot {
  return {
    accountId,
    sequence: '1',
    subentryCount: 0,
    numSponsoring: 0,
    numSponsored: 0,
    thresholds,
    signers: [{ key: signerKey, type: 'ed25519_public_key', weight: 1 }],
  };
}

function paymentBuilder(source: Keypair, extraSigners?: string[]) {
  const account = new Account(source.publicKey(), '1');
  return new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
    extraSigners,
  })
    .addOperation(Operation.payment({
      destination: Keypair.random().publicKey(),
      asset: Asset.native(),
      amount: '1',
    }))
    .setTimeout(300);
}

test('reports source threshold and extra signer as satisfied', () => {
  const source = Keypair.random();
  const extra = Keypair.random();
  const transaction = paymentBuilder(source, [extra.publicKey()]).build();
  transaction.sign(source, extra);

  const inspection = inspectTransactionXdr(transaction.toXdr(), 'testnet');
  const status = analyzeTransactionAuthorization(
    transaction.toXdr(),
    'testnet',
    inspection,
    [{ accountId: source.publicKey(), account: accountSnapshot(source.publicKey()) }],
  );

  assert.equal(status.sources.length, 1);
  assert.equal(status.sources[0]?.scope, 'inner');
  assert.equal(status.sources[0]?.satisfied, true);
  assert.equal(status.extraSigners.length, 1);
  assert.equal(status.extraSigners[0]?.satisfied, true);
  assert.equal(status.signatureRequirementsSatisfied, true);
  assert.equal(status.innerOutcome, 'authorized');
  assert.equal(status.coreAuthorizationValid, true);
  assert.deepEqual(status.coreUnusedInnerSignatureIndexes, []);
});

test('reports a missing mandatory extra signer separately from account threshold authorization', () => {
  const source = Keypair.random();
  const extra = Keypair.random();
  const transaction = paymentBuilder(source, [extra.publicKey()]).build();
  transaction.sign(source);

  const inspection = inspectTransactionXdr(transaction.toXdr(), 'testnet');
  const status = analyzeTransactionAuthorization(
    transaction.toXdr(),
    'testnet',
    inspection,
    [{ accountId: source.publicKey(), account: accountSnapshot(source.publicKey()) }],
  );

  assert.equal(status.sourceRequirementsSatisfied, true);
  assert.equal(status.extraSignerRequirementsSatisfied, false);
  assert.equal(status.signatureRequirementsSatisfied, false);
  assert.equal(status.extraSigners[0]?.satisfied, false);
  assert.equal(status.innerOutcome, 'missing');
});


test('keeps two-party operation sources as independent atomic authorization domains', () => {
  const partyA = Keypair.random();
  const partyB = Keypair.random();
  const transaction = new TransactionBuilder(new Account(partyA.publicKey(), '1'), {
    fee: '200',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({
      destination: partyB.publicKey(),
      asset: Asset.native(),
      amount: '1',
    }))
    .addOperation(Operation.payment({
      source: partyB.publicKey(),
      destination: partyA.publicKey(),
      asset: Asset.native(),
      amount: '2',
    }))
    .setTimeout(300)
    .build();

  transaction.sign(partyA);
  const inspection = inspectTransactionXdr(transaction.toXdr(), 'testnet');
  assert.deepEqual(inspection.sourceRequirements.map((requirement) => requirement.accountId), [
    partyA.publicKey(),
    partyB.publicKey(),
  ]);

  const accounts = [
    { accountId: partyA.publicKey(), account: accountSnapshot(partyA.publicKey()) },
    { accountId: partyB.publicKey(), account: accountSnapshot(partyB.publicKey()) },
  ];
  const partial = analyzeTransactionAuthorization(transaction.toXdr(), 'testnet', inspection, accounts);
  assert.equal(partial.sources.find((item) => item.accountId === partyA.publicKey())?.satisfied, true);
  assert.equal(partial.sources.find((item) => item.accountId === partyB.publicKey())?.satisfied, false);
  assert.equal(partial.innerOutcome, 'missing');

  transaction.sign(partyB);
  const completeInspection = inspectTransactionXdr(transaction.toXdr(), 'testnet');
  const complete = analyzeTransactionAuthorization(transaction.toXdr(), 'testnet', completeInspection, accounts);
  assert.equal(complete.sources.every((item) => item.satisfied === true), true);
  assert.equal(complete.innerOutcome, 'authorized');
  assert.equal(complete.coreAuthorizationValid, true);
});

test('keeps same-account fee-bump inner and outer authorization independent', () => {
  const source = Keypair.random();
  const inner = paymentBuilder(source).build();
  inner.sign(source);

  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    source,
    '100',
    inner,
    Networks.TESTNET,
  );
  feeBump.sign(source);

  const inspection = inspectTransactionXdr(feeBump.toXdr(), 'testnet');
  const status = analyzeTransactionAuthorization(
    feeBump.toXdr(),
    'testnet',
    inspection,
    [{ accountId: source.publicKey(), account: accountSnapshot(source.publicKey()) }],
  );

  assert.equal(status.sources.length, 2);
  assert.equal(status.sources.find((item) => item.scope === 'inner')?.satisfied, true);
  assert.equal(status.sources.find((item) => item.scope === 'outer')?.satisfied, true);
  assert.equal(status.signatureRequirementsSatisfied, true);
  assert.equal(status.innerOutcome, 'authorized');
  assert.equal(status.outerOutcome, 'authorized');
  assert.deepEqual(status.coreUnusedInnerSignatureIndexes, []);
  assert.deepEqual(status.coreUnusedOuterSignatureIndexes, []);
});

test('does not call Core-order usage complete when a source policy is unavailable', () => {
  const source = Keypair.random();
  const transaction = paymentBuilder(source).build();
  transaction.sign(source);

  const inspection = inspectTransactionXdr(transaction.toXdr(), 'testnet');
  const status = analyzeTransactionAuthorization(
    transaction.toXdr(),
    'testnet',
    inspection,
    [{ accountId: source.publicKey(), error: 'Horizon unavailable' }],
  );

  assert.equal(status.sources[0]?.satisfied, undefined);
  assert.equal(status.innerOutcome, 'unknown');
  assert.equal(status.coreUnusedInnerSignatureIndexes, null);
});

test('detects txBAD_AUTH_EXTRA when a valid signature is never consumed by Core', () => {
  const source = Keypair.random();
  const second = Keypair.random();
  const transaction = paymentBuilder(source).build();
  transaction.sign(source, second);

  const account = accountSnapshot(source.publicKey());
  account.signers.push({ key: second.publicKey(), type: 'ed25519_public_key', weight: 1 });

  const inspection = inspectTransactionXdr(transaction.toXdr(), 'testnet');
  const status = analyzeTransactionAuthorization(
    transaction.toXdr(),
    'testnet',
    inspection,
    [{ accountId: source.publicKey(), account }],
  );

  assert.equal(status.signatureRequirementsSatisfied, true);
  assert.equal(status.innerOutcome, 'bad_auth_extra');
  assert.equal(status.coreAuthorizationValid, false);
  assert.deepEqual(status.coreUsedInnerSignatureIndexes, [0]);
  assert.deepEqual(status.coreUnusedInnerSignatureIndexes, [1]);
});

test('checks low and medium authorization separately when threshold ordering is unusual', () => {
  const source = Keypair.random();
  const second = Keypair.random();
  const transaction = paymentBuilder(source).build();
  transaction.sign(source);

  const account = accountSnapshot(
    source.publicKey(),
    source.publicKey(),
    { low: 2, medium: 1, high: 1 },
  );
  account.signers.push({ key: second.publicKey(), type: 'ed25519_public_key', weight: 1 });

  const inspection = inspectTransactionXdr(transaction.toXdr(), 'testnet');
  const status = analyzeTransactionAuthorization(
    transaction.toXdr(),
    'testnet',
    inspection,
    [{ accountId: source.publicKey(), account }],
  );

  assert.equal(status.checks[0]?.threshold, 'low');
  assert.equal(status.checks[0]?.satisfied, false);
  assert.equal(status.checks[1]?.threshold, 'medium');
  assert.equal(status.checks[1]?.satisfied, true);
  assert.equal(status.sources[0]?.satisfied, false);
  assert.equal(status.innerOutcome, 'missing');
});
