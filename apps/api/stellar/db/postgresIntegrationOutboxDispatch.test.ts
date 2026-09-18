import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { applyCoordinationMigrations } from './migrate.js';
import { closeCoordinationPool, coordinationPool } from './postgres.js';
import {
  claimIntegrationOutboxEvent,
  listDueIntegrationOutboxEventIds,
  markIntegrationOutboxPublished,
  releaseIntegrationOutboxEvent,
} from './postgresIntegrationOutboxDispatch.js';

const TEST_URL = process.env.MST_POSTGRES_TEST_URL?.trim();
const RESET_ALLOWED = process.env.MST_POSTGRES_TEST_ALLOW_RESET === '1';
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

before(async () => {
  if (!TEST_URL || !RESET_ALLOWED) return;
  const pool = coordinationPool();
  await pool.query('DROP SCHEMA IF EXISTS mst_stellar CASCADE');
  await applyCoordinationMigrations();
});

after(async () => {
  await closeCoordinationPool();
});

async function insertOutbox(
  eventId: string,
  options: {
    availableAt?: string;
    publishedAt?: string | null;
    leaseToken?: string | null;
    leaseUntil?: string | null;
  } = {},
): Promise<void> {
  await coordinationPool().query(
    `INSERT INTO mst_stellar.integration_outbox (
       event_id, service_id, resource_kind, resource_id, event_type,
       payload, created_at, available_at, published_at, lease_token, lease_until
     ) VALUES (
       $1, 'fednetwork', 'soroban_intent', 'INT1', 'coordination.changed',
       '{"version":1,"change":"changed"}'::jsonb,
       '2026-09-18T01:00:00Z', $2, $3, $4, $5
     )`,
    [
      eventId,
      options.availableAt ?? '2026-09-18T01:00:00Z',
      options.publishedAt ?? null,
      options.leaseToken ?? null,
      options.leaseUntil ?? null,
    ],
  );
}

test('due scan returns only unpublished and currently unleased outbox events', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  await insertOutbox('due-1');
  await insertOutbox('future-1', { availableAt: '2026-09-18T03:00:00Z' });
  await insertOutbox('published-1', { publishedAt: '2026-09-18T01:10:00Z' });
  await insertOutbox('leased-1', {
    leaseToken: 'worker-a',
    leaseUntil: '2026-09-18T02:10:00Z',
  });
  await insertOutbox('lease-expired-1', {
    leaseToken: 'worker-old',
    leaseUntil: '2026-09-18T01:30:00Z',
  });

  assert.deepEqual(
    await listDueIntegrationOutboxEventIds({
      now: new Date('2026-09-18T02:00:00Z'),
      pool: coordinationPool(),
    }),
    ['due-1', 'lease-expired-1'],
  );
});

test('concurrent workers cannot claim the same outbox event at the same time', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  await insertOutbox('race-1');
  const now = new Date('2026-09-18T02:00:00Z');
  const [left, right] = await Promise.all([
    claimIntegrationOutboxEvent('race-1', {
      now,
      leaseToken: 'worker-left',
      pool: coordinationPool(),
    }),
    claimIntegrationOutboxEvent('race-1', {
      now,
      leaseToken: 'worker-right',
      pool: coordinationPool(),
    }),
  ]);
  const claimed = [left, right].filter(Boolean);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0]?.record.attemptCount, 1);
});

test('publish and retry require the active lease token and never hold a DB lock across delivery', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  await insertOutbox('delivery-1');
  const pool = coordinationPool();
  const now = new Date('2026-09-18T02:00:00Z');

  const first = await claimIntegrationOutboxEvent('delivery-1', {
    now,
    leaseSeconds: 60,
    leaseToken: 'lease-1',
    pool,
  });
  assert.ok(first);
  assert.equal(await markIntegrationOutboxPublished('delivery-1', 'wrong-lease', { pool }), false);

  assert.equal(await releaseIntegrationOutboxEvent('delivery-1', 'lease-1', {
    pool,
    nextAvailableAt: new Date('2026-09-18T02:05:00Z'),
  }), true);
  assert.equal(await claimIntegrationOutboxEvent('delivery-1', {
    now: new Date('2026-09-18T02:04:59Z'),
    leaseToken: 'too-early',
    pool,
  }), null);

  const second = await claimIntegrationOutboxEvent('delivery-1', {
    now: new Date('2026-09-18T02:05:00Z'),
    leaseToken: 'lease-2',
    pool,
  });
  assert.ok(second);
  assert.equal(second.record.attemptCount, 2);
  assert.equal(await markIntegrationOutboxPublished('delivery-1', 'lease-2', {
    pool,
    publishedAt: new Date('2026-09-18T02:05:01Z'),
  }), true);
  assert.equal(await claimIntegrationOutboxEvent('delivery-1', {
    now: new Date('2026-09-18T02:06:00Z'),
    leaseToken: 'late',
    pool,
  }), null);
});
