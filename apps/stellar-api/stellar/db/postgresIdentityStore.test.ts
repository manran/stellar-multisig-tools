import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { applyCoordinationMigrations } from './migrate.js';
import { coordinationPool, closeCoordinationPool } from './postgres.js';
import { createPostgresReusableTemplateStore } from './postgresReusableTemplateStore.js';
import { createPostgresSigningRequestStore } from './postgresSigningRequestStore.js';
import { createReusableTemplate, ReusableTemplateServiceError } from '../server/reusableTemplateService.js';
import { IdentityError, PostgresIdentityStore } from '../server/identityStore.js';
import { consumeIdentityQuota } from '../server/identityQuota.js';
import type { RequestPrivateDataStore } from '../server/requestPrivateDataStore.js';

const TEST_URL = process.env.MST_POSTGRES_TEST_URL?.trim();
const RESET_ALLOWED = process.env.MST_POSTGRES_TEST_ALLOW_RESET === '1';
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

before(async () => {
  if (!TEST_URL || !RESET_ALLOWED) return;
  const pool = coordinationPool();
  const currentDb = await pool.query<{ current_database: string }>('SELECT current_database()');
  assert.equal(currentDb.rows[0].current_database, 'postgres', 'Use only the disposable local Postgres QA database');
  await pool.query('DROP SCHEMA IF EXISTS mst_stellar CASCADE');
  await applyCoordinationMigrations();
});
after(async () => { await closeCoordinationPool(); });

const active = { skip: !TEST_URL || !RESET_ALLOWED };

test('same Stellar wallet always resolves to one MST user, concurrent first login is idempotent', active, async () => {
  const store = new PostgresIdentityStore();
  const wallet = Keypair.random().publicKey();
  const users = await Promise.all(Array.from({ length: 4 }, () => store.walletUser(wallet)));
  assert.equal(new Set(users).size, 1);
  const different = await store.walletUser(Keypair.random().publicKey());
  assert.notEqual(users[0], different);
  const credential = await store.findCredential('stellar_wallet', wallet);
  assert.equal(credential?.userId, users[0]);
  assert.equal(credential?.publicKey, undefined);
});

test('WebAuthn challenge is short-lived and consumed exactly once', active, async () => {
  const store = new PostgresIdentityStore();
  const challenge = await store.createChallenge({
    challenge: randomBytes(32).toString('base64url'), purpose: 'authenticate',
    userId: null, invitationId: null, network: 'testnet',
  });
  assert.equal((await store.consumeChallenge(challenge.id, 'authenticate')).challenge, challenge.challenge);
  await assert.rejects(() => store.consumeChallenge(challenge.id, 'authenticate'),
    (cause: unknown) => cause instanceof IdentityError && cause.code === 'challenge_expired');
  const expired = await store.createChallenge({
    challenge: randomBytes(32).toString('base64url'), purpose: 'register',
    userId: randomUUID(), invitationId: null, network: 'testnet',
  });
  await store.pool.query('UPDATE mst_stellar.mst_webauthn_challenges SET expires_at = now() - interval \'1 second\' WHERE id = $1', [expired.id]);
  await assert.rejects(() => store.consumeChallenge(expired.id, 'register'),
    (cause: unknown) => cause instanceof IdentityError && cause.code === 'challenge_expired');
});

