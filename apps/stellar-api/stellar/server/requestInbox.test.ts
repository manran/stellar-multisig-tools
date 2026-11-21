import assert from 'node:assert/strict';
import test from 'node:test';
import { listSignerInbox } from './requestInbox.js';
import type { SigningRequestStore, StoredSigningRequest } from './requestStore.js';

function retiredRequest(): StoredSigningRequest {
  return {
    version: 1,
    id: 'a'.repeat(32),
    network: 'public',
    baseXdr: 'retired-prelaunch-xdr',
    transactionHash: 'retired',
    createdAt: '2026-08-30T00:00:00.000Z',
    expiresAt: '2026-08-31T00:00:00.000Z',
  };
}

function baseStore(overrides: Partial<SigningRequestStore> = {}): SigningRequestStore {
  return {
    async createRequest() { throw new Error('unexpected create'); },
    async getRequest() { throw new Error('unexpected request read'); },
    async listContributions() { throw new Error('unexpected contributions read'); },
    async putContribution() { throw new Error('unexpected contribution write'); },
    async getSubmission() { throw new Error('unexpected submission read'); },
    async putSubmission() { throw new Error('unexpected submission write'); },
    ...overrides,
  };
}

test('inbox ignores retired pre-launch request locator records', async () => {
  let inspectedRetiredRecord = false;
  const store = baseStore({
    async getRequest() {
      inspectedRetiredRecord = true;
      throw new Error('retired record should not be opened');
    },
    async listRequests() { return [retiredRequest()]; },
  });

  const requests = await listSignerInbox(store, 'G'.padEnd(56, 'A'), {
    now: new Date('2026-08-30T12:00:00.000Z'),
    network: 'public',
  });

  assert.deepEqual(requests, []);
  assert.equal(inspectedRetiredRecord, false);
});

test('inbox uses signer-first discovery without Horizon reverse lookup', async () => {
  const signer = 'G'.padEnd(56, 'S');
  let discoveryArgs: unknown[] = [];
  const store = baseStore({
    async listRequests() { throw new Error('global scan should not run'); },
    async listRequestsByDiscoverySubjects(network, accountIds, directSignerKey) {
      discoveryArgs = [network, accountIds, directSignerKey];
      return [];
    },
  });

  const requests = await listSignerInbox(store, signer, { network: 'public' });

  assert.deepEqual(requests, []);
  assert.deepEqual(discoveryArgs, ['public', [], signer]);
});

test('inbox falls back to the legacy scan when signer index lookup is unavailable', async () => {
  let legacyScans = 0;
  const store = baseStore({
    async listRequests() {
      legacyScans += 1;
      return [retiredRequest()];
    },
    async listRequestsByDiscoverySubjects() {
      throw new Error('temporary index failure');
    },
  });

  const requests = await listSignerInbox(store, 'G'.padEnd(56, 'S'), {
    now: new Date('2026-08-30T12:00:00.000Z'),
    network: 'public',
  });

  assert.deepEqual(requests, []);
  assert.equal(legacyScans, 1);
});

test('Human Inbox action projection recognizes the current signer signature and decline evidence', async () => {
  const { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } = await import('@stellar/stellar-sdk');
  const signer = Keypair.random();
  const destination = Keypair.random();
  const build = () => new TransactionBuilder(new Account(signer.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({
      destination: destination.publicKey(),
      asset: Asset.native(),
      amount: '1.0000000',
    }))
    .setTimeout(3600)
    .build();

  const signed = build();
  signed.sign(signer);
  const unsigned = build();
  const baseSnapshot = {
    id: '0'.repeat(16),
    network: 'testnet' as const,
    transactionHash: 'hash',
    baseXdr: unsigned.toXDR(),
    createdAt: '2026-09-06T00:00:00.000Z',
    expiresAt: '2026-09-07T00:00:00.000Z',
    contributionCount: 0,
    signatureCount: 0,
    statusReason: 'signatures_required' as const,
  };

  const coordinationReads: string[] = [];
  const store = baseStore({
    async listActivityEvents(id) {
      return id === '1'.repeat(16)
        ? [{
            version: 1,
            eventId: `declined-${signer.publicKey()}`,
            requestId: id,
            type: 'approval_declined',
            occurredAt: '2026-09-06T00:01:00.000Z',
            actorAddress: signer.publicKey(),
          }]
        : [];
    },
    async listRequestCoordinationEvents(id) {
      coordinationReads.push(id);
      return [
        {
          version: 1,
          eventId: `asked-${destination.publicKey()}`,
          requestId: id,
          type: 'signer_requested',
          occurredAt: '2026-09-06T00:02:00.000Z',
          actorAddress: signer.publicKey(),
          subjectAddress: destination.publicKey(),
        },
        {
          version: 1,
          eventId: 'unrelated-ask',
          requestId: id,
          type: 'signer_requested',
          occurredAt: '2026-09-06T00:03:00.000Z',
          actorAddress: destination.publicKey(),
          subjectAddress: signer.publicKey(),
        },
      ];
    },
  });
  const { projectHumanInboxRequests } = await import('./requestInbox.js');
  const projected = await projectHumanInboxRequests(store, signer.publicKey(), [
    { ...baseSnapshot, id: '0'.repeat(16), mergedXdr: signed.toXDR(), status: 'awaiting_signatures' as const },
    { ...baseSnapshot, id: '1'.repeat(16), mergedXdr: unsigned.toXDR(), status: 'awaiting_signatures' as const },
    { ...baseSnapshot, id: '2'.repeat(16), mergedXdr: unsigned.toXDR(), status: 'ready' as const, statusReason: 'authorization_complete' as const },
    { ...baseSnapshot, id: '3'.repeat(16), mergedXdr: unsigned.toXDR(), status: 'ready' as const, statusReason: 'authorization_complete' as const, execution: { mode: 'multisigtools' as const } },
    { ...baseSnapshot, id: '4'.repeat(16), mergedXdr: unsigned.toXDR(), status: 'ready' as const, statusReason: 'authorization_complete' as const, execution: { mode: 'external' as const, executor: { type: 'service' as const, id: 'fednetwork' } } },
  ]);

  assert.deepEqual(projected.map((item) => item.viewerAction), [
    'waiting_for_others',
    'declined',
    'route_execution',
    'submit',
    'waiting_execution',
  ]);
  assert.deepEqual(coordinationReads, ['0'.repeat(16)]);
  assert.equal(projected[0]?.coordinationEvents?.length, 1);
  assert.equal(projected[0]?.coordinationEvents?.[0]?.type, 'signer_requested');
  assert.equal(projected[0]?.coordinationEvents?.[0]?.actorAddress, signer.publicKey());
  assert.equal(projected[1]?.coordinationEvents, undefined);
});

test('legacy exact Soroban Proposal stays on the already-routed submit path when stored execution policy is absent', async () => {
  const {
    Account,
    Contract,
    Keypair,
    Networks,
    Operation,
    SorobanDataBuilder,
    TimeoutInfinite,
    TransactionBuilder,
    nativeToScVal,
    xdr,
  } = await import('@stellar/stellar-sdk');
  const source = Keypair.random();
  const contract = new Contract('CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE');
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: contract.address().toScAddress(),
    functionName: 'approve_proposal',
    args: [nativeToScVal('proposal')],
  });
  const transaction = new TransactionBuilder(new Account(source.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs),
      auth: [],
    }))
    .setSorobanData(new SorobanDataBuilder().build())
    .setTimeout(TimeoutInfinite)
    .build();
  const { projectHumanInboxRequests } = await import('./requestInbox.js');
  const [projected] = await projectHumanInboxRequests(baseStore(), source.publicKey(), [{
    id: '5'.repeat(16),
    network: 'testnet',
    transactionHash: 'legacy-soroban',
    baseXdr: transaction.toXDR(),
    mergedXdr: transaction.toXDR(),
    createdAt: '2026-09-06T00:00:00.000Z',
    expiresAt: '2026-09-07T00:00:00.000Z',
    contributionCount: 0,
    signatureCount: 0,
    status: 'ready',
    statusReason: 'authorization_complete',
  }]);

  assert.equal(projected.viewerAction, 'submit');
});


