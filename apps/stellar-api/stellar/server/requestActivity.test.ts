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
import type { ActivityEvent } from '../../../../src/stellar/activityTypes.js';
import type { PrivateNoteRevision } from '../../../../src/stellar/privateNote.js';
import { inspectTransactionXdr } from '../../../../src/stellar/transactionXdr.js';
import {
  getSignerActivityItemForRequest,
  listSignerActivity,
  listSignerActivityPage,
  listTreasuryActivity,
  recordSubmittedActivity,
} from './requestActivity.js';
import type {
  SigningRequestStore,
  StoredRequestParticipant,
  StoredSignatureContribution,
  StoredSigningRequest,
  StoredSubmissionResult,
} from './requestStore.js';

class MemoryStore implements SigningRequestStore {
  requests = new Map<string, StoredSigningRequest>();
  contributions = new Map<string, StoredSignatureContribution[]>();
  submissions = new Map<string, StoredSubmissionResult>();
  participants = new Map<string, StoredRequestParticipant>();
  activityEvents = new Map<string, ActivityEvent[]>();
  privateNotes = new Map<string, PrivateNoteRevision[]>();

  async createRequest(request: StoredSigningRequest) { this.requests.set(request.id, request); }
  async getRequest(id: string) { return this.requests.get(id) ?? null; }
  async listRequests() { return [...this.requests.values()]; }
  async listContributions(id: string) { return this.contributions.get(id) ?? []; }
  async putContribution(id: string, contribution: StoredSignatureContribution) {
    this.contributions.set(id, [...(this.contributions.get(id) ?? []), contribution]);
  }
  async getSubmission(id: string, transactionHash: string) {
    const value = this.submissions.get(id);
    return value?.transactionHash === transactionHash ? value : null;
  }
  async putSubmission(id: string, submission: StoredSubmissionResult) { this.submissions.set(id, submission); }
  async getRequestParticipant(id: string, address: string) {
    return this.participants.get(`${id}:${address}`) ?? null;
  }
  async putRequestParticipant(id: string, participant: StoredRequestParticipant) {
    const key = `${id}:${participant.address}`;
    if (!this.participants.has(key)) this.participants.set(key, participant);
  }
  async listRequestParticipants(id: string) {
    return [...this.participants.entries()]
      .filter(([key]) => key.startsWith(`${id}:`))
      .map(([, participant]) => participant);
  }
  async listActivityEvents(id: string) { return this.activityEvents.get(id) ?? []; }
  async putActivityEvent(id: string, item: ActivityEvent) {
    this.activityEvents.set(id, [...(this.activityEvents.get(id) ?? []), item]);
  }
  async listPrivateNoteRevisions(id: string) { return this.privateNotes.get(id) ?? []; }
  async putPrivateNoteRevision(id: string, revision: PrivateNoteRevision) {
    this.privateNotes.set(id, [...(this.privateNotes.get(id) ?? []), revision]);
  }
}

class IndexedMemoryStore extends MemoryStore {
  activityCandidates: StoredSigningRequest[] = [];
  discoveryCandidates: StoredSigningRequest[] = [];
  activityCalls: Array<{ network: string; accountIds: string[]; actorAddress: string }> = [];
  discoveryCalls: Array<{ network: string; accountIds: string[]; directSignerKey: string }> = [];

  async listRequests(): Promise<StoredSigningRequest[]> {
    throw new Error('full request scan should not run when the Activity candidate index is available');
  }

  async listRequestsByActivitySubjects(network: 'public' | 'testnet', accountIds: string[], actorAddress: string) {
    this.activityCalls.push({ network, accountIds, actorAddress });
    return this.activityCandidates;
  }

  async listRequestsByDiscoverySubjects(network: 'public' | 'testnet', accountIds: string[], directSignerKey: string) {
    this.discoveryCalls.push({ network, accountIds, directSignerKey });
    return this.discoveryCandidates;
  }
}

