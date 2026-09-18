import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { applyCoordinationMigrations } from './migrate.js';
import { closeCoordinationPool, coordinationPool } from './postgres.js';
import {
  completeIntegrationWebhookDelivery,
  integrationWebhookEndpointHash,
  listIntegrationWebhookDeliveries,
  startIntegrationWebhookDelivery,
} from './postgresIntegrationWebhookDeliveryHistory.js';

const TEST_URL = process.env.MST_POSTGRES_TEST_URL?.trim();
const RESET_ALLOWED = process.env.MST_POSTGRES_TEST_ALLOW_RESET === '1';
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

before(async () => {
  if (!TEST_URL || !RESET_ALLOWED) return;
  const pool = coordinationPool();
  await pool.query('DROP SCHEMA IF EXISTS mst_stellar CASCADE');
  await applyCoordinationMigrations();
  await pool.query(`
    INSERT INTO mst_stellar.integration_outbox (
      event_id, service_id, resource_kind, resource_id, event_type,
      payload, created_at, available_at
    ) VALUES (
      'evt-delivery-1', 'fednetwork', 'soroban_intent', 'INT1',
      'coordination.changed', '{"version":1}'::jsonb,
      '2026-09-18T01:00:00Z', '2026-09-18T01:00:00Z'
    )
  `);
});

after(async () => {
  await closeCoordinationPool();
});

test('delivery history stores endpoint hash instead of raw callback URL', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  const url = 'https://hooks.example.com/mst?tenant=fed';
  const record = await startIntegrationWebhookDelivery({
    eventId: 'evt-delivery-1',
    serviceId: 'fednetwork',
    attempt: 1,
    endpointUrl: url,
    startedAt: new Date('2026-09-18T01:01:00Z'),
  });
  assert.equal(record.deliveryId, 'evt-delivery-1:1');
  assert.equal(record.endpointHash, integrationWebhookEndpointHash(url));
  assert.equal(JSON.stringify(record).includes(url), false);

  const raw = await coordinationPool().query<{ body: string }>(
    `SELECT row_to_json(d)::text AS body
       FROM mst_stellar.integration_webhook_deliveries d
      WHERE delivery_id = 'evt-delivery-1:1'`,
  );
  assert.equal(raw.rows[0]?.body.includes(url), false);
});

test('delivery attempt start is idempotent and completion records only bounded audit metadata', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  const first = await startIntegrationWebhookDelivery({
    eventId: 'evt-delivery-1',
    serviceId: 'fednetwork',
    attempt: 2,
    endpointUrl: 'https://hooks.example.com/mst',
    startedAt: new Date('2026-09-18T01:02:00Z'),
  });
  const replay = await startIntegrationWebhookDelivery({
    eventId: 'evt-delivery-1',
    serviceId: 'fednetwork',
    attempt: 2,
    endpointUrl: 'https://different.example.com/mst',
    startedAt: new Date('2026-09-18T01:03:00Z'),
  });
  assert.deepEqual(replay, first);

  const completed = await completeIntegrationWebhookDelivery(first.deliveryId, {
    outcome: 'retry',
    completedAt: new Date('2026-09-18T01:02:03Z'),
    httpStatus: 503,
    errorCode: 'http_503',
    durationMs: 3000,
  });
  assert.equal(completed?.outcome, 'retry');
  assert.equal(completed?.httpStatus, 503);
  assert.equal(completed?.durationMs, 3000);

  const all = await listIntegrationWebhookDeliveries('evt-delivery-1');
  assert.equal(all.length, 2);
  assert.equal(all[1]?.attempt, 2);
});
