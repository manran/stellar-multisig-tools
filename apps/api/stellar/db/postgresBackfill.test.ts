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
import type { ActivityEvent, ActivityFactEvent } from '../../../../src/stellar/activityTypes.js';
import { emptySorobanEffectsSnapshot } from '../../../../src/stellar/sorobanEffects.js';
import type { PrivateNoteRevision } from '../../../../src/stellar/privateNote.js';
import { applyCoordinationMigrations } from './migrate.js';
import { backfillCoordinationData } from './postgresBackfill.js';
import { assertCoordinationBackfillSchemaReady } from './postgresBackfillRuntime.js';
import { closeCoordinationPool, coordinationPool } from './postgres.js';
import { createPostgresSigningRequestStore } from './postgresSigningRequestStore.js';
import { createPostgresSorobanIntentStore } from './postgresSorobanIntentStore.js';
import type {
  RequestPrivateDataStore,
  StoredRequestPrivateData,
} from '../server/requestPrivateDataStore.js';
import type {
  SigningRequestStore,
  StoredRequestParticipant,
  StoredSignatureContribution,
  StoredSigningRequest,
  StoredSubmissionResult,
} from '../server/requestStore.js';
import type {
  SorobanIntentPrivateDataStore,
  StoredSorobanIntentPrivateData,
} from '../server/sorobanIntentPrivateDataStore.js';
import type {
  SorobanIntentStore,
  StoredSorobanIntent,
  StoredSorobanIntentAuthorizationContribution,
  StoredSorobanIntentExecutionObservation,
  StoredSorobanIntentExecutionPreparation,
} from '../server/sorobanIntentStore.js';

const TEST_URL = process.env.MST_POSTGRES_TEST_URL?.trim();
const RESET_ALLOWED = process.env.MST_POSTGRES_TEST_ALLOW_RESET === '1';
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

