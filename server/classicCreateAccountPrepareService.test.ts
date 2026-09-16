import assert from 'node:assert/strict';
import test from 'node:test';
import { FeeBumpTransaction, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { ClassicCreateAccountPrepareError, prepareClassicCreateAccount } from '../src/stellar/classicCreateAccountPrepare.js';
import { AccountNotFoundError, type StellarNetworkParameters } from '../src/stellar/horizon.js';
import type { StellarAccountSnapshot } from '../src/stellar/types.js';

const SOURCE = Keypair.random().publicKey();
const DESTINATION = Keypair.random().publicKey();
const parameters: StellarNetworkParameters = {
  ledgerSequence: 99,
  ledgerClosedAt: '2026-09-16T10:00:00Z',
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

function dependencies(destinationExists = false) {
  return {
    accountLoader: async (accountId: string) => {
      if (accountId === SOURCE) return account(SOURCE);
      if (accountId === DESTINATION && destinationExists) return account(DESTINATION);
      throw new AccountNotFoundError(accountId);
    },
    networkParametersLoader: async () => parameters,
  };
}

test('classic.account.create.prepare builds an explicit unsigned CreateAccount transaction', async () => {
  const result = await prepareClassicCreateAccount({
    network: 'testnet',
    sourceAccount: SOURCE,
    destination: DESTINATION,
    startingBalance: '2',
    memo: 'new-account',
    lifetimeSeconds: 3600,
  }, dependencies());
  assert.equal(result.operation, 'classic.account.create.prepare');
  assert.equal(result.destination, DESTINATION);
  assert.equal(result.startingBalance, '2');
  const parsed = TransactionBuilder.fromXdr(result.xdr, Networks.TESTNET);
  if (parsed instanceof FeeBumpTransaction) assert.fail('Expected a classic transaction.');
  assert.equal(parsed.signatures.length, 0);
  assert.equal(parsed.operations.length, 1);
  assert.equal(parsed.operations[0].type, 'createAccount');
});

test('classic.account.create.prepare preserves a hash memo for Private Note proof', async () => {
  const memoHashHex = 'cd'.repeat(32);
  const result = await prepareClassicCreateAccount({
    network: 'testnet', sourceAccount: SOURCE, destination: DESTINATION, startingBalance: '2', memoHashHex,
  }, dependencies());
  const parsed = TransactionBuilder.fromXdr(result.xdr, Networks.TESTNET);
  if (parsed instanceof FeeBumpTransaction) assert.fail('Expected a classic transaction.');
  assert.equal(parsed.memo.type, 'hash');
  assert.equal(Buffer.from(parsed.memo.value as Uint8Array).toString('hex'), memoHashHex);
});

test('classic.account.create.prepare refuses an already active destination instead of turning into Payment', async () => {
  await assert.rejects(
    () => prepareClassicCreateAccount({
      network: 'testnet',
      sourceAccount: SOURCE,
      destination: DESTINATION,
      startingBalance: '2',
    }, dependencies(true)),
    (cause: unknown) => cause instanceof ClassicCreateAccountPrepareError
      && cause.code === 'classic_account_create_destination_already_active',
  );
});

test('classic.account.create.prepare enforces the current network minimum starting balance', async () => {
  await assert.rejects(
    () => prepareClassicCreateAccount({
      network: 'testnet',
      sourceAccount: SOURCE,
      destination: DESTINATION,
      startingBalance: '0.5',
    }, dependencies()),
    (cause: unknown) => cause instanceof ClassicCreateAccountPrepareError
      && cause.code === 'classic_account_create_starting_balance_too_low',
  );
});
