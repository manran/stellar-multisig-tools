import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { applyCoordinationMigrations } from './migrate.js';
import {
  closeCoordinationPool,
  coordinationPool,
  normalizePostgresConnectionString,
  withCoordinationTransaction,
} from './postgres.js';

const TEST_URL = process.env.MST_POSTGRES_TEST_URL?.trim();
const RESET_ALLOWED = process.env.MST_POSTGRES_TEST_ALLOW_RESET === '1';

if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

before(async () => {
  if (!TEST_URL || !RESET_ALLOWED) return;
  const pool = coordinationPool();
  await pool.query('DROP SCHEMA IF EXISTS mst_stellar CASCADE');
});

after(async () => {
  await closeCoordinationPool();
});

test('PostgreSQL connection normalization preserves local URLs and pins weak TLS aliases to verify-full', () => {
  assert.equal(
    normalizePostgresConnectionString('postgresql://postgres@127.0.0.1:55432/postgres'),
    'postgresql://postgres@127.0.0.1:55432/postgres',
  );
  const neon = normalizePostgresConnectionString(
    'postgresql://user:pass@example.neon.tech/db?sslmode=require&channel_binding=require',
  );
  const parsed = new URL(neon);
  assert.equal(parsed.searchParams.get('sslmode'), 'verify-full');
  assert.equal(parsed.searchParams.get('channel_binding'), 'require');
});

test('coordination migration is repeatable through the migration runner', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  assert.deepEqual(await applyCoordinationMigrations(), ['0001_coordination', '0002_private_context_flags', '0003_outbox_leases', '0004_webhook_delivery_history', '0005_browser_authorization_capabilities', '0006_classic_managed_channel_leases', '0007_classic_managed_channel_index']);
  assert.deepEqual(await applyCoordinationMigrations(), []);
  const rows = await coordinationPool().query<{ version: string }>(
    'SELECT version FROM mst_stellar.schema_migrations ORDER BY version',
  );
  assert.deepEqual(rows.rows.map((row) => row.version), ['0001_coordination', '0002_private_context_flags', '0003_outbox_leases', '0004_webhook_delivery_history', '0005_browser_authorization_capabilities', '0006_classic_managed_channel_leases', '0007_classic_managed_channel_index']);
});

test('business mutation and outbox insertion share one rollback boundary', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  const pool = coordinationPool();
  await pool.query(`
    INSERT INTO mst_stellar.classic_requests (
      id, network, base_xdr, transaction_hash, created_at, expires_at,
      integration_service_id, integration_context
    ) VALUES (
      'REQ0000000000001', 'testnet', 'AAAA', repeat('a', 64),
      '2026-09-18T01:00:00Z', '2026-09-19T01:00:00Z',
      'fednetwork', '{"version":1,"serviceId":"fednetwork","correlationId":"classic-1"}'::jsonb
    )
  `);

  await assert.rejects(
    () => withCoordinationTransaction(async (client) => {
      await client.query(`
        INSERT INTO mst_stellar.classic_activity_events (
          request_id, event_id, type, occurred_at
        ) VALUES ('REQ0000000000001', 'atomic-proof', 'approval_added', now())
      `);
      await client.query(`
        INSERT INTO mst_stellar.integration_outbox (
          event_id, service_id, resource_kind, resource_id, event_type, created_at, available_at
        ) VALUES (
          'outbox-atomic-proof', 'fednetwork', 'classic_request',
          'REQ0000000000001', 'job.updated', now(), now()
        )
      `);
      throw new Error('force rollback');
    }),
    /force rollback/,
  );

  const facts = await pool.query(
    "SELECT 1 FROM mst_stellar.classic_activity_events WHERE event_id = 'atomic-proof'",
  );
  const outbox = await pool.query(
    "SELECT 1 FROM mst_stellar.integration_outbox WHERE event_id = 'outbox-atomic-proof'",
  );
  assert.equal(facts.rowCount, 0);
  assert.equal(outbox.rowCount, 0);
});

test('coordination uniqueness and cross-protocol Service Activity stay deterministic', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  const pool = coordinationPool();
  await pool.query(`
    INSERT INTO mst_stellar.soroban_intents (
      id, network, intent_digest, intent, authorization_plan, created_at,
      integration_service_id, integration_context, external_reference
    ) VALUES (
      'INT0000000000001', 'testnet', repeat('b',64),
      '{"version":1}'::jsonb, '{"authorizationPlanDigest":"p1"}'::jsonb,
      '2026-09-18T01:01:00Z', 'fednetwork',
      '{"version":1,"serviceId":"fednetwork","correlationId":"soroban-1"}'::jsonb,
      'soroban-1'
    )
  `);
  await pool.query(`
    INSERT INTO mst_stellar.soroban_intent_cancellations (
      intent_id, cancelled_at, authorization_plan_digest, authorization_plan_revision
    ) VALUES ('INT0000000000001', now(), 'p1', 1)
  `);
  await assert.rejects(
    () => pool.query(`
      INSERT INTO mst_stellar.soroban_intent_cancellations (
        intent_id, cancelled_at, authorization_plan_digest, authorization_plan_revision
      ) VALUES ('INT0000000000001', now(), 'p2', 2)
    `),
    (cause: unknown) => typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '23505',
  );

  const work = await pool.query<{ kind: string; id: string }>(`
    SELECT kind, id
      FROM mst_stellar.integration_work
     WHERE service_id = 'fednetwork'
     ORDER BY created_at DESC, kind DESC, id DESC
  `);
  assert.deepEqual(work.rows, [
    { kind: 'soroban_intent', id: 'INT0000000000001' },
    { kind: 'classic_request', id: 'REQ0000000000001' },
  ]);
});
