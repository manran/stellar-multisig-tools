import assert from 'node:assert/strict';
import test from 'node:test';
import { FeeBumpTransaction, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { AccountNotFoundError, type StellarNetworkParameters } from '../../../../src/stellar/horizon.js';
import type { StellarAccountSnapshot } from '../../../../src/stellar/types.js';
import { ClassicPaymentPrepareError, prepareClassicPayment } from '../../../../src/stellar/classicPaymentPrepare.js';

const SOURCE = Keypair.random().publicKey();
const A = Keypair.random().publicKey();
const B = Keypair.random().publicKey();
const parameters: StellarNetworkParameters = {
  ledgerSequence: 99,
  ledgerClosedAt: '2026-09-15T15:00:00Z',
  baseFeeInStroops: 100,
  baseReserveInStroops: 5_000_000,
};

function account(accountId: string, balance = '100'): StellarAccountSnapshot {
  return {
    accountId,
    sequence: accountId === SOURCE ? '7' : '1',
    subentryCount: 0,
    numSponsoring: 0,
    numSponsored: 0,
    nativeBalance: balance,
    nativeSellingLiabilities: '0',
    balances: [{ assetType: 'native', assetCode: 'XLM', balance, sellingLiabilities: '0', buyingLiabilities: '0' }],
    thresholds: { low: 1, medium: 2, high: 2 },
    signers: [{ key: accountId, type: 'ed25519_public_key', weight: 1 }],
  };
}

function dependencies(known = new Map([[SOURCE, account(SOURCE)], [A, account(A)], [B, account(B)]])) {
  return {
    accountLoader: async (accountId: string) => {
      const value = known.get(accountId);
      if (!value) throw new AccountNotFoundError(accountId);
      return value;
    },
    networkParametersLoader: async () => parameters,
  };
}

test('classic.payment.prepare builds one exact unsigned Payment transaction from business input', async () => {
  const result = await prepareClassicPayment({
    network: 'testnet',
    sourceAccount: SOURCE,
    payments: [{ destination: A, amount: '2.5', asset: { type: 'native' } }],
    memo: 'invoice-42',
    lifetimeSeconds: 3600,
  }, dependencies());

  assert.equal(result.operation, 'classic.payment.prepare');
  assert.equal(result.sourceSequence, '7');
  assert.equal(result.paymentCount, 1);
  assert.equal(result.feeStroops, '100');
  assert.equal(result.transactionHash.length, 64);
  const parsed = TransactionBuilder.fromXdr(result.xdr, Networks.TESTNET);
  if (parsed instanceof FeeBumpTransaction) assert.fail('Expected a classic transaction.');
  assert.equal(parsed.signatures.length, 0);
  assert.equal(parsed.operations.length, 1);
  assert.equal(parsed.source, SOURCE);
  assert.equal(parsed.sequence, '8');
  assert.equal(parsed.operations[0].type, 'payment');
});

test('classic.payment.prepare can separate Treasury operation source from a managed transaction source', async () => {
  const channel = Keypair.random().publicKey();
  const result = await prepareClassicPayment({
    network: 'testnet',
    sourceAccount: SOURCE,
    payments: [{ destination: A, amount: '2.5', asset: { type: 'native' } }],
    lifetimeSeconds: 3600,
  }, {
    ...dependencies(),
    transactionSource: { accountId: channel, sequence: '20', snapshot: account(channel) },
  });

  const parsed = TransactionBuilder.fromXdr(result.xdr, Networks.TESTNET);
  if (parsed instanceof FeeBumpTransaction) assert.fail('Expected a classic transaction.');
  assert.equal(result.sourceAccount, SOURCE);
  assert.equal(result.sourceSequence, '7');
  assert.equal(result.transactionSourceAccount, channel);
  assert.equal(result.transactionSourceSequence, '20');
  assert.equal(parsed.source, channel);
  assert.equal(parsed.sequence, '21');
  assert.equal(parsed.operations[0].source, SOURCE);
  assert.equal(parsed.signatures.length, 0);
});

test('classic.payment.prepare rejects a managed transaction source that cannot cover the network fee', async () => {
  const channel = Keypair.random().publicKey();
  await assert.rejects(
    () => prepareClassicPayment({
      network: 'testnet',
      sourceAccount: SOURCE,
      payments: [{ destination: A, amount: '2.5', asset: { type: 'native' } }],
    }, {
      ...dependencies(),
      transactionSource: { accountId: channel, sequence: '20', snapshot: account(channel, '1') },
    }),
    (cause: unknown) => cause instanceof ClassicPaymentPrepareError
      && cause.code === 'classic_managed_transaction_source_unavailable',
  );
});

test('classic.payment.prepare preserves a hash memo for Private Note proof', async () => {
  const memoHashHex = 'ab'.repeat(32);
  const result = await prepareClassicPayment({
    network: 'testnet', sourceAccount: SOURCE,
    payments: [{ destination: A, amount: '2', asset: { type: 'native' } }],
    memoHashHex,
  }, dependencies());
  const parsed = TransactionBuilder.fromXdr(result.xdr, Networks.TESTNET);
  if (parsed instanceof FeeBumpTransaction) assert.fail('Expected a classic transaction.');
  assert.equal(parsed.memo.type, 'hash');
  assert.equal(Buffer.from(parsed.memo.value as Uint8Array).toString('hex'), memoHashHex);
});

test('classic.payment.prepare uses one transaction for a batch and charges one fee per operation', async () => {
  const result = await prepareClassicPayment({
    network: 'testnet',
    sourceAccount: SOURCE,
    payments: [
      { destination: A, amount: '1', asset: { type: 'native' } },
      { destination: B, amount: '2', asset: { type: 'native' } },
    ],
  }, dependencies());

  const parsed = TransactionBuilder.fromXdr(result.xdr, Networks.TESTNET);
  if (parsed instanceof FeeBumpTransaction) assert.fail('Expected a classic transaction.');
  assert.equal(result.paymentCount, 2);
  assert.equal(result.feeStroops, '200');
  assert.equal(parsed.operations.length, 2);
  assert.ok(parsed.operations.every((operation) => operation.type === 'payment'));
});

test('classic.payment.prepare refuses to silently turn Payment into CreateAccount', async () => {
  const missing = Keypair.random().publicKey();
  await assert.rejects(
    () => prepareClassicPayment({
      network: 'testnet',
      sourceAccount: SOURCE,
      payments: [{ destination: missing, amount: '2', asset: { type: 'native' } }],
    }, dependencies()),
    (cause: unknown) => cause instanceof ClassicPaymentPrepareError
      && cause.code === 'classic_payment_destination_not_active',
  );
});

test('classic.payment.prepare rejects duplicate recipient-asset rows instead of hiding accidental duplicates', async () => {
  await assert.rejects(
    () => prepareClassicPayment({
      network: 'testnet',
      sourceAccount: SOURCE,
      payments: [
        { destination: A, amount: '1', asset: { type: 'native' } },
        { destination: A, amount: '2', asset: { type: 'native' } },
      ],
    }, dependencies()),
    (cause: unknown) => cause instanceof ClassicPaymentPrepareError && cause.code === 'duplicate_payment',
  );
});
