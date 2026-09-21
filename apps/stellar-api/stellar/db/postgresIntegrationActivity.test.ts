import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { applyCoordinationMigrations } from './migrate.js';
import { closeCoordinationPool, coordinationPool } from './postgres.js';
import {
  IntegrationActivityCursorError,
  listIntegrationWorkPage,
} from './postgresIntegrationActivity.js';

const TEST_URL = process.env.MST_POSTGRES_TEST_URL?.trim();
const RESET_ALLOWED = process.env.MST_POSTGRES_TEST_ALLOW_RESET === '1';
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

before(async () => {
  if (!TEST_URL || !RESET_ALLOWED) return;
  const pool = coordinationPool();
  await pool.query('DROP SCHEMA IF EXISTS mst_stellar CASCADE');
  await applyCoordinationMigrations();
  await pool.query(`
    INSERT INTO mst_stellar.classic_requests (
      id, network, base_xdr, transaction_hash, created_at, expires_at,
      integration_service_id, integration_context
    ) VALUES
      ('ACTCLASSIC000001', 'testnet', 'AAAA', repeat('a',64),
       '2026-09-18T01:00:00Z', '2026-09-19T01:00:00Z',
       'fednetwork', '{"version":1,"serviceId":"fednetwork","correlationId":"c-1"}'::jsonb),
      ('ACTCLASSIC000002', 'public', 'AAAA', repeat('b',64),
       '2026-09-18T01:02:00Z', '2026-09-19T01:02:00Z',
       'fednetwork', '{"version":1,"serviceId":"fednetwork","correlationId":"c-2"}'::jsonb)
  `);
  await pool.query(`
    INSERT INTO mst_stellar.soroban_intents (
      id, network, intent_digest, intent, authorization_plan, created_at,
      integration_service_id, integration_context, external_reference
    ) VALUES
      ('ACTINTENT0000001', 'testnet', repeat('c',64),
       '{"version":1}'::jsonb, '{"authorizationPlanDigest":"p1"}'::jsonb,
       '2026-09-18T01:01:00Z', 'fednetwork',
       '{"version":1,"serviceId":"fednetwork","correlationId":"s-1"}'::jsonb, 's-1'),
      ('OTHERINTENT00001', 'testnet', repeat('d',64),
       '{"version":1}'::jsonb, '{"authorizationPlanDigest":"p2"}'::jsonb,
       '2026-09-18T01:03:00Z', 'other-service',
       '{"version":1,"serviceId":"other-service"}'::jsonb, null)
  `);
});

after(async () => {
  await closeCoordinationPool();
});

test('Integration Service Activity paginates one cross-protocol identity stream', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  const pool = coordinationPool();
  const first = await listIntegrationWorkPage('FedNetwork', { pool, limit: 2 });
  assert.deepEqual(first.items.map((item) => [item.kind, item.id]), [
    ['classic_request', 'ACTCLASSIC000002'],
    ['soroban_intent', 'ACTINTENT0000001'],
  ]);
  assert.ok(first.nextCursor);

  const second = await listIntegrationWorkPage('fednetwork', {
    pool,
    limit: 2,
    cursor: first.nextCursor,
  });
  assert.deepEqual(second.items.map((item) => [item.kind, item.id]), [
    ['classic_request', 'ACTCLASSIC000001'],
  ]);
  assert.equal(second.nextCursor, undefined);
  assert.equal(second.items[0]?.externalReference, 'c-1');
});

test('Integration Service Activity can filter by deployment network without exposing another Service', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  const page = await listIntegrationWorkPage('fednetwork', {
    pool: coordinationPool(),
    network: 'testnet',
  });
  assert.deepEqual(page.items.map((item) => item.id), [
    'ACTINTENT0000001',
    'ACTCLASSIC000001',
  ]);
  assert.ok(page.items.every((item) => item.network === 'testnet'));
  assert.ok(page.items.every((item) => item.id !== 'OTHERINTENT00001'));
});

test('Integration Service Activity rejects malformed cursors instead of restarting pagination', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  await assert.rejects(
    () => listIntegrationWorkPage('fednetwork', {
      pool: coordinationPool(),
      cursor: 'not-a-valid-cursor',
    }),
    IntegrationActivityCursorError,
  );
});
