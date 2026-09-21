import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Account,
  Asset,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  TimeoutInfinite,
  TransactionBuilder,
} from '@stellar/stellar-sdk/base';
import type { ConfiguredIntegrationCredential } from './integrationCredentialService.js';
import type {
  ClassicManagedChannelLeaseStore,
  StoredClassicManagedChannelLease,
} from './classicManagedChannelStore.js';
import { createIntegrationPaymentSigningRequest, createIntegrationSigningRequest } from './integrationRequestService.js';
import { contributeSigningRequest, submitSigningRequest } from './requestService.js';
import type {
  SigningRequestStore,
  StoredSignatureContribution,
  StoredSigningRequest,
  StoredSubmissionResult,
} from './requestStore.js';
import type { StellarAccountSnapshot } from '../../../../src/stellar/types.js';

class MemoryChannelStore implements ClassicManagedChannelLeaseStore {
  leases = new Map<string, StoredClassicManagedChannelLease>();
  async getLeaseForRequest(requestId: string) {
    return [...this.leases.values()].find((item) => item.requestId === requestId) ?? null;
  }
  async claimLease(record: StoredClassicManagedChannelLease) {
    const key = `${record.network}:${record.channelAccount}`;
    const current = this.leases.get(key);
    if (current && current.requestId !== record.requestId && Date.parse(current.expiresAt) > Date.parse(record.leasedAt)) return false;
    this.leases.set(key, record);
    return true;
  }
  async releaseRequest(requestId: string) {
    for (const [key, value] of this.leases) if (value.requestId === requestId) this.leases.delete(key);
  }
  async listLeases(network: 'testnet' | 'public') {
    return [...this.leases.values()].filter((item) => item.network === network);
  }
}

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
    classicSourceAccounts: [accountId],
    classicExternalExecutionSourceAccounts: external ? [accountId] : [],
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
  assert.equal(stored?.executionPolicy?.mode, 'external');
  assert.deepEqual(stored?.integration, {
    version: 1, serviceId: 'fednetwork', serviceLabel: 'FedNetwork', correlationId: 'transfer-42',
  });
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

  assert.equal(result.request.execution?.mode, 'multisigtools');
  const stored = store.requests.get(result.request.id);
  assert.equal(stored?.executionPolicy?.mode, 'multisigtools');
  assert.deepEqual(stored?.integration, { version: 1, serviceId: 'fednetwork', serviceLabel: 'FedNetwork' });
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

test('Integration Classic source scope includes operation-level source accounts', async () => {
  const store = new MemoryRequestStore();
  const primary = Keypair.random();
  const operationSource = Keypair.random();
  const transaction = new TransactionBuilder(new Account(primary.publicKey(), '1'), {
    fee: '100', networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({
      source: operationSource.publicKey(),
      destination: Keypair.random().publicKey(),
      asset: Asset.native(),
      amount: '1',
    }))
    .setTimeout(TimeoutInfinite)
    .build();
  await assert.rejects(
    () => createIntegrationSigningRequest(store, integrationFor(primary.publicKey()), {
      network: 'testnet', xdr: transaction.toXdr(), idempotencyKey: 'operation-source-out-of-scope',
    }),
    (cause: unknown) => cause instanceof Error
      && 'code' in cause
      && cause.code === 'integration_classic_source_account_not_allowed',
  );
});

test('Integration Classic source scope includes fee-bump source accounts', async () => {
  const store = new MemoryRequestStore();
  const { transaction, snapshot } = setup();
  const feeSource = Keypair.random();
  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    feeSource,
    '200',
    transaction,
    Networks.TESTNET,
  );
  await assert.rejects(
    () => createIntegrationSigningRequest(store, integrationFor(snapshot.accountId), {
      network: 'testnet', xdr: feeBump.toXdr(), idempotencyKey: 'fee-source-out-of-scope',
    }),
    (cause: unknown) => cause instanceof Error
      && 'code' in cause
      && cause.code === 'integration_classic_source_account_not_allowed',
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
    classicSourceAccounts: [primary.publicKey(), secondary.publicKey()],
    classicExternalExecutionSourceAccounts: [primary.publicKey()],
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
      && cause.code === 'integration_classic_source_account_not_allowed',
  );
});


