import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk/base';
import type { PrivateNoteRevision } from '../../../../packages/stellar-core/src/privateNote.js';
import { applyCoordinationMigrations } from './migrate.js';
import { closeCoordinationPool, coordinationPool } from './postgres.js';
import { createPostgresSigningRequestStore } from './postgresSigningRequestStore.js';
import type {
  RequestPrivateDataStore,
  StoredRequestPrivateData,
} from '../server/requestPrivateDataStore.js';
import { listSignerActivityItems } from '../server/requestActivity.js';
import type { StoredSigningRequest } from '../server/requestStore.js';

const TEST_URL = process.env.MST_POSTGRES_TEST_URL?.trim();
const RESET_ALLOWED = process.env.MST_POSTGRES_TEST_ALLOW_RESET === '1';
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

class MemoryPrivateStore implements RequestPrivateDataStore {
  readonly roots = new Map<string, StoredRequestPrivateData>();
  readonly notes = new Map<string, PrivateNoteRevision[]>();
  reads = 0;

  async getRequestPrivateData(id: string) {
    this.reads += 1;
    return this.roots.get(id) ?? null;
  }

  async putRequestPrivateData(id: string, value: StoredRequestPrivateData) {
    const existing = this.roots.get(id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(value)) throw new Error('private mismatch');
    this.roots.set(id, value);
  }

  async listPrivateNoteRevisions(id: string) {
    return [...(this.notes.get(id) ?? [])];
  }

  async putPrivateNoteRevision(id: string, value: PrivateNoteRevision) {
    const values = this.notes.get(id) ?? [];
    const existing = values.find((item) => item.revisionId === value.revisionId);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(value)) throw new Error('note mismatch');
      return;
    }
    this.notes.set(id, [...values, value]);
  }
}

function fixture(id = 'PGREQEST00000001') {
  const source = Keypair.random();
  const destination = Keypair.random();
  const signer = Keypair.random();
  const creator = Keypair.random();
  const transaction = new TransactionBuilder(
    new Account(source.publicKey(), '1'),
    { fee: '100', networkPassphrase: Networks.TESTNET },
  )
    .addOperation(Operation.payment({
      destination: destination.publicKey(),
      asset: Asset.native(),
      amount: '1',
    }))
    .setTimeout(300)
    .build();
  const request: StoredSigningRequest = {
    version: 1,
    id,
    network: 'testnet',
    baseXdr: transaction.toXDR(),
    transactionHash: Buffer.from(transaction.hash()).toString('hex'),
    createdAt: '2026-09-18T01:00:00.000Z',
    expiresAt: '2026-09-19T01:00:00.000Z',
    creatorAddress: creator.publicKey(),
    creatorActor: { type: 'service', id: 'fednetwork', label: 'FedNetwork' },
    integration: {
      version: 1,
      serviceId: 'fednetwork',
      serviceLabel: 'FedNetwork',
      correlationId: 'classic-42',
    },
    instructionDigest: 'instruction-42',
    executionPolicy: { mode: 'external' },
    discoverySignerKeys: [source.publicKey(), signer.publicKey()],
    capabilityHash: 'capability-hash',
    initialPrivateNote: {
      version: 1,
      revisionId: 'initial',
      text: 'secret classic note',
      createdAt: '2026-09-18T01:00:00.000Z',
    },
    privateCommitment: {
      version: 1,
      text: 'secret memo opening',
      saltHex: '11'.repeat(32),
      hashHex: '22'.repeat(32),
      createdAt: '2026-09-18T01:00:00.000Z',
    },
  };
  return { request, source, signer, creator };
}

before(async () => {
  if (!TEST_URL || !RESET_ALLOWED) return;
  const pool = coordinationPool();
  await pool.query('DROP SCHEMA IF EXISTS mst_stellar CASCADE');
  await applyCoordinationMigrations();
});

after(async () => {
  await closeCoordinationPool();
});

