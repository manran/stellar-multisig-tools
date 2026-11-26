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
import { createPostgresReusableTemplateStore } from './postgresReusableTemplateStore.js';
import { createReusableTemplate, ReusableTemplateServiceError } from '../server/reusableTemplateService.js';
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
  f.request.reviewSourceAccounts = [{
    accountId: f.source.publicKey(), sequence: '1', subentryCount: 1, numSponsoring: 0, numSponsored: 0,
    thresholds: { low: 1, medium: 2, high: 2 },
    signers: [{ key: f.source.publicKey(), type: 'ed25519_public_key', weight: 1 }, { key: f.signer.publicKey(), type: 'ed25519_public_key', weight: 1 }],
  }];

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


test('Classic Activity projects Assignment, Proposal view, and Human delivery facts without exposing contact data', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  const pool = coordinationPool();
  const store = createPostgresSigningRequestStore(pool, new MemoryPrivateStore());
  const f = fixture('PGREQEST00000005');
  await store.createRequest(f.request);

  await store.putRequestAssignment!(f.request.id, {
    version: 1,
    signerAddress: f.signer.publicKey(),
    assignedByAddress: f.creator.publicKey(),
    assignedAt: '2026-09-18T01:04:00.000Z',
  });
  const firstView = await store.markRequestAssignmentViewed!(
    f.request.id,
    f.signer.publicKey(),
    '2026-09-18T01:04:01.000Z',
  );
  const repeatedView = await store.markRequestAssignmentViewed!(
    f.request.id,
    f.signer.publicKey(),
    '2026-09-18T01:09:00.000Z',
  );
  assert.equal(firstView?.viewedAt, '2026-09-18T01:04:01.000Z');
  assert.equal(repeatedView, null);
  assert.equal(
    (await store.listRequestAssignments!(f.request.id))[0]?.viewedAt,
    firstView?.viewedAt,
  );

  await pool.query(
    `INSERT INTO mst_stellar.human_notification_outbox (
       event_id, event_type, request_id, recipient_signer_address, actor_address,
       destination_email, created_at, available_at, completed_at, outcome,
       provider_message_id, provider_delivery_state, provider_event_at, provider_event_id
     ) VALUES ($1, 'signature_requested', $2, $3, $4, $5, $6, $6, $7, 'sent', $8, 'delivered', $9, $10)`,
    [
      'human-activity-proof',
      f.request.id,
      f.signer.publicKey(),
      f.creator.publicKey(),
      'private@example.com',
      '2026-09-18T01:04:01.000Z',
      '2026-09-18T01:04:02.000Z',
      'resend-message-private',
      '2026-09-18T01:04:03.000Z',
      'svix-private',
    ],
  );

  const events = await store.listRequestCoordinationEvents!(f.request.id);
  assert.deepEqual(events.map((event) => event.type), [
    'signer_requested',
    'proposal_viewed',
    'notification_accepted',
    'notification_delivered',
  ]);
  assert.equal(events[0]?.actorAddress, f.creator.publicKey());
  assert.equal(events[0]?.subjectAddress, f.signer.publicKey());
  assert.equal(events[1]?.actorAddress, f.signer.publicKey());
  assert.equal(events[1]?.subjectAddress, f.signer.publicKey());
  assert.equal(events[3]?.notificationKind, 'signature_requested');
  assert.doesNotMatch(JSON.stringify(events), /private@example\.com|resend-message-private|svix-private/);
});