test('invited Passkey user has stable credentials, grants, Request history and revocation', active, async () => {
  const store = new PostgresIdentityStore();
  const pool = coordinationPool();
  const owner = Keypair.random().publicKey();
  const source = Keypair.random().publicKey();
  const recipient = Keypair.random().publicKey();
  const templateStore = createPostgresReusableTemplateStore(pool);
  const template = await createReusableTemplate(templateStore, owner, {
    network: 'testnet', name: 'Salary payment', kind: 'payment',
    definition: { version: 1, source,
      recipients: [{ destination: recipient, assetKey: 'native' }], signingWindowSeconds: 3600 },
  });
  const token = randomBytes(32);
  const tokenHash = createHash('sha256').update(token).digest();
  await store.createInvitation(template.id, 'testnet', owner, tokenHash);
  const invitation = await store.invitation(tokenHash);
  assert.equal(invitation?.templateName, 'Salary payment');
  assert.equal(await store.invitation(createHash('sha256').update(randomBytes(32)).digest()), null);

  const user = randomUUID();
  const passkeyId = `passkey-${randomUUID()}`;
  await store.registerPasskey({
    userId: user, newUser: true, invitationId: invitation!.id,
    id: passkeyId, publicKey: Uint8Array.from([1, 2, 3]), counter: 0,
    transports: ['internal'], deviceType: 'multiDevice', backedUp: true,
  });
  assert.equal((await store.findCredential('passkey', passkeyId))?.userId, user);
  assert.deepEqual(await store.grantedTemplateIds(user, 'testnet'), [template.id]);
  assert.deepEqual(await store.grantedTemplateIds(user, 'public'), []);
  assert.equal(await store.invitation(tokenHash), null);
  await assert.rejects(() => store.acceptInvitation(invitation!.id, user),
    (cause: unknown) => cause instanceof IdentityError && cause.code === 'invitation_invalid');

  const credential = (await store.findCredential('passkey', passkeyId))!;
  await store.updatePasskeyCounter(credential.id, 0, 6);
  assert.equal((await store.findCredential('passkey', passkeyId))?.counter, 6);
  await assert.rejects(() => store.updatePasskeyCounter(credential.id, 0, 7),
    (cause: unknown) => cause instanceof IdentityError && cause.code === 'passkey_counter_conflict');
  const wallet = Keypair.random().publicKey();
  await store.linkWallet(user, wallet);
  await store.linkWallet(user, wallet);
  assert.equal((await store.findCredential('stellar_wallet', wallet))?.userId, user);
  const secondUser = await store.walletUser(Keypair.random().publicKey());
  await assert.rejects(() => store.linkWallet(secondUser, wallet),
    (cause: unknown) => cause instanceof IdentityError && cause.code === 'wallet_already_linked');

  const unsigned = new TransactionBuilder(new Account(source, '1'), {
    fee: '100', networkPassphrase: Networks.TESTNET,
  }).addOperation(Operation.payment({ destination: recipient, asset: Asset.native(), amount: '1' }))
    .setTimeout(3600).build();
  const requestId = 'UIDENTTEMPLATE0001';
  const request = {
    version: 1 as const, id: requestId, network: 'testnet' as const,
    baseXdr: unsigned.toXDR(), transactionHash: Buffer.from(unsigned.hash()).toString('hex'),
    createdAt: '2026-11-21T08:00:00.000Z', expiresAt: '2026-11-21T09:00:00.000Z',
    proposerUserId: user, templateRef: { id: template.id, version: 1,
      name: template.name, kind: 'payment' as const },
  };
  const privateStore = {
    async getRequestPrivateData() { return null; },
    async putRequestPrivateData() {},
    async listPrivateNoteRevisions() { return []; },
    async putPrivateNoteRevision() {},
  } as RequestPrivateDataStore;
  const requests = createPostgresSigningRequestStore(pool, privateStore, { emitOutbox: false });
  await requests.createRequest(request);
  assert.equal((await requests.getRequest(requestId))?.proposerUserId, user);
  assert.deepEqual((await requests.listRequestsByProposerUser!('testnet', user)).map((item) => item.id), [requestId]);
  assert.deepEqual(await requests.listRequestsByProposerUser!('testnet', secondUser), []);
  await store.revokeUserGrant(template.id, user, owner);
  assert.equal(await store.hasGrant(user, template.id), false);
  assert.ok(await requests.getRequest(requestId), 'Already-created payment survives revocation');
  await assert.rejects(() => requests.createRequest({ ...request, id: 'UIDENTTEMPLATE0002' }),
    (cause: unknown) => cause instanceof ReusableTemplateServiceError
      && cause.code === 'template_proposer_not_authorized');
  const revoked = await pool.query<{ revoked_by_address: string }>(
    'SELECT revoked_by_address FROM mst_stellar.mst_template_user_grants WHERE template_id = $1 AND user_id = $2',
    [template.id, user],
  );
  assert.equal(revoked.rows[0].revoked_by_address, owner);
});

test('PostgreSQL identity quota counts concurrent requests atomically and resets only after expiry', active, async () => {
  const pool = coordinationPool();
  const actor = createHash('sha256').update(randomUUID()).digest();
  const bucket = `qa:${randomUUID()}`;
  const attempts = await Promise.all(Array.from({ length: 24 }, () =>
    consumeIdentityQuota(pool, bucket, actor, 9)));
  assert.equal(attempts.filter(Boolean).length, 9);
  assert.equal(attempts.filter((allowed) => !allowed).length, 15);
  const counted = await pool.query<{ hits: number }>(
    'SELECT hits FROM mst_stellar.mst_identity_rate_limits WHERE bucket = $1 AND actor_hash = $2',
    [bucket, actor],
  );
  assert.equal(counted.rows[0].hits, 24);
  await pool.query(
    "UPDATE mst_stellar.mst_identity_rate_limits SET reset_at = now() - interval '1 second' WHERE bucket = $1 AND actor_hash = $2",
    [bucket, actor],
  );
  assert.equal(await consumeIdentityQuota(pool, bucket, actor, 9), true);
  const reset = await pool.query<{ hits: number }>(
    'SELECT hits FROM mst_stellar.mst_identity_rate_limits WHERE bucket = $1 AND actor_hash = $2',
    [bucket, actor],
  );
  assert.equal(reset.rows[0].hits, 1);
});