class MemoryRequestPrivateStore implements RequestPrivateDataStore {
  roots = new Map<string, StoredRequestPrivateData>();
  notes = new Map<string, PrivateNoteRevision[]>();
  async getRequestPrivateData(id: string) { return this.roots.get(id) ?? null; }
  async putRequestPrivateData(id: string, value: StoredRequestPrivateData) {
    const existing = this.roots.get(id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(value)) throw new Error('private mismatch');
    this.roots.set(id, value);
  }
  async listPrivateNoteRevisions(id: string) { return [...(this.notes.get(id) ?? [])]; }
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

class MemoryIntentPrivateStore implements SorobanIntentPrivateDataStore {
  roots = new Map<string, StoredSorobanIntentPrivateData>();
  async getIntentPrivateData(id: string) { return this.roots.get(id) ?? null; }
  async putIntentPrivateData(id: string, value: StoredSorobanIntentPrivateData) {
    const existing = this.roots.get(id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(value)) throw new Error('intent private mismatch');
    this.roots.set(id, value);
  }
}

class SourceRequestStore implements SigningRequestStore {
  constructor(
    readonly request: StoredSigningRequest,
    readonly contribution: StoredSignatureContribution,
    readonly submission: StoredSubmissionResult,
    readonly participant: StoredRequestParticipant,
    readonly events: ActivityEvent[],
    readonly notes: PrivateNoteRevision[],
  ) {}
  async createRequest() { throw new Error('not used'); }
  async getRequest(id: string) { return id === this.request.id ? this.request : null; }
  async listRequests() { return [this.request]; }
  async listContributions(id: string) { return id === this.request.id ? [this.contribution] : []; }
  async putContribution() { throw new Error('not used'); }
  async getSubmission(id: string, hash: string) {
    return id === this.request.id && hash === this.submission.transactionHash ? this.submission : null;
  }
  async putSubmission() { throw new Error('not used'); }
  async listRequestParticipants(id: string) { return id === this.request.id ? [this.participant] : []; }
  async listActivityEvents(id: string) { return id === this.request.id ? this.events : []; }
  async listPrivateNoteRevisions(id: string) { return id === this.request.id ? this.notes : []; }
}

class SourceIntentStore implements SorobanIntentStore {
  constructor(
    readonly intent: StoredSorobanIntent,
    readonly contribution: StoredSorobanIntentAuthorizationContribution,
    readonly preparation: StoredSorobanIntentExecutionPreparation,
    readonly observation: StoredSorobanIntentExecutionObservation,
  ) {}
  async createIntent() { throw new Error('not used'); }
  async getIntent(id: string) { return id === this.intent.id ? this.intent : null; }
  async updateIntent() { throw new Error('not used'); }
  async listContributions(id: string) { return id === this.intent.id ? [this.contribution] : []; }
  async putContribution() { throw new Error('not used'); }
  async listExecutionPreparations(id: string) { return id === this.intent.id ? [this.preparation] : []; }
  async listExecutionObservations(id: string) { return id === this.intent.id ? [this.observation] : []; }
  async putExecutionPreparation() { throw new Error('not used'); }
  async putExecutionObservation() { throw new Error('not used'); }
}

function fixtures() {
  const source = Keypair.random();
  const destination = Keypair.random();
  const signer = Keypair.random();
  const tx = new TransactionBuilder(
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
    id: 'BFREQEST00000001',
    network: 'testnet',
    baseXdr: tx.toXDR(),
    transactionHash: Buffer.from(tx.hash()).toString('hex'),
    createdAt: '2026-09-18T01:00:00.000Z',
    expiresAt: '2026-09-19T01:00:00.000Z',
    creatorAddress: signer.publicKey(),
    creatorActor: { type: 'service', id: 'fednetwork', label: 'FedNetwork' },
    integration: { version: 1, serviceId: 'fednetwork', correlationId: 'classic-bf' },
    discoverySignerKeys: [source.publicKey(), signer.publicKey()],
    executionPolicy: { mode: 'external' },
    initialPrivateNote: {
      version: 1,
      revisionId: 'initial',
      text: 'backfill private note',
      createdAt: '2026-09-18T01:00:00.000Z',
    },
    privateCommitment: {
      version: 1,
      text: 'backfill memo opening',
      saltHex: '11'.repeat(32),
      hashHex: '22'.repeat(32),
      createdAt: '2026-09-18T01:00:00.000Z',
    },
  };
  const contribution: StoredSignatureContribution = {
    version: 2,
    digest: 'classic-contribution',
    signedXdr: 'signed-xdr',
    receivedAt: '2026-09-18T01:01:00.000Z',
    acceptedSignatures: [{
      signatureIndex: 0,
      signerKey: signer.publicKey(),
      signatureHint: 'hint',
      signatureDigest: 'sig-digest',
    }],
    provenance: 'in_product_contribution',
  };
  const submission: StoredSubmissionResult = {
    version: 1,
    transactionHash: request.transactionHash,
    ledger: 123,
    // Horizon created_at historically arrived without milliseconds; PostgreSQL
    // timestamptz reads the same instant back as canonical ISO with .000Z.
    submittedAt: '2026-09-18T01:02:00Z',
  };
  const participant: StoredRequestParticipant = {
    version: 1,
    address: signer.publicKey(),
    joinedAt: '2026-09-18T01:01:00.000Z',
  };
  const events: ActivityEvent[] = [
    { version: 1, eventId: 'created', requestId: request.id, type: 'request_created', occurredAt: request.createdAt },
    { version: 1, eventId: 'approval-classic-contribution', requestId: request.id, type: 'approval_added', occurredAt: contribution.receivedAt, actorAddress: signer.publicKey() },
    { version: 1, eventId: `confirmed-${request.transactionHash}`, requestId: request.id, type: 'transaction_confirmed', occurredAt: submission.submittedAt, ledger: 123 },
    { version: 1, eventId: `submitted-${request.transactionHash}`, requestId: request.id, type: 'transaction_submitted', occurredAt: submission.submittedAt, actorAddress: signer.publicKey() },
    { version: 1, eventId: 'legacy-ready', requestId: request.id, type: 'approvals_ready', occurredAt: submission.submittedAt },
  ];
  const notes: PrivateNoteRevision[] = [{
    version: 1,
    revisionId: 'note-2',
    text: 'backfill note revision',
    createdAt: '2026-09-18T01:03:00.000Z',
    actorAddress: signer.publicKey(),
  }];

  const effects = emptySorobanEffectsSnapshot();
  const intent: StoredSorobanIntent = {
    version: 1,
    id: 'BFNTENT000000001',
    network: 'testnet',
    intent: {
      version: 1,
      network: 'testnet',
      hostFunctionXdr: 'AAAA',
      intentDigest: 'a'.repeat(64),
    },
    authorizationPlan: {
      version: 1,
      network: 'testnet',
      intentDigest: 'a'.repeat(64),
      authorizationPlanDigest: 'b'.repeat(64),
      authorizationEntriesXdr: [],
      effects,
      executionBinding: 'detached',
    },
    authorizationPlanRevision: 1,
    createdAt: '2026-09-18T01:00:30.000Z',
    creatorActor: { type: 'service', id: 'fednetwork', label: 'FedNetwork' },
    discoverySignerKeys: [signer.publicKey()],
    integration: { version: 1, serviceId: 'fednetwork', correlationId: 'soroban-bf' },
    executionPolicy: {
      mode: 'external',
      executor: { address: source.publicKey(), source: 'service_prepare' },
    },
    privateContext: {
      externalReference: 'soroban-bf',
      initialPrivateNote: {
        version: 1,
        revisionId: 'initial',
        text: 'soroban private note',
        createdAt: '2026-09-18T01:00:30.000Z',
      },
    },
    cancellation: {
      version: 1,
      cancelledAt: '2026-09-18T01:04:00.000Z',
      authorizationPlanDigest: 'b'.repeat(64),
      authorizationPlanRevision: 1,
      cancelledBy: { type: 'service', id: 'fednetwork', label: 'FedNetwork' },
    },
  };
  const auth: StoredSorobanIntentAuthorizationContribution = {
    version: 1,
    digest: 'auth-bf',
    entryIndex: 0,
    signerAddress: signer.publicKey(),
    signatureBase64: 'secret-auth',
    authorizationPlanDigest: 'b'.repeat(64),
    authorizationPlanRevision: 1,
    receivedAt: '2026-09-18T01:01:30.000Z',
  };
  const preparation: StoredSorobanIntentExecutionPreparation = {
    version: 1,
    transactionHash: 'c'.repeat(64),
    authorizationPlanDigest: 'b'.repeat(64),
    authorizationPlanRevision: 1,
    executionSource: source.publicKey(),
    transactionSequence: '2',
    validUntil: '2026-09-18T02:00:00.000Z',
    latestLedger: 44,
    effectsDigest: effects.digest,
    effectsAccepted: false,
    preparedAt: '2026-09-18T01:03:30.000Z',
  };
  const observation: StoredSorobanIntentExecutionObservation = {
    version: 1,
    transactionHash: preparation.transactionHash,
    authorizationPlanDigest: 'b'.repeat(64),
    authorizationPlanRevision: 1,
    executionSource: source.publicKey(),
    ledger: 45,
    successful: true,
    observedAt: '2026-09-18T01:05:00.000Z',
  };
  return { request, contribution, submission, participant, events, notes, intent, auth, preparation, observation };
}

before(async () => {
  if (!TEST_URL || !RESET_ALLOWED) return;
  await coordinationPool().query('DROP SCHEMA IF EXISTS mst_stellar CASCADE');
  await applyCoordinationMigrations();
});

after(async () => {
  await closeCoordinationPool();
});

test('runtime backfill requires the migration gate instead of applying schema implicitly', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  await assert.doesNotReject(() => assertCoordinationBackfillSchemaReady(coordinationPool()));
});

