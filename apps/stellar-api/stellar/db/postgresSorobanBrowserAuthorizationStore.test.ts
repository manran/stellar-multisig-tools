import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { applyCoordinationMigrations } from './migrate.js';
import { closeCoordinationPool, coordinationPool } from './postgres.js';
import { createPostgresSorobanBrowserAuthorizationStore } from './postgresSorobanBrowserAuthorizationStore.js';

const TEST_URL = process.env.MST_POSTGRES_TEST_URL?.trim();
const RESET_ALLOWED = process.env.MST_POSTGRES_TEST_ALLOW_RESET === '1';
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

before(async () => {
  if (!TEST_URL || !RESET_ALLOWED) return;
  const pool = coordinationPool();
  await pool.query('DROP SCHEMA IF EXISTS mst_stellar CASCADE');
  await applyCoordinationMigrations();
  await pool.query(`
    INSERT INTO mst_stellar.soroban_intents (
      id, network, intent_digest, intent, authorization_plan,
      authorization_plan_revision, authorization_plan_history, created_at
    ) VALUES (
      'INTCAP0000000001', 'testnet', repeat('a', 64),
      '{"version":1}'::jsonb, '{"version":1}'::jsonb,
      2, '[]'::jsonb, '2026-09-19T10:00:00Z'
    )
  `);
});

after(async () => {
  await closeCoordinationPool();
});

test('PostgreSQL persists only hashed Browser capability material and cascades it with the Intent', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  const store = createPostgresSorobanBrowserAuthorizationStore(coordinationPool());
  await store.putCapability({
    version: 1,
    capabilityId: 'capability01',
    intentId: 'INTCAP0000000001',
    integrationServiceId: 'fednetwork',
    signerAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    authorizationPlanRevision: 2,
    authorizationPlanDigest: 'b'.repeat(64),
    origin: 'https://fed.network',
    secretHash: 'c'.repeat(64),
    createdAt: '2026-09-19T10:00:00.000Z',
    expiresAt: '2026-09-19T10:30:00.000Z',
  });
  const read = await store.getCapability('capability01');
  assert.equal(read?.intentId, 'INTCAP0000000001');
  assert.equal(read?.origin, 'https://fed.network');
  assert.equal(read?.secretHash, 'c'.repeat(64));

  const raw = await coordinationPool().query<{ body: string }>(
    "SELECT row_to_json(c)::text AS body FROM mst_stellar.soroban_browser_authorization_capabilities c WHERE capability_id = 'capability01'",
  );
  assert.equal(raw.rows[0]?.body.includes('mic_'), false);

  await coordinationPool().query("DELETE FROM mst_stellar.soroban_intents WHERE id = 'INTCAP0000000001'");
  assert.equal(await store.getCapability('capability01'), null);
});