function transactionForSource(source: Keypair) {
  return new TransactionBuilder(new Account(source.publicKey(), '1'), {
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
}

function storedRequest(id: string, source: Keypair, createdAt: string): StoredSigningRequest {
  const transaction = transactionForSource(source);
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

function signedContribution(request: StoredSigningRequest, signer: Keypair, digest: string, receivedAt: string): StoredSignatureContribution {
  const transaction = TransactionBuilder.fromXdr(request.baseXdr, Networks.TESTNET);
  transaction.sign(signer);
  return { version: 1, digest, signedXdr: transaction.toXdr(), receivedAt };
}

function signRequestBase(request: StoredSigningRequest, signer: Keypair) {
  const signed = TransactionBuilder.fromXdr(request.baseXdr, Networks.TESTNET);
  signed.sign(signer);
  request.baseXdr = signed.toXdr();
}

test('My Activity is based on actual signature participation and annotates the current signer', async () => {
  const store = new MemoryStore();
  const actor = Keypair.random();
  const other = Keypair.random();
  const request = storedRequest('A'.repeat(16), actor, '2026-08-30T09:00:00.000Z');
  await store.createRequest(request);
  await store.putContribution(request.id, signedContribution(request, actor, 'actor', '2026-08-30T09:01:00.000Z'));
  await store.putContribution(request.id, signedContribution(request, other, 'other', '2026-08-30T09:02:00.000Z'));

  const items = await listSignerActivity(store, actor.publicKey(), { network: 'testnet' });

  assert.equal(items.length, 1);
  const approvals = items[0].events.filter((event) => event.type === 'approval_added');
  assert.equal(approvals.length, 2);
  assert.equal(approvals[0].actorAddress, actor.publicKey());
  assert.equal(approvals[1].actorAddress, undefined);
  assert.deepEqual(items[0].events.map((event) => event.type), [
    'request_created',
    'approval_added',
    'approval_added',
  ]);
});

test('a request participant appears in Activity without being forced to sign', async () => {
  const store = new MemoryStore();
  const actor = Keypair.random();
  const source = Keypair.random();
  const request = storedRequest('J'.repeat(16), source, '2026-08-30T09:00:00.000Z');
  await store.createRequest(request);
  await store.putRequestParticipant(request.id, {
    version: 1,
    address: actor.publicKey(),
    joinedAt: '2026-08-30T09:00:30.000Z',
  });

  const items = await listSignerActivity(store, actor.publicKey(), { network: 'testnet' });
  assert.equal(items.length, 1);
  assert.equal(items[0].requestId, request.id);
  assert.deepEqual(items[0].events.map((event) => event.type), ['request_created']);
});

test('history Activity can reuse preloaded request facts and private-note revisions', async () => {
  const store = new MemoryStore();
  const actor = Keypair.random();
  const source = Keypair.random();
  const request = storedRequest('V'.repeat(16), source, '2026-08-30T09:00:00.000Z');
  await store.createRequest(request);
  await store.putRequestParticipant(request.id, {
    version: 1,
    address: actor.publicKey(),
    joinedAt: '2026-08-30T09:00:30.000Z',
  });
  store.listContributions = async () => {
    throw new Error('preloaded history facts must not reload contributions');
  };
  store.getSubmission = async () => {
    throw new Error('preloaded history facts must not reload submission');
  };
  store.listPrivateNoteRevisions = async () => {
    throw new Error('preloaded history facts must not reload private notes');
  };

  const item = await getSignerActivityItemForRequest(
    store,
    actor.publicKey(),
    request,
    { network: 'testnet' },
    { contributions: [], submission: null },
    [],
  );

  assert.equal(item?.requestId, request.id);
});

test('historical signature participation is retained as private Request identity', async () => {
  const store = new MemoryStore();
  const actor = Keypair.random();
  const request = storedRequest('K'.repeat(16), actor, '2026-08-30T09:00:00.000Z');
  await store.createRequest(request);
  await store.putContribution(request.id, signedContribution(request, actor, 'actor-history', '2026-08-30T09:04:00.000Z'));

  assert.equal(await store.getRequestParticipant(request.id, actor.publicKey()), null);
  const items = await listSignerActivity(store, actor.publicKey(), { network: 'testnet' });
  assert.equal(items.length, 1);
  assert.deepEqual(await store.getRequestParticipant(request.id, actor.publicKey()), {
    version: 1,
    address: actor.publicKey(),
    joinedAt: '2026-08-30T09:04:00.000Z',
  });
});

test('a signature already present when the request is created appears as signer Activity', async () => {
  const store = new MemoryStore();
  const actor = Keypair.random();
  const request = storedRequest('D'.repeat(16), actor, '2026-08-30T09:00:00.000Z');
  signRequestBase(request, actor);
  await store.createRequest(request);

  const items = await listSignerActivity(store, actor.publicKey(), { network: 'testnet' });
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].events.map((event) => event.type), ['request_created', 'approval_added']);
  const approval = items[0].events.find((event) => event.type === 'approval_added');
  assert.equal(approval?.actorAddress, actor.publicKey());
  assert.equal(approval?.occurredAt, request.createdAt);
});

test('an initial off-chain Private Note reconstructs Activity without entering the transaction', async () => {
  const store = new MemoryStore();
  const actor = Keypair.random();
  const request = storedRequest('H'.repeat(16), actor, '2026-08-30T09:00:00.000Z');
  signRequestBase(request, actor);
  request.initialPrivateNote = {
    version: 1,
    revisionId: 'initial',
    text: 'Private payment context',
    createdAt: request.createdAt,
  };
  await store.createRequest(request);

  const items = await listSignerActivity(store, actor.publicKey(), { network: 'testnet' });
  assert.deepEqual(items[0].events.map((event) => event.type), [
    'request_created',
    'private_note_added',
    'approval_added',
  ]);
  const noteEvent = items[0].events.find((event) => event.type === 'private_note_added');
  assert.equal(noteEvent?.detail, undefined);
  assert.equal(JSON.stringify(noteEvent).includes('Private payment context'), false);
  assert.equal(inspectTransactionXdr(request.baseXdr, 'testnet').memo.type, 'none');
});

test('Private Note revisions reconstruct Activity without exposing plaintext', async () => {
  const store = new MemoryStore();
  const actor = Keypair.random();
  const request = storedRequest('F'.repeat(16), actor, '2026-08-30T09:00:00.000Z');
  signRequestBase(request, actor);
  await store.createRequest(request);
  await store.putPrivateNoteRevision(request.id, {
    version: 1,
    revisionId: 'note-1',
    text: 'Payroll batch 2026-08',
    createdAt: '2026-08-30T09:01:00.000Z',
  });
  await store.putPrivateNoteRevision(request.id, {
    version: 1,
    revisionId: 'note-2',
    text: 'Revised confidential note',
    createdAt: '2026-08-30T09:02:00.000Z',
    actorAddress: actor.publicKey(),
  });

  const items = await listSignerActivity(store, actor.publicKey(), { network: 'testnet' });
  assert.deepEqual(items[0].events.map((event) => event.type), [
    'request_created',
    'approval_added',
    'private_note_added',
    'private_note_revised',
  ]);
  const noteEvents = items[0].events.filter((event) => event.type.startsWith('private_note_'));
  assert.equal(noteEvents[0].detail, undefined);
  assert.equal(noteEvents[1].detail, undefined);
  assert.equal(noteEvents[1].actorAddress, actor.publicKey());
  assert.equal(JSON.stringify(noteEvents).includes('Payroll'), false);
  assert.equal(JSON.stringify(noteEvents).includes('confidential'), false);
});

test('Private Commitment reconstructs Activity without exposing opening data', async () => {
  const store = new MemoryStore();
  const actor = Keypair.random();
  const request = storedRequest('G'.repeat(16), actor, '2026-08-30T09:00:00.000Z');
  signRequestBase(request, actor);
  request.privateCommitment = {
    version: 1,
    text: 'Acquisition closing instructions',
    saltHex: 'ab'.repeat(32),
    hashHex: 'cd'.repeat(32),
    createdAt: request.createdAt,
  };
  await store.createRequest(request);

  const items = await listSignerActivity(store, actor.publicKey(), { network: 'testnet' });
  assert.deepEqual(items[0].events.map((event) => event.type), [
    'request_created',
    'private_commitment_created',
    'approval_added',
  ]);
  const commitmentEvent = items[0].events.find((event) => event.type === 'private_commitment_created');
  assert.equal(commitmentEvent?.detail, undefined);
  assert.equal(JSON.stringify(commitmentEvent).includes('Acquisition'), false);
  assert.equal(JSON.stringify(commitmentEvent).includes('abab'), false);
});

test('submitted legacy requests reconstruct durable lifecycle facts in human order', async () => {
  const store = new MemoryStore();
  const actor = Keypair.random();
  const request = storedRequest('E'.repeat(16), actor, '2026-08-30T09:00:00.000Z');
  signRequestBase(request, actor);
  await store.createRequest(request);
  await store.putSubmission(request.id, {
    version: 1,
    transactionHash: request.transactionHash,
    ledger: 12345,
    submittedAt: '2026-08-30T09:05:00.000Z',
  });

  const items = await listSignerActivity(store, actor.publicKey(), { network: 'testnet' });
  assert.deepEqual(items[0].events.map((event) => event.type), [
    'request_created',
    'approval_added',
    'transaction_submitted',
    'transaction_confirmed',
  ]);
});


test('Activity exposes facts only and ignores legacy status-projection rows', async () => {
  const store = new MemoryStore();
  const actor = Keypair.random();
  const request = storedRequest('A'.repeat(16), actor, '2026-08-30T09:00:00.000Z');
  request.expiresAt = '2026-08-30T09:30:00.000Z';
  signRequestBase(request, actor);
  await store.createRequest(request);
  store.activityEvents.set(request.id, [
    { version: 1, eventId: 'legacy-ready', requestId: request.id, type: 'approvals_ready', occurredAt: '2026-08-30T09:01:00.000Z' },
    { version: 1, eventId: 'legacy-expired', requestId: request.id, type: 'request_expired', occurredAt: request.expiresAt },
    { version: 1, eventId: 'legacy-stale', requestId: request.id, type: 'request_stale', occurredAt: '2026-08-30T09:31:00.000Z' },
    { version: 1, eventId: 'legacy-blocked', requestId: request.id, type: 'request_blocked', occurredAt: '2026-08-30T09:32:00.000Z' },
  ]);

  const items = await listSignerActivity(store, actor.publicKey(), { network: 'testnet' });

  assert.deepEqual(items[0].events.map((event) => event.type), ['request_created', 'approval_added']);
  assert.equal(items[0].events.some((event) => event.occurredAt === request.expiresAt), false);
});

test('future Activity keeps verified creator and submitter actors without attributing system confirmation', async () => {
  const store = new MemoryStore();
  const creator = Keypair.random();
  const submitter = Keypair.random();
  const request = storedRequest('P'.repeat(16), creator, '2026-08-30T09:00:00.000Z');
  request.creatorAddress = creator.publicKey();
  signRequestBase(request, creator);
  await store.createRequest(request);
  const submission = { transactionHash: request.transactionHash, ledger: 54321, submittedAt: '2026-08-30T09:05:00.000Z' };
  await store.putSubmission(request.id, { version: 1, ...submission });
  await recordSubmittedActivity(store, {
    id: request.id, network: request.network, transactionHash: request.transactionHash,
    baseXdr: request.baseXdr, mergedXdr: request.baseXdr, createdAt: request.createdAt, expiresAt: request.expiresAt,
    contributionCount: 0, signatureCount: 1, status: 'submitted', statusReason: 'ledger_confirmed', submission,
  }, submitter.publicKey());
  const items = await listSignerActivity(store, creator.publicKey(), { network: 'testnet' });
  assert.equal(items[0].events.find((item) => item.type === 'request_created')?.actorAddress, creator.publicKey());
  assert.equal(items[0].events.find((item) => item.type === 'transaction_submitted')?.actorAddress, submitter.publicKey());
  assert.equal(items[0].events.find((item) => item.type === 'transaction_confirmed')?.actorAddress, undefined);
});

test('Activity attributes base and contribution signatures to the participant who actually signed', async () => {
  const store = new MemoryStore();
  const alice = Keypair.random();
  const bob = Keypair.random();
  const request = storedRequest('N'.repeat(16), alice, '2026-08-30T09:00:00.000Z');
  signRequestBase(request, alice);
  await store.createRequest(request);
  await store.putRequestParticipant(request.id, { version: 1, address: alice.publicKey(), joinedAt: request.createdAt });
  await store.putRequestParticipant(request.id, { version: 1, address: bob.publicKey(), joinedAt: '2026-08-30T09:00:30.000Z' });
  await store.putContribution(request.id, signedContribution(request, bob, 'bob', '2026-08-30T09:01:00.000Z'));

  const items = await listSignerActivity(store, bob.publicKey(), { network: 'testnet' });
  const approvals = items[0].events.filter((item) => item.type === 'approval_added');
  assert.deepEqual(approvals.map((item) => item.actorAddress), [alice.publicKey(), bob.publicKey()]);
});



test('Activity replays canonical v2 signer evidence without requiring signer discovery reconstruction', async () => {
  const store = new MemoryStore();
  const source = Keypair.random();
  const signer = Keypair.random();
  const request = storedRequest('V'.repeat(16), source, '2026-09-03T07:00:00.000Z');
  await store.createRequest(request);
  const legacyShape = signedContribution(request, signer, 'canonical-v2', '2026-09-03T07:01:00.000Z');
  await store.putContribution(request.id, {
    ...legacyShape,
    version: 2,
    provenance: 'in_product_contribution',
    acceptedSignatures: [{
      signatureIndex: 0,
      signerKey: signer.publicKey(),
      signatureHint: '00000000',
      signatureDigest: 'a'.repeat(64),
    }],
  });

  const item = await getSignerActivityItemForRequest(
    store,
    signer.publicKey(),
    request,
    { network: 'testnet' },
    { contributions: await store.listContributions(request.id), submission: null },
    [],
  );
  const signed = item?.events.filter((event) => event.type === 'approval_added') ?? [];
  assert.deepEqual(signed.map((event) => event.actorAddress), [signer.publicKey()]);
});

test('Activity recovers web signer identities from the Request-time signer snapshot without an unlock participant record', async () => {
  const store = new MemoryStore();
  const alice = Keypair.random();
  const bob = Keypair.random();
  const request = storedRequest('W'.repeat(16), alice, '2026-09-03T05:00:00.000Z');
  request.discoverySignerKeys = [alice.publicKey(), bob.publicKey()];
  signRequestBase(request, alice);
  await store.createRequest(request);
  await store.putContribution(request.id, signedContribution(request, bob, 'bob-web', '2026-09-03T05:01:00.000Z'));

  const item = await getSignerActivityItemForRequest(
    store,
    bob.publicKey(),
    request,
    { network: 'testnet' },
    { contributions: await store.listContributions(request.id), submission: null },
    [],
  );

  const approvals = item?.events.filter((event) => event.type === 'approval_added') ?? [];
  assert.deepEqual(approvals.map((event) => event.actorAddress), [alice.publicKey(), bob.publicKey()]);
});

test('Activity never turns stale stored approval metadata into a false You-signed claim', async () => {
  const store = new MemoryStore();
  const alice = Keypair.random();
  const bob = Keypair.random();
  const request = storedRequest('M'.repeat(16), alice, '2026-08-30T09:00:00.000Z');
  await store.createRequest(request);
  await store.putRequestParticipant(request.id, { version: 1, address: alice.publicKey(), joinedAt: request.createdAt });
  await store.putRequestParticipant(request.id, { version: 1, address: bob.publicKey(), joinedAt: '2026-08-30T09:00:30.000Z' });
  await store.putContribution(request.id, signedContribution(request, alice, 'alice', '2026-08-30T09:01:00.000Z'));
  await store.putActivityEvent(request.id, {
    version: 1,
    eventId: 'legacy-wrong-actor',
    requestId: request.id,
    type: 'approval_added',
    occurredAt: '2026-08-30T09:01:00.000Z',
    actorAddress: bob.publicKey(),
  });

  const items = await listSignerActivity(store, bob.publicKey(), { network: 'testnet' });
  const approvals = items[0].events.filter((item) => item.type === 'approval_added');
  assert.equal(approvals.some((item) => item.actorAddress === bob.publicKey()), false);
  assert.equal(approvals.some((item) => item.actorAddress === alice.publicKey()), true);
});

test('Treasury Activity is only an account filter over requests the current signer participated in', async () => {
  const store = new MemoryStore();
  const actor = Keypair.random();
  const sourceA = actor;
  const sourceB = Keypair.random();
  const requestA = storedRequest('B'.repeat(16), sourceA, '2026-08-30T09:00:00.000Z');
  const requestB = storedRequest('C'.repeat(16), sourceB, '2026-08-30T09:05:00.000Z');
  await store.createRequest(requestA);
  await store.createRequest(requestB);
  await store.putContribution(requestA.id, signedContribution(requestA, actor, 'a', '2026-08-30T09:01:00.000Z'));
  // This represents a real-world case where actor is an additional signer of sourceB.
  await store.putContribution(requestB.id, signedContribution(requestB, actor, 'b', '2026-08-30T09:06:00.000Z'));

  const all = await listSignerActivity(store, actor.publicKey(), { network: 'testnet' });
  assert.equal(all.length, 2);

  const filtered = await listSignerActivity(store, actor.publicKey(), {
    network: 'testnet',
    accountId: sourceA.publicKey(),
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].requestId, requestA.id);
  assert.deepEqual(filtered[0].accountIds, [sourceA.publicKey()]);
});


test('decline events are retained as participant Activity without counting as an approval', async () => {
  const store = new MemoryStore();
  const actor = Keypair.random();
  const source = Keypair.random();
  const request = storedRequest('Q'.repeat(16), source, '2026-09-01T10:00:00.000Z');
  await store.createRequest(request);
  await store.putRequestParticipant(request.id, { version: 1, address: actor.publicKey(), joinedAt: '2026-09-01T10:01:00.000Z' });
  await store.putActivityEvent(request.id, {
    version: 1,
    eventId: `declined-${actor.publicKey()}`,
    requestId: request.id,
    type: 'approval_declined',
    occurredAt: '2026-09-01T10:02:00.000Z',
    actorAddress: actor.publicKey(),
  });
  const items = await listSignerActivity(store, actor.publicKey(), { network: 'testnet' });
  assert.equal(items.length, 1);
  assert.equal(items[0].events.some((event) => event.type === 'approval_declined' && event.actorAddress === actor.publicKey()), true);
  assert.equal(items[0].events.some((event) => event.type === 'approval_added'), false);
});


test('Activity cursor pages are stable without duplicates or omissions', async () => {
  const store = new MemoryStore();
  const actor = Keypair.random();
  const source = Keypair.random();
  const older = storedRequest('A'.repeat(16), source, '2026-09-01T09:00:00.000Z');
  const newer = storedRequest('B'.repeat(16), source, '2026-09-01T10:00:00.000Z');
  await store.createRequest(older);
  await store.createRequest(newer);
  await store.putRequestParticipant(older.id, { version: 1, address: actor.publicKey(), joinedAt: '2026-09-01T09:01:00.000Z' });
  await store.putRequestParticipant(newer.id, { version: 1, address: actor.publicKey(), joinedAt: '2026-09-01T10:01:00.000Z' });

  const first = await listSignerActivityPage(store, actor.publicKey(), { network: 'testnet', limit: 1 });
  assert.deepEqual(first.items.map((item) => item.requestId), [newer.id]);
  assert.ok(first.nextCursor);

  const second = await listSignerActivityPage(store, actor.publicKey(), { network: 'testnet', limit: 1, cursor: first.nextCursor });
  assert.deepEqual(second.items.map((item) => item.requestId), [older.id]);
  assert.equal(second.nextCursor, undefined);
});

test('Personal Activity narrows work through participant/discovery candidates without granting access from the index', async () => {
  const store = new IndexedMemoryStore();
  const actor = Keypair.random();
  const source = Keypair.random();
  const participated = storedRequest('R'.repeat(16), source, '2026-09-02T09:00:00.000Z');
  const discoveryOnly = storedRequest('S'.repeat(16), source, '2026-09-02T10:00:00.000Z');
  await store.createRequest(participated);
  await store.createRequest(discoveryOnly);
  await store.putRequestParticipant(participated.id, {
    version: 1,
    address: actor.publicKey(),
    joinedAt: '2026-09-02T09:01:00.000Z',
  });
  store.activityCandidates = [participated];
  store.discoveryCandidates = [discoveryOnly];

  const items = await listSignerActivity(store, actor.publicKey(), { network: 'testnet' });

  assert.deepEqual(items.map((item) => item.requestId), [participated.id]);
  assert.deepEqual(store.activityCalls, [{ network: 'testnet', accountIds: [], actorAddress: actor.publicKey() }]);
  assert.deepEqual(store.discoveryCalls, [{ network: 'testnet', accountIds: [], directSignerKey: actor.publicKey() }]);
});

test('Treasury Activity uses the history account index without requiring participant pointers', async () => {
  const store = new IndexedMemoryStore();
  const viewer = Keypair.random();
  const source = Keypair.random();
  const request = storedRequest('T'.repeat(16), source, '2026-09-02T11:00:00.000Z');
  await store.createRequest(request);
  store.activityCandidates = [request];

  const items = await listTreasuryActivity(store, viewer.publicKey(), source.publicKey(), {
    network: 'testnet',
    knownSignerAddresses: [viewer.publicKey()],
  });

  assert.deepEqual(items.map((item) => item.requestId), [request.id]);
  assert.deepEqual(store.activityCalls, [{
    network: 'testnet',
    accountIds: [source.publicKey()],
    actorAddress: '',
  }]);
  assert.deepEqual(store.discoveryCalls, []);
});