test('backfill is resumable, hash-verifies both protocols, drops legacy projections, and emits no outbox backlog', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  const f = fixtures();
  const sourceRequests = new SourceRequestStore(
    f.request, f.contribution, f.submission, f.participant, f.events, f.notes,
  );
  const sourceIntents = new SourceIntentStore(f.intent, f.auth, f.preparation, f.observation);
  const requestPrivate = new MemoryRequestPrivateStore();
  const intentPrivate = new MemoryIntentPrivateStore();
  const targetRequests = createPostgresSigningRequestStore(
    coordinationPool(), requestPrivate, { emitOutbox: false },
  );
  const targetIntents = createPostgresSorobanIntentStore(
    coordinationPool(), intentPrivate, { emitOutbox: false },
  );

  const first = await backfillCoordinationData({
    requests: [f.request],
    intents: [f.intent],
    sourceRequests,
    sourceIntents,
    targetRequests,
    targetIntents,
  });
  assert.equal(first.sourceDigest, first.targetDigest);
  assert.deepEqual(first.classic, {
    resources: 1,
    contributions: 1,
    submissions: 1,
    participants: 1,
    activityEvents: 1,
    privateNoteRevisions: 1,
  });
  assert.deepEqual(first.soroban, {
    resources: 1,
    contributions: 1,
    preparations: 1,
    observations: 1,
    cancellations: 1,
  });

  const second = await backfillCoordinationData({
    requests: [f.request],
    intents: [f.intent],
    sourceRequests,
    sourceIntents,
    targetRequests,
    targetIntents,
  });
  assert.equal(second.sourceDigest, first.sourceDigest);
  assert.equal(second.targetDigest, first.targetDigest);

  const outbox = await coordinationPool().query('SELECT event_id FROM mst_stellar.integration_outbox');
  assert.equal(outbox.rowCount, 0);
  const activity = await targetRequests.listActivityEvents!(f.request.id);
  assert.ok(activity.some((item) => item.type === 'transaction_submitted'));
  assert.ok(!activity.some((item) => item.type === 'approvals_ready'));
  assert.equal((await targetIntents.getIntent(f.intent.id))?.cancellation?.cancelledAt, f.intent.cancellation?.cancelledAt);
  assert.equal((await targetIntents.listExecutionObservations!(f.intent.id))[0]?.successful, true);
});