test('Postgres Classic store round-trips core facts and replaces Blob discovery/activity indexes', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  const pool = coordinationPool();
  const privateStore = new MemoryPrivateStore();
  const store = createPostgresSigningRequestStore(pool, privateStore);
  const f = fixture();

  await store.createRequest(f.request);
  assert.deepEqual(await store.getRequest(f.request.id), f.request);

  assert.deepEqual(
    (await store.listRequestsByDiscoverySubjects!('testnet', [f.source.publicKey()], '')).map((item) => item.id),
    [f.request.id],
  );
  assert.deepEqual(
    (await store.listRequestsByDiscoverySubjects!('testnet', [], f.signer.publicKey())).map((item) => item.id),
    [f.request.id],
  );
  assert.deepEqual(
    (await store.listRequestsByActivitySubjects!('testnet', [], f.creator.publicKey())).map((item) => item.id),
    [f.request.id],
  );

  const sql = await pool.query<{ body: string }>(
    `SELECT row_to_json(r)::text AS body
       FROM mst_stellar.classic_requests r
      WHERE id = $1`,
    [f.request.id],
  );
  assert.doesNotMatch(sql.rows[0]?.body ?? '', /secret classic note/);
  assert.doesNotMatch(sql.rows[0]?.body ?? '', /secret memo opening/);
  assert.doesNotMatch(sql.rows[0]?.body ?? '', /11{8}/);

  const outbox = await pool.query<{ payload: unknown }>(
    'SELECT payload FROM mst_stellar.integration_outbox WHERE resource_id = $1',
    [f.request.id],
  );
  assert.deepEqual(outbox.rows.map((row) => row.payload), [{ version: 1, change: 'created' }]);
  assert.doesNotMatch(JSON.stringify(outbox.rows), /secret classic note|secret memo opening/);
});

test('Classic requests without private context do not touch Blob private storage on read', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  const privateStore = new MemoryPrivateStore();
  const store = createPostgresSigningRequestStore(coordinationPool(), privateStore);
  const f = fixture('PGREQEST00000002');
  const publicOnly = {
    ...f.request,
    initialPrivateNote: undefined,
    privateCommitment: undefined,
  };
  delete publicOnly.initialPrivateNote;
  delete publicOnly.privateCommitment;
  await store.createRequest(publicOnly);
  const before = privateStore.reads;
  assert.deepEqual(await store.getRequest(publicOnly.id), publicOnly);
  assert.equal(privateStore.reads, before);
});

test('Classic signature contribution is idempotent and atomically updates Activity candidates', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  const pool = coordinationPool();
  const privateStore = new MemoryPrivateStore();
  const store = createPostgresSigningRequestStore(pool, privateStore);
  const f = fixture('PGREQEST00000003');
  await store.createRequest(f.request);

  const participant = Keypair.random().publicKey();
  const contribution = {
    version: 2 as const,
    digest: 'signature-digest-1',
    signedXdr: 'sensitive-signed-xdr',
    receivedAt: '2026-09-18T01:01:00.000Z',
    acceptedSignatures: [{
      signatureIndex: 0,
      signerKey: participant,
      signatureHint: 'deadbeef',
      signatureDigest: 'signature-proof',
    }],
    submittedBy: {
      type: 'agent' as const,
      id: 'agent-a',
      label: 'Agent A',
      principalAddress: participant,
    },
    provenance: 'in_product_contribution' as const,
  };

  await store.putContribution(f.request.id, contribution);
  await store.putContribution(f.request.id, contribution);
  assert.deepEqual(await store.listContributions(f.request.id), [contribution]);
  assert.deepEqual(
    (await store.listRequestsByActivitySubjects!('testnet', [], participant)).map((item) => item.id),
    [f.request.id],
  );

  const events = await store.listActivityEvents!(f.request.id);
  assert.equal(events.filter((item) => item.eventId === 'approval-signature-digest-1').length, 1);
  assert.equal(events.find((item) => item.eventId === 'approval-signature-digest-1')?.actorAddress, participant);

  const outbox = await pool.query<{ event_id: string; payload: { change: string } }>(
    `SELECT event_id, payload
       FROM mst_stellar.integration_outbox
      WHERE resource_id = $1
      ORDER BY event_id`,
    [f.request.id],
  );
  assert.equal(outbox.rows.filter((row) => row.event_id.includes('signature:')).length, 1);
  assert.doesNotMatch(JSON.stringify(outbox.rows), /sensitive-signed-xdr|signature-proof/);
});