test('Postgres delegated Request is grant-locked, tracks proposer separately, and denies creation after revoke', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  const pool = coordinationPool();
  const templates = createPostgresReusableTemplateStore(pool);
  const store = createPostgresSigningRequestStore(pool, new MemoryPrivateStore());
  const fixtureValue = fixture('PGTPLPROPOSE0001');
  const proposer = Keypair.random().publicKey();
  const template = await createReusableTemplate(templates, fixtureValue.creator.publicKey(), {
    network: 'testnet', name: 'Vendor payment', kind: 'payment',
    definition: {
      version: 1, source: fixtureValue.source.publicKey(),
      recipients: [{ destination: Keypair.random().publicKey(), assetKey: 'native' }],
      signingWindowSeconds: 3600,
    },
  });
  await templates.grantProposer!(template.id, proposer, fixtureValue.creator.publicKey());
  await templates.grantProposer!(template.id, proposer, fixtureValue.creator.publicKey());
  assert.deepEqual(await templates.listProposers!(template.id), [proposer]);

  const request: StoredSigningRequest = {
    version: 1,
    id: fixtureValue.request.id, network: 'testnet',
    baseXdr: fixtureValue.request.baseXdr,
    transactionHash: fixtureValue.request.transactionHash,
    createdAt: fixtureValue.request.createdAt,
    expiresAt: fixtureValue.request.expiresAt,
    proposerAddress: proposer,
    templateRef: { id: template.id, version: 1, name: 'Vendor payment', kind: 'payment' },
    discoverySignerKeys: [fixtureValue.source.publicKey()],
  };
  await store.createRequest(request);
  const loaded = await store.getRequest(request.id);
  assert.deepEqual(loaded, request);
  assert.deepEqual((await store.listRequestsByProposer!('testnet', proposer)).map((item) => item.id), [request.id]);
  assert.deepEqual(await store.listRequestsByProposer!('testnet', fixtureValue.creator.publicKey()), []);
  assert.deepEqual((await store.listRequestsByActivitySubjects!('testnet', [], proposer)).map((item) => item.id), [request.id]);

  await templates.revokeProposer!(template.id, proposer, fixtureValue.creator.publicKey());
  assert.deepEqual(await templates.listProposers!(template.id), []);
  assert.ok(await store.getRequest(request.id), 'Historical Request remains accessible after revoke');
  await assert.rejects(
    () => store.createRequest({ ...request, id: 'PGTPLPROPOSE0002' }),
    (e: unknown) => e instanceof ReusableTemplateServiceError && e.code === 'template_proposer_not_authorized',
  );
  await templates.grantProposer!(template.id, proposer, fixtureValue.creator.publicKey());
  assert.deepEqual(await templates.listProposers!(template.id), [proposer]);
  const grants = await pool.query<{ revoked_at: Date | null; revoked_by_address: string | null }>(
    `SELECT revoked_at, revoked_by_address FROM mst_stellar.reusable_template_proposer_grants
      WHERE template_id = $1 AND proposer_address = $2 ORDER BY id`,
    [template.id, proposer],
  );
  assert.equal(grants.rowCount, 2, 'Re-grant appends a new audit row');
  assert.ok(grants.rows[0].revoked_at);
  assert.equal(grants.rows[0].revoked_by_address, fixtureValue.creator.publicKey());
  assert.equal(grants.rows[1].revoked_at, null);
});


test('Classic terminal execution evidence persists and emits one change; confirmed success wins', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  const pool = coordinationPool();
  const store = createPostgresSigningRequestStore(pool, new MemoryPrivateStore());
  const { request } = fixture('PGREQEST00000099');
  await store.createRequest(request);
  const proof = {
    outcome: 'not_included' as const, observed: false as const,
    nonInclusionProof: {
      oldestLedger: 1, latestLedger: 10, oldestLedgerClosedAt: '2026-09-17T23:59:00.000Z',
      latestLedgerClosedAt: '2026-09-18T01:01:00.000Z',
      validAfter: '2026-09-18T00:00:00.000Z', validUntil: '2026-09-18T01:00:00.000Z',
      checkedAt: '2026-09-18T01:02:00.000Z',
    },
  };
  await store.putExecutionEvidence!(request.id, proof);
  await store.putExecutionEvidence!(request.id, proof);
  assert.deepEqual(await store.getExecutionEvidence!(request.id), proof);
  assert.equal(await store.getSubmission(request.id, request.transactionHash), null);
  const failed = { outcome: 'failed' as const, observed: true as const,
    observation: { transactionHash: request.transactionHash, ledger: 9, submittedAt: '2026-09-18T00:30:00.000Z', successful: false as const } };
  await store.putExecutionEvidence!(request.id, failed);
  await store.putExecutionEvidence!(request.id, proof);
  assert.deepEqual(await store.getExecutionEvidence!(request.id), failed);
  const receipt = { version: 1 as const, transactionHash: request.transactionHash, ledger: 9,
    submittedAt: '2026-09-18T00:30:00.000Z', ledgerTransactionHash: 'b'.repeat(64) };
  await store.putSubmission(request.id, receipt);
  await store.putExecutionEvidence!(request.id, proof);
  assert.deepEqual(await store.getSubmission(request.id, request.transactionHash), receipt);
  const events = await pool.query("SELECT payload->>'change' AS change FROM mst_stellar.integration_outbox WHERE resource_id=$1 AND payload->>'change' IN ('execution_not_included','execution_failed','execution_confirmed') ORDER BY payload->>'change'", [request.id]);
  assert.deepEqual(events.rows.map((row) => row.change), ['execution_confirmed', 'execution_failed', 'execution_not_included']);
});
