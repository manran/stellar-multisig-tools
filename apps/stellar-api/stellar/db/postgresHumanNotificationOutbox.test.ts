import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { applyCoordinationMigrations } from './migrate.js';
import { closeCoordinationPool, coordinationPool } from './postgres.js';
import {
  claimHumanNotificationEvent,
  completeHumanNotificationEvent,
  enqueueSignatureRequestedNotification,
  listDueHumanNotificationEventIds,
  releaseHumanNotificationEvent,
} from './postgresHumanNotificationOutbox.js';

const TEST_URL = process.env.MST_POSTGRES_TEST_URL?.trim();
const RESET_ALLOWED = process.env.MST_POSTGRES_TEST_ALLOW_RESET === '1';
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

before(async () => {
  if (!TEST_URL || !RESET_ALLOWED) return;
  const pool = coordinationPool();
  await pool.query('DROP SCHEMA IF EXISTS mst_stellar CASCADE');
  await applyCoordinationMigrations();
  await pool.query(
    `INSERT INTO mst_stellar.classic_requests (
       id, network, base_xdr, transaction_hash, created_at, expires_at
     ) VALUES (
       '0123456789ABCDEF', 'testnet', 'AAAA', $1,
       '2026-10-30T12:00:00Z', '2026-10-31T12:00:00Z'
     )`,
    ['a'.repeat(64)],
  );
});

after(async () => {
  await closeCoordinationPool();
});

test('Human notification outbox is idempotent, leased, retryable, and scrubs terminal email', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  const pool = coordinationPool();
  const first = await enqueueSignatureRequestedNotification({
    requestId: '0123456789ABCDEF',
    recipientSignerAddress: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBK4',
    actorAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    destinationEmail: 'Bob@example.com',
    createdAt: new Date('2026-10-30T12:05:00Z'),
  }, pool);
  const replay = await enqueueSignatureRequestedNotification({
    requestId: '0123456789ABCDEF',
    recipientSignerAddress: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBK4',
    actorAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    destinationEmail: 'bob@example.com',
    createdAt: new Date('2026-10-30T12:06:00Z'),
  }, pool);

  assert.equal(first.created, true);
  assert.deepEqual(replay, { eventId: first.eventId, created: false });
  assert.deepEqual(
    await listDueHumanNotificationEventIds({
      now: new Date('2026-10-30T12:05:00Z'),
      pool,
    }),
    [first.eventId],
  );

  const claimed = await claimHumanNotificationEvent(first.eventId, {
    now: new Date('2026-10-30T12:05:00Z'),
    leaseToken: 'lease-1',
    pool,
  });
  assert.ok(claimed);
  assert.equal(claimed.record.destinationEmail, 'Bob@example.com');
  assert.equal(claimed.record.network, 'testnet');
  assert.equal(claimed.record.attemptCount, 1);

  assert.equal(await releaseHumanNotificationEvent(
    first.eventId,
    'lease-1',
    new Date('2026-10-30T12:10:00Z'),
    pool,
  ), true);
  assert.equal(await claimHumanNotificationEvent(first.eventId, {
    now: new Date('2026-10-30T12:09:59Z'),
    leaseToken: 'too-early',
    pool,
  }), null);

  const retry = await claimHumanNotificationEvent(first.eventId, {
    now: new Date('2026-10-30T12:10:00Z'),
    leaseToken: 'lease-2',
    pool,
  });
  assert.ok(retry);
  assert.equal(retry.record.attemptCount, 2);

  assert.equal(await completeHumanNotificationEvent(first.eventId, 'lease-2', {
    outcome: 'sent',
    completedAt: new Date('2026-10-30T12:10:01Z'),
    providerMessageId: 'email-123',
  }, pool), true);

  const stored = await pool.query<{
    destination_email: string | null;
    destination_email_hash: string;
    outcome: string | null;
    provider_message_id: string | null;
  }>(
    `SELECT destination_email, destination_email_hash, outcome, provider_message_id
       FROM mst_stellar.human_notification_outbox
      WHERE event_id = $1`,
    [first.eventId],
  );
  assert.equal(stored.rows[0]?.destination_email, null);
  assert.equal(stored.rows[0]?.destination_email_hash.length, 64);
  assert.equal(stored.rows[0]?.outcome, 'sent');
  assert.equal(stored.rows[0]?.provider_message_id, 'email-123');
});
