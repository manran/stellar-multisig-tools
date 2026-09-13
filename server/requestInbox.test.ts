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
  });
  const { projectHumanInboxRequests } = await import('./requestInbox.js');
  const projected = await projectHumanInboxRequests(store, signer.publicKey(), [
    { ...baseSnapshot, id: '0'.repeat(16), mergedXdr: signed.toXDR(), status: 'awaiting_signatures' as const },
    { ...baseSnapshot, id: '1'.repeat(16), mergedXdr: unsigned.toXDR(), status: 'awaiting_signatures' as const },
    { ...baseSnapshot, id: '2'.repeat(16), mergedXdr: unsigned.toXDR(), status: 'ready' as const, statusReason: 'authorization_complete' as const },
  ]);

  assert.deepEqual(projected.map((item) => item.viewerAction), [
    'waiting_for_others',
    'declined',
    'submit',
  ]);
});