test('Classic participants, submission, Activity facts, and private note revisions preserve their existing store contract', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  const pool = coordinationPool();
  const privateStore = new MemoryPrivateStore();
  const store = createPostgresSigningRequestStore(pool, privateStore);
  const f = fixture('PGREQEST00000004');
  await store.createRequest(f.request);

  const participant = Keypair.random().publicKey();
  await store.putRequestParticipant!(f.request.id, {
    version: 1,
    address: participant,
    joinedAt: '2026-09-18T01:01:30.000Z',
  });
  await store.putRequestParticipant!(f.request.id, {
    version: 1,
    address: participant,
    joinedAt: '2026-09-18T01:09:30.000Z',
  });
  assert.deepEqual(await store.getRequestParticipant!(f.request.id, participant), {
    version: 1,
    address: participant,
    joinedAt: '2026-09-18T01:01:30.000Z',
  });

  const submission = {
    version: 1 as const,
    transactionHash: f.request.transactionHash,
    ledger: 123456,
    submittedAt: '2026-09-18T01:02:00.000Z',
  };
  await store.putSubmission(f.request.id, submission);
  await store.putSubmission(f.request.id, submission);
  assert.deepEqual(await store.getSubmission(f.request.id, f.request.transactionHash), submission);

  await store.putActivityEvent!(f.request.id, {
    version: 1,
    eventId: `submitted-${f.request.transactionHash}`,
    requestId: f.request.id,
    type: 'transaction_submitted',
    occurredAt: submission.submittedAt,
    actorAddress: participant,
  });
  await store.putActivityEvent!(f.request.id, {
    version: 1,
    eventId: `submitted-${f.request.transactionHash}`,
    requestId: f.request.id,
    type: 'transaction_submitted',
    occurredAt: submission.submittedAt,
    actorAddress: participant,
  });

  const note: PrivateNoteRevision = {
    version: 1,
    revisionId: 'note-2',
    text: 'private revision two',
    createdAt: '2026-09-18T01:03:00.000Z',
    actorAddress: participant,
  };
  await store.putPrivateNoteRevision!(f.request.id, note);
  assert.deepEqual(await store.listPrivateNoteRevisions!(f.request.id), [note]);

  const events = await store.listActivityEvents!(f.request.id);
  assert.deepEqual(
    events.map((item) => item.type),
    ['request_created', 'transaction_confirmed', 'transaction_submitted'],
  );

  const activity = await listSignerActivityItems(store, participant, { network: 'testnet' });
  assert.equal(activity.length, 1);
  assert.equal(activity[0]?.requestId, f.request.id);
  assert.ok(activity[0]?.events.some((item) => item.type === 'private_note_revised'));
  assert.ok(activity[0]?.events.some((item) => item.type === 'transaction_confirmed'));

  const outbox = await pool.query<{ event_id: string; payload: { change: string } }>(
    `SELECT event_id, payload
       FROM mst_stellar.integration_outbox
      WHERE resource_id = $1
      ORDER BY event_id`,
    [f.request.id],
  );
  assert.equal(outbox.rows.filter((row) => row.event_id.includes('submission:')).length, 1);
  assert.equal(outbox.rows.filter((row) => row.event_id.includes('activity:submitted-')).length, 1);
  assert.doesNotMatch(JSON.stringify(outbox.rows), /private revision two/);
});