test('non-signer proposer sees only own live Request as waiting, not a signature/submit task', async () => {
  const { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } = await import('@stellar/stellar-sdk');
  const source = Keypair.random().publicKey();
  const proposer = Keypair.random().publicKey();
  const other = Keypair.random().publicKey();
  const destination = Keypair.random().publicKey();
  const tx = new TransactionBuilder(new Account(source, '1'), {
    fee: '100', networkPassphrase: Networks.TESTNET,
  }).addOperation(Operation.payment({ destination, asset: Asset.native(), amount: '1' }))
    .setTimeout(3600).build();
  const request: StoredSigningRequest = {
    version: 1, id: 'ABCDEF0123456789', network: 'testnet',
    baseXdr: tx.toXDR(), transactionHash: Buffer.from(tx.hash()).toString('hex'),
    createdAt: '2026-11-21T09:00:00.000Z', expiresAt: '2026-11-21T13:00:00.000Z',
    proposerAddress: proposer,
  };
  const store = baseStore({
    async getRequest(id) { return id === request.id ? request : null; },
    async listRequestsByProposer(_network, address) { return address === proposer ? [request] : []; },
    async listRequestsByDiscoverySubjects() { return []; },
    async listContributions() { return []; },
    async getSubmission() { return null; },
    async listRequestCoordinationEvents() { return [{
      version: 1, eventId: 'asked', requestId: request.id,
      type: 'signer_requested', occurredAt: '2026-11-21T09:01:00.000Z',
      actorAddress: proposer, subjectAddress: source,
    }]; },
  });
  const sourceAccount = {
    accountId: source, sequence: '1', subentryCount: 0, numSponsoring: 0, numSponsored: 0,
    nativeBalance: '100', nativeSellingLiabilities: '0',
    balances: [{ assetType: 'native', assetCode: 'XLM', balance: '100', sellingLiabilities: '0', buyingLiabilities: '0' }],
    thresholds: { low: 1, medium: 2, high: 2 },
    signers: [{ key: source, type: 'ed25519_public_key', weight: 1 }],
  } as const;
  const options = {
    network: 'testnet' as const,
    now: new Date('2026-11-21T10:00:00.000Z'),
    accountLoader: async () => ({ ...sourceAccount, balances: [...sourceAccount.balances], signers: [...sourceAccount.signers] }),
    networkParametersLoader: async () => ({
      ledgerSequence: 300, ledgerClosedAt: '2026-11-21T09:59:00.000Z', baseFeeInStroops: 100, baseReserveInStroops: 5_000_000,
    }),
  };
  const own = await listSignerInbox(store, proposer, options);
  assert.equal(own.length, 1);
  assert.equal(own[0].proposerAddress, proposer);
  const others = await listSignerInbox(store, other, options);
  assert.deepEqual(others, []);
  const { projectHumanInboxRequests } = await import('./requestInbox.js');
  const [item] = await projectHumanInboxRequests(store, proposer, own);
  assert.equal(item.viewerAction, 'proposer_waiting');
  assert.equal(item.coordinationEvents?.length, 1);
  const [ready] = await projectHumanInboxRequests(store, proposer, [{
    ...own[0], status: 'ready', statusReason: 'authorization_complete',
  }]);
  assert.equal(ready.viewerAction, 'proposer_ready');
});
