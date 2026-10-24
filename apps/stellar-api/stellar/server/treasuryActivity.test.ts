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
import { listSignerActivity, listTreasuryActivity } from './requestActivity.js';
import type {
  SigningRequestStore,
  StoredRequestParticipant,
  StoredSignatureContribution,
  StoredSigningRequest,
  StoredSubmissionResult,
} from './requestStore.js';

class MemoryStore implements SigningRequestStore {
  requests = new Map<string, StoredSigningRequest>();
  participants = new Map<string, StoredRequestParticipant>();

  async createRequest(request: StoredSigningRequest) { this.requests.set(request.id, request); }
  async getRequest(id: string) { return this.requests.get(id) ?? null; }
  async listRequests() { return [...this.requests.values()]; }
  async listContributions(_id: string): Promise<StoredSignatureContribution[]> { return []; }
  async putContribution(_id: string, _contribution: StoredSignatureContribution) {}
  async getSubmission(_id: string, _transactionHash: string): Promise<StoredSubmissionResult | null> { return null; }
  async putSubmission(_id: string, _submission: StoredSubmissionResult) {}
  async getRequestParticipant(id: string, address: string) {
    return this.participants.get(`${id}:${address}`) ?? null;
  }
  async listRequestParticipants(id: string) {
    return [...this.participants.entries()]
      .filter(([key]) => key.startsWith(`${id}:`))
      .map(([, participant]) => participant);
  }
  async putRequestParticipant(id: string, participant: StoredRequestParticipant) {
    this.participants.set(`${id}:${participant.address}`, participant);
  }
}

function storedRequest(id: string, source: Keypair, createdAt: string): StoredSigningRequest {
  const transaction = new TransactionBuilder(new Account(source.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({
      destination: Keypair.random().publicKey(),
      asset: Asset.native(),
      amount: '1',
    }))
    .setTimeout(TimeoutInfinite)
    .build();
  return {
    version: 1,
    id,
    network: 'testnet',
    baseXdr: transaction.toXdr(),
    transactionHash: Buffer.from(transaction.hash()).toString('hex'),
    createdAt,
    expiresAt: '2030-01-02T00:00:00.000Z',
  };
}

test('Treasury Activity includes the treasury history even when the current signer did not participate', async () => {
  const store = new MemoryStore();
  const treasury = Keypair.random();
  const viewer = Keypair.random();
  const otherAccount = Keypair.random();
  await store.createRequest(storedRequest('P'.repeat(16), treasury, '2026-08-30T09:00:00.000Z'));
  await store.createRequest(storedRequest('R'.repeat(16), treasury, '2026-08-30T09:05:00.000Z'));
  await store.createRequest(storedRequest('S'.repeat(16), otherAccount, '2026-08-30T09:10:00.000Z'));

  const myActivity = await listSignerActivity(store, viewer.publicKey(), { network: 'testnet' });
  assert.equal(myActivity.length, 0);

  const treasuryActivity = await listTreasuryActivity(
    store,
    viewer.publicKey(),
    treasury.publicKey(),
    {
      network: 'testnet',
      knownSignerAddresses: [treasury.publicKey(), viewer.publicKey()],
    },
  );
  assert.deepEqual(treasuryActivity.map((item) => item.requestId), ['R'.repeat(16), 'P'.repeat(16)]);
  assert.equal(treasuryActivity.every((item) => item.accountIds.includes(treasury.publicKey())), true);
});

test('Treasury-wide history does not expose off-chain Private Note events to a signer who never joined the Request', async () => {
  const store = new MemoryStore();
  const treasury = Keypair.random();
  const viewer = Keypair.random();
  const request = storedRequest('T'.repeat(16), treasury, '2026-08-30T09:00:00.000Z');
  request.initialPrivateNote = {
    version: 1,
    revisionId: 'initial',
    text: 'Confidential payroll context',
    createdAt: request.createdAt,
  };
  await store.createRequest(request);

  const treasuryOnly = await listTreasuryActivity(store, viewer.publicKey(), treasury.publicKey(), {
    network: 'testnet',
    knownSignerAddresses: [treasury.publicKey(), viewer.publicKey()],
  });
  assert.deepEqual(treasuryOnly[0].events.map((item) => item.type), ['request_created']);

  await store.putRequestParticipant(request.id, {
    version: 1,
    address: viewer.publicKey(),
    joinedAt: '2026-08-30T09:01:00.000Z',
  });
  const joined = await listTreasuryActivity(store, viewer.publicKey(), treasury.publicKey(), {
    network: 'testnet',
    knownSignerAddresses: [treasury.publicKey(), viewer.publicKey()],
  });
  assert.deepEqual(joined[0].events.map((item) => item.type), ['request_created', 'private_note_added']);
  assert.equal(JSON.stringify(joined).includes('Confidential payroll context'), false);
});
