import assert from 'node:assert/strict';
import test from 'node:test';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { capabilityHashForToken, requestCapabilityMatches, signerCanAccessTransaction, signerHasSignedTransaction } from './requestAccess.js';
import type { StoredSigningRequest } from './requestStore.js';

function request(overrides: Partial<StoredSigningRequest> = {}): StoredSigningRequest {
  return {
    version: 1,
    id: 'r'.repeat(32),
    network: 'testnet',
    baseXdr: 'AAAA',
    transactionHash: 'hash',
    createdAt: '2026-08-29T00:00:00.000Z',
    expiresAt: '2026-08-30T00:00:00.000Z',
    ...overrides,
  };
}

test('new requests do not treat request id as bearer authority', () => {
  const capability = 'c'.repeat(32);
  const stored = request({ capabilityHash: capabilityHashForToken(capability) });
  assert.equal(requestCapabilityMatches(stored, capability), true);
  assert.equal(requestCapabilityMatches(stored, stored.id), false);
  assert.equal(requestCapabilityMatches(stored, 'x'.repeat(32)), false);
});

test('a request without a capability hash never grants bearer access', () => {
  const stored = request();
  assert.equal(requestCapabilityMatches(stored, stored.id), false);
  assert.equal(requestCapabilityMatches(stored, 'x'.repeat(32)), false);
});


test('a signer who already approved cannot later present as a decline candidate', () => {
  const source = Keypair.random();
  const other = Keypair.random();
  const transaction = new TransactionBuilder(new Account(source.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({ destination: other.publicKey(), asset: Asset.native(), amount: '1' }))
    .setTimeout(300)
    .build();

  assert.equal(signerHasSignedTransaction(source.publicKey(), transaction.toXdr(), 'testnet'), false);
  transaction.sign(source);
  assert.equal(signerHasSignedTransaction(source.publicKey(), transaction.toXdr(), 'testnet'), true);
  assert.equal(signerHasSignedTransaction(other.publicKey(), transaction.toXdr(), 'testnet'), false);
});

test('either independent source-account signer can access the same multi-party transaction', async () => {
  const partyA = Keypair.random();
  const partyB = Keypair.random();
  const outsider = Keypair.random();
  const transaction = new TransactionBuilder(new Account(partyA.publicKey(), '1'), {
    fee: '200',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({ destination: partyB.publicKey(), asset: Asset.native(), amount: '1' }))
    .addOperation(Operation.payment({
      source: partyB.publicKey(),
      destination: partyA.publicKey(),
      asset: Asset.native(),
      amount: '2',
    }))
    .setTimeout(300)
    .build();

  const snapshots = new Map([partyA, partyB].map((keypair) => [keypair.publicKey(), {
    accountId: keypair.publicKey(),
    sequence: '1',
    subentryCount: 0,
    numSponsoring: 0,
    numSponsored: 0,
    thresholds: { low: 1, medium: 1, high: 1 },
    signers: [{ key: keypair.publicKey(), type: 'ed25519_public_key', weight: 1 }],
  }]));
  const accountLoader = async (accountId: string) => {
    const snapshot = snapshots.get(accountId);
    if (!snapshot) throw new Error('missing fixture account');
    return snapshot;
  };

  assert.equal(await signerCanAccessTransaction(partyA.publicKey(), transaction.toXdr(), 'testnet', accountLoader), true);
  assert.equal(await signerCanAccessTransaction(partyB.publicKey(), transaction.toXdr(), 'testnet', accountLoader), true);
  assert.equal(await signerCanAccessTransaction(outsider.publicKey(), transaction.toXdr(), 'testnet', accountLoader), false);
});

test('historical signature evidence does not imply current signer authority', async () => {
  const historicalSigner = Keypair.random();
  const currentSigner = Keypair.random();
  const transaction = new TransactionBuilder(new Account(historicalSigner.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({
      destination: Keypair.random().publicKey(),
      asset: Asset.native(),
      amount: '1',
    }))
    .setTimeout(300)
    .build();
  transaction.sign(historicalSigner);

  const currentAccount = {
    accountId: historicalSigner.publicKey(),
    sequence: '1',
    subentryCount: 1,
    numSponsoring: 0,
    numSponsored: 0,
    thresholds: { low: 1, medium: 1, high: 1 },
    signers: [{ key: currentSigner.publicKey(), type: 'ed25519_public_key' as const, weight: 1 }],
  };

  assert.equal(signerHasSignedTransaction(historicalSigner.publicKey(), transaction.toXdr(), 'testnet'), true);
  assert.equal(await signerCanAccessTransaction(
    historicalSigner.publicKey(),
    transaction.toXdr(),
    'testnet',
    async () => currentAccount,
  ), false);
});
