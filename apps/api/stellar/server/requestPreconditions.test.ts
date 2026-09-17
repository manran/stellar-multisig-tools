import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TimeoutInfinite,
  TransactionBuilder,
} from '@stellar/stellar-sdk/base';
import { createSigningRequest } from './requestService.js';
import type {
  SigningRequestStore,
  StoredSignatureContribution,
  StoredSigningRequest,
  StoredSubmissionResult,
} from './requestStore.js';
import type { StellarAccountSnapshot } from '../../../../src/stellar/types.js';

class MemoryStore implements SigningRequestStore {
  requests = new Map<string, StoredSigningRequest>();
  contributions = new Map<string, Map<string, StoredSignatureContribution>>();
  submissions = new Map<string, StoredSubmissionResult>();

  async createRequest(request: StoredSigningRequest) { this.requests.set(request.id, request); }
  async getRequest(id: string) { return this.requests.get(id) ?? null; }
  async listContributions(id: string) { return [...(this.contributions.get(id)?.values() ?? [])]; }
  async putContribution(id: string, contribution: StoredSignatureContribution) {
    const entries = this.contributions.get(id) ?? new Map<string, StoredSignatureContribution>();
    entries.set(contribution.digest, contribution);
    this.contributions.set(id, entries);
  }
  async getSubmission(id: string, transactionHash: string) {
    const submission = this.submissions.get(id);
    return submission?.transactionHash === transactionHash ? submission : null;
  }
  async putSubmission(id: string, submission: StoredSubmissionResult) { this.submissions.set(id, submission); }
}

function snapshot(source: Keypair, second: Keypair, sequence: string): StellarAccountSnapshot {
  return {
    accountId: source.publicKey(),
    sequence,
    subentryCount: 1,
    numSponsoring: 0,
    numSponsored: 0,
    thresholds: { low: 1, medium: 2, high: 2 },
    signers: [
      { key: source.publicKey(), type: 'ed25519_public_key', weight: 1 },
      { key: second.publicKey(), type: 'ed25519_public_key', weight: 1 },
    ],
  };
}

function signedPayment(
  source: Keypair,
  second: Keypair,
  accountSequence: string,
  configure?: (builder: TransactionBuilder) => TransactionBuilder,
  timeoutSeconds = TimeoutInfinite,
) {
  let builder = new TransactionBuilder(new Account(source.publicKey(), accountSequence), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  }).addOperation(Operation.payment({
    destination: Keypair.random().publicKey(),
    asset: Asset.native(),
    amount: '1',
  }));
  if (configure) builder = configure(builder);
  const transaction = builder.setTimeout(timeoutSeconds).build();
  transaction.sign(source, second);
  return transaction;
}

test('request service accepts a CAP-21 relaxed sequence gap when minAccountSequence is satisfied', async () => {
  const store = new MemoryStore();
  const source = Keypair.random();
  const second = Keypair.random();
  const transaction = signedPayment(source, second, '19', (builder) => builder.setMinAccountSequence('8'));

  const request = await createSigningRequest(
    store,
    { network: 'testnet', xdr: transaction.toXdr() },
    {
      accountLoader: async () => snapshot(source, second, '10'),
      idFactory: () => 'R'.repeat(16),
    },
  );

  assert.equal(request.status, 'ready');
  assert.equal(request.statusReason, 'authorization_complete');
  assert.match(request.statusDetail ?? '', /precondition checks/);
});


test('request service keeps a fully signed request active while minAccountSequence is not reached', async () => {
  const store = new MemoryStore();
  const source = Keypair.random();
  const second = Keypair.random();
  const transaction = signedPayment(source, second, '19', (builder) => builder.setMinAccountSequence('12'));

  const request = await createSigningRequest(
    store,
    { network: 'testnet', xdr: transaction.toXdr() },
    {
      accountLoader: async () => snapshot(source, second, '10'),
      idFactory: () => 'W'.repeat(16),
    },
  );

  assert.equal(request.status, 'waiting_preconditions');
  assert.equal(request.statusReason, 'preconditions_not_met');
  assert.match(request.statusDetail ?? '', /not valid yet/);
});

test('request service uses latest ledger state for ledger-bound transactions', async () => {
  const store = new MemoryStore();
  const source = Keypair.random();
  const second = Keypair.random();
  const transaction = signedPayment(source, second, '1', (builder) => builder.setLedgerbounds(1, 101));
  let networkLoads = 0;

  const request = await createSigningRequest(
    store,
    { network: 'testnet', xdr: transaction.toXdr() },
    {
      accountLoader: async () => snapshot(source, second, '1'),
      networkParametersLoader: async () => {
        networkLoads += 1;
        return {
          ledgerSequence: 100,
          ledgerClosedAt: '2026-08-29T01:00:00Z',
          baseFeeInStroops: 100,
          baseReserveInStroops: 5_000_000,
        };
      },
      idFactory: () => 'N'.repeat(16),
    },
  );

  assert.equal(networkLoads, 1);
  assert.equal(request.status, 'expired');
  assert.equal(request.statusReason, 'transaction_expired');
  assert.match(request.statusDetail ?? '', /past its valid signing window/);
});


test('request service keeps a fully signed timed transaction non-submittable when ledger context is unavailable', async () => {
  const store = new MemoryStore();
  const source = Keypair.random();
  const second = Keypair.random();
  const transaction = signedPayment(source, second, '1', undefined, 300);

  const request = await createSigningRequest(
    store,
    { network: 'testnet', xdr: transaction.toXdr() },
    {
      accountLoader: async () => snapshot(source, second, '1'),
      networkParametersLoader: async () => { throw new Error('Horizon unavailable'); },
      idFactory: () => 'V'.repeat(16),
    },
  );

  assert.equal(request.status, 'waiting_preconditions');
  assert.equal(request.statusReason, 'preconditions_unavailable');
  assert.match(request.statusDetail ?? '', /ledger state is temporarily unavailable/i);
});
