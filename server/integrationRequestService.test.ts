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
import type { ConfiguredIntegrationCredential } from './integrationCredentialService.js';
import { createIntegrationSigningRequest } from './integrationRequestService.js';
import type {
  SigningRequestStore,
  StoredSignatureContribution,
  StoredSigningRequest,
  StoredSubmissionResult,
} from './requestStore.js';
import type { StellarAccountSnapshot } from '../src/stellar/types.js';

class MemoryRequestStore implements SigningRequestStore {
  requests = new Map<string, StoredSigningRequest>();
  contributions = new Map<string, StoredSignatureContribution[]>();
  submissions = new Map<string, StoredSubmissionResult>();
  async createRequest(request: StoredSigningRequest) { if (this.requests.has(request.id)) throw new Error('duplicate'); this.requests.set(request.id, request); }
  async getRequest(id: string) { return this.requests.get(id) ?? null; }
  async listContributions(id: string) { return this.contributions.get(id) ?? []; }
  async putContribution(id: string, contribution: StoredSignatureContribution) { this.contributions.set(id, [...(this.contributions.get(id) ?? []), contribution]); }
  async getSubmission(id: string, transactionHash: string) { const result = this.submissions.get(id); return result?.transactionHash === transactionHash ? result : null; }
  async putSubmission(id: string, submission: StoredSubmissionResult) { this.submissions.set(id, submission); }
}

function setup() {
  const source = Keypair.random();
  const second = Keypair.random();
  const transaction = new TransactionBuilder(new Account(source.publicKey(), '1'), {
    fee: '100', networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '10' }))
    .setTimeout(TimeoutInfinite)
    .build();
  const snapshot: StellarAccountSnapshot = {
    accountId: source.publicKey(), sequence: '1', subentryCount: 1, numSponsoring: 0, numSponsored: 0,
    thresholds: { low: 1, medium: 2, high: 2 },
    signers: [
      { key: source.publicKey(), type: 'ed25519_public_key', weight: 1 },
      { key: second.publicKey(), type: 'ed25519_public_key', weight: 1 },
    ],
  };
  return { source, transaction, snapshot };
}

function integrationFor(accountId: string, external = false): ConfiguredIntegrationCredential {
  return {
    serviceId: 'fednetwork', label: 'FedNetwork', secretHash: 'ab'.repeat(32),
    networks: ['testnet'],
    classicAccounts: [accountId],
    classicExternalExecutionAccounts: external ? [accountId] : [],
    sorobanContracts: [],
    sorobanExecutionAccounts: [],
  };
}

test('Integration creates an unsigned external-execution Request without pretending to be a signer', async () => {
  const store = new MemoryRequestStore();
  const { transaction, snapshot } = setup();
  const result = await createIntegrationSigningRequest(store, integrationFor(snapshot.accountId, true), {
    network: 'testnet',
    xdr: transaction.toXdr(),
    idempotencyKey: 'identity-transfer-42',
    externalReference: 'transfer-42',
  }, { accountLoader: async () => snapshot, now: new Date('2026-09-15T09:00:00Z') });

  assert.equal(result.replayed, false);
  assert.equal(result.externalReference, 'transfer-42');
  assert.equal(result.request.execution?.mode, 'external');
  assert.equal(result.request.execution?.executor.id, 'fednetwork');
  const stored = store.requests.get(result.request.id);
  assert.equal(stored?.creatorAddress, undefined);
  assert.deepEqual(stored?.creatorActor, { type: 'service', id: 'fednetwork', label: 'FedNetwork' });
  assert.equal(stored?.integration?.executionMode, 'external');
  assert.equal(stored?.integration?.correlationId, 'transfer-42');
  assert.ok(stored?.discoverySignerKeys?.includes(snapshot.accountId));
});