test('Integration can create a Classic Request from semantic payment input without constructing XDR', async () => {
  const store = new MemoryRequestStore();
  const source = Keypair.random();
  const signer = Keypair.random();
  const channel = Keypair.random();
  const destination = Keypair.random().publicKey();
  const sourceSnapshot: StellarAccountSnapshot = {
    accountId: source.publicKey(), sequence: '7', subentryCount: 0, numSponsoring: 0, numSponsored: 0,
    nativeBalance: '100', nativeSellingLiabilities: '0',
    balances: [{ assetType: 'native', assetCode: 'XLM', balance: '100', sellingLiabilities: '0', buyingLiabilities: '0' }],
    thresholds: { low: 1, medium: 2, high: 2 },
    signers: [
      { key: source.publicKey(), type: 'ed25519_public_key', weight: 1 },
      { key: signer.publicKey(), type: 'ed25519_public_key', weight: 1 },
    ],
  };
  const destinationSnapshot: StellarAccountSnapshot = {
    ...sourceSnapshot,
    accountId: destination,
    sequence: '1',
    thresholds: { low: 1, medium: 1, high: 1 },
    signers: [{ key: destination, type: 'ed25519_public_key', weight: 1 }],
  };
  const channelSnapshot: StellarAccountSnapshot = {
    ...sourceSnapshot,
    accountId: channel.publicKey(),
    sequence: '41',
    thresholds: { low: 1, medium: 1, high: 1 },
    signers: [{ key: channel.publicKey(), type: 'ed25519_public_key', weight: 1 }],
  };
  const accountLoader = async (accountId: string) => {
    if (accountId === source.publicKey()) return sourceSnapshot;
    if (accountId === destination) return destinationSnapshot;
    if (accountId === channel.publicKey()) return channelSnapshot;
    throw new Error('unexpected account');
  };
  const networkParametersLoader = async () => ({
    ledgerSequence: 1,
    ledgerClosedAt: '2026-09-15T09:00:00Z',
    baseFeeInStroops: 100,
    baseReserveInStroops: 5_000_000,
  });
  const input = {
    network: 'testnet' as const,
    payment: {
      sourceAccount: source.publicKey(),
      payments: [{ destination, amount: '2.5', asset: { type: 'native' as const } }],
      lifetimeSeconds: 3600,
    },
    idempotencyKey: 'semantic-payment-42',
    externalReference: 'invoice-42',
  };
  const channelStore = new MemoryChannelStore();
  const first = await createIntegrationPaymentSigningRequest(
    store,
    integrationFor(source.publicKey()),
    input,
    {
      accountLoader,
      networkParametersLoader,
      managedChannelStoreFactory: () => channelStore,
      managedChannels: [channel],
      now: new Date('2026-09-15T09:00:00Z'),
    },
  );
  assert.equal(first.replayed, false);
  assert.equal(first.request.status, 'awaiting_signatures');
  const stored = store.requests.get(first.request.id);
  assert.match(stored?.instructionDigest ?? '', /^[0-9a-f]{64}$/);
  const parsed = TransactionBuilder.fromXdr(first.request.baseXdr, Networks.TESTNET);
  if (parsed instanceof FeeBumpTransaction) assert.fail('Managed semantic payment must be a classic transaction.');
  assert.equal(parsed.operations.length, 1);
  assert.equal(parsed.operations[0].type, 'payment');
  assert.equal(parsed.source, channel.publicKey());
  assert.equal(parsed.sequence, '42');
  assert.equal(parsed.fee, '5000');
  assert.equal(parsed.operations[0].source, source.publicKey());
  assert.equal(parsed.signatures.length, 1);
  assert.equal(first.request.execution?.mode, 'multisigtools');
  assert.equal((await channelStore.getLeaseForRequest(first.request.id))?.channelAccount, channel.publicKey());

  const firstSignerXdr = TransactionBuilder.fromXdr(first.request.baseXdr, Networks.TESTNET);
  if (firstSignerXdr instanceof FeeBumpTransaction) assert.fail('Expected managed Classic transaction.');
  firstSignerXdr.sign(source);
  const afterFirstSigner = await contributeSigningRequest(store, first.request.id, firstSignerXdr.toXDR(), {
    accountLoader,
    networkParametersLoader,
  });
  assert.equal(afterFirstSigner.request.status, 'awaiting_signatures');

  const secondSignerXdr = TransactionBuilder.fromXdr(first.request.baseXdr, Networks.TESTNET);
  if (secondSignerXdr instanceof FeeBumpTransaction) assert.fail('Expected managed Classic transaction.');
  secondSignerXdr.sign(signer);
  const afterSecondSigner = await contributeSigningRequest(store, first.request.id, secondSignerXdr.toXDR(), {
    accountLoader,
    networkParametersLoader,
  });
  assert.equal(afterSecondSigner.request.status, 'ready');

  const submitted = await submitSigningRequest(store, first.request.id, {
    accountLoader,
    networkParametersLoader,
    transactionLoader: async () => null,
    transactionSubmitter: async (xdr, network) => {
      assert.equal(network, 'testnet');
      const envelope = TransactionBuilder.fromXdr(xdr, Networks.TESTNET);
      if (envelope instanceof FeeBumpTransaction) assert.fail('Expected managed Classic transaction.');
      assert.equal(envelope.source, channel.publicKey());
      assert.equal(envelope.signatures.length, 3);
      return { successful: true, hash: first.request.transactionHash, ledger: 123 };
    },
  });
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.submission?.ledger, 123);

  const replay = await createIntegrationPaymentSigningRequest(
    store,
    integrationFor(source.publicKey()),
    input,
    {
      accountLoader: async (accountId) => {
        if (accountId === source.publicKey()) return sourceSnapshot;
        if (accountId === channel.publicKey()) return channelSnapshot;
        throw new Error('semantic replay must not rebuild destinations');
      },
    },
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.request.id, first.request.id);

  await assert.rejects(
    () => createIntegrationPaymentSigningRequest(
      store,
      integrationFor(source.publicKey()),
      {
        ...input,
        payment: {
          ...input.payment,
          payments: [{ destination, amount: '3', asset: { type: 'native' as const } }],
        },
      },
      { accountLoader, networkParametersLoader },
    ),
    (cause: unknown) => cause instanceof Error && 'code' in cause && cause.code === 'idempotency_conflict',
  );


  await assert.rejects(
    () => createIntegrationPaymentSigningRequest(
      store,
      integrationFor(source.publicKey(), true),
      input,
      { accountLoader, networkParametersLoader },
    ),
    (cause: unknown) => cause instanceof Error && 'code' in cause && cause.code === 'idempotency_conflict',
  );
});