test('Integration Classic treasury defaults to the ordinary MultiSigTools execution path', async () => {
  const store = new MemoryRequestStore();
  const { transaction, snapshot } = setup();
  const result = await createIntegrationSigningRequest(store, integrationFor(snapshot.accountId), {
    network: 'testnet',
    xdr: transaction.toXdr(),
    idempotencyKey: 'treasury-payment-42',
  }, { accountLoader: async () => snapshot });

  assert.equal(result.request.execution, undefined);
  assert.equal(store.requests.get(result.request.id)?.integration?.executionMode, 'multisigtools');
});

test('Integration idempotency replays the exact Request and rejects a changed payload', async () => {
  const store = new MemoryRequestStore();
  const { transaction, snapshot } = setup();
  const input = { network: 'testnet' as const, xdr: transaction.toXdr(), idempotencyKey: 'same-transfer' };
  const first = await createIntegrationSigningRequest(store, integrationFor(snapshot.accountId), input, { accountLoader: async () => snapshot });
  const replay = await createIntegrationSigningRequest(store, integrationFor(snapshot.accountId), input, { accountLoader: async () => snapshot });
  assert.equal(replay.replayed, true);
  assert.equal(replay.request.id, first.request.id);

  const changedXdr = new TransactionBuilder(new Account(snapshot.accountId, '1'), {
    fee: '100', networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '11' }))
    .setTimeout(TimeoutInfinite)
    .build()
    .toXdr();
  await assert.rejects(
    () => createIntegrationSigningRequest(store, integrationFor(snapshot.accountId), { ...input, xdr: changedXdr }, { accountLoader: async () => snapshot }),
    (cause: unknown) => cause instanceof Error && 'code' in cause && cause.code === 'idempotency_conflict',
  );
});

test('Integration cannot smuggle existing Stellar signatures into Request creation', async () => {
  const store = new MemoryRequestStore();
  const { source, transaction, snapshot } = setup();
  const signed = TransactionBuilder.fromXdr(transaction.toXdr(), Networks.TESTNET);
  signed.sign(source);
  await assert.rejects(
    () => createIntegrationSigningRequest(store, integrationFor(snapshot.accountId), {
      network: 'testnet', xdr: signed.toXdr(), idempotencyKey: 'signed-transfer',
    }, { accountLoader: async () => snapshot }),
    (cause: unknown) => cause instanceof Error
      && 'code' in cause
      && cause.code === 'integration_signed_xdr_unsupported',
  );
});

test('Integration Classic Request rejects mixed internal and external execution policy', async () => {
  const store = new MemoryRequestStore();
  const primary = Keypair.random();
  const secondary = Keypair.random();
  const transaction = new TransactionBuilder(new Account(primary.publicKey(), '1'), {
    fee: '100', networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({
      source: secondary.publicKey(),
      destination: Keypair.random().publicKey(),
      asset: Asset.native(),
      amount: '1',
    }))
    .setTimeout(TimeoutInfinite)
    .build();
  const credential: ConfiguredIntegrationCredential = {
    ...integrationFor(primary.publicKey(), true),
    classicAccounts: [primary.publicKey(), secondary.publicKey()],
    classicExternalExecutionAccounts: [primary.publicKey()],
  };
  await assert.rejects(
    () => createIntegrationSigningRequest(store, credential, {
      network: 'testnet', xdr: transaction.toXdr(), idempotencyKey: 'mixed-policy',
    }),
    (cause: unknown) => cause instanceof Error
      && 'code' in cause
      && cause.code === 'integration_classic_execution_policy_conflict',
  );
});

test('Integration Classic Request rejects unbound source accounts', async () => {
  const store = new MemoryRequestStore();
  const { transaction, snapshot } = setup();
  const denied = integrationFor(Keypair.random().publicKey());
  await assert.rejects(
    () => createIntegrationSigningRequest(store, denied, {
      network: 'testnet', xdr: transaction.toXdr(), idempotencyKey: 'wrong-treasury',
    }, { accountLoader: async () => snapshot }),
    (cause: unknown) => cause instanceof Error
      && 'code' in cause
      && cause.code === 'integration_classic_account_not_allowed',
  );
});
