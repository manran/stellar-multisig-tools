import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { applyCoordinationMigrations } from './migrate.js';
import { closeCoordinationPool, coordinationPool } from './postgres.js';
import { createPostgresClassicManagedChannelStore } from './postgresClassicManagedChannelStore.js';

const TEST_URL = process.env.MST_POSTGRES_TEST_URL?.trim();
const RESET_ALLOWED = process.env.MST_POSTGRES_TEST_ALLOW_RESET === '1';
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

before(async () => {
  if (!TEST_URL || !RESET_ALLOWED) return;
  await coordinationPool().query('DROP SCHEMA IF EXISTS mst_stellar CASCADE');
  await applyCoordinationMigrations();
});

after(async () => {
  await closeCoordinationPool();
});

test('PostgreSQL managed Classic channel lease is exclusive, idempotent and reclaimable after expiry', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  const store = createPostgresClassicManagedChannelStore(coordinationPool());
  const channel = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

  assert.equal(await store.claimLease({
    network: 'testnet',
    channelAccount: channel,
    requestId: 'A'.repeat(16),
    leasedAt: '2026-09-19T10:00:00.000Z',
    expiresAt: '2026-09-19T11:00:00.000Z',
  }), true);

  assert.equal(await store.claimLease({
    network: 'testnet',
    channelAccount: channel,
    requestId: 'B'.repeat(16),
    leasedAt: '2026-09-19T10:30:00.000Z',
    expiresAt: '2026-09-19T11:30:00.000Z',
  }), false);

  assert.equal(await store.claimLease({
    network: 'testnet',
    channelAccount: channel,
    requestId: 'A'.repeat(16),
    leasedAt: '2026-09-19T10:31:00.000Z',
    expiresAt: '2026-09-19T12:00:00.000Z',
  }), true);
  assert.equal((await store.getLeaseForRequest('A'.repeat(16)))?.expiresAt, '2026-09-19T12:00:00.000Z');

  assert.equal(await store.claimLease({
    network: 'testnet',
    channelAccount: channel,
    requestId: 'B'.repeat(16),
    leasedAt: '2026-09-19T12:01:00.000Z',
    expiresAt: '2026-09-19T13:00:00.000Z',
  }), true);
  assert.equal(await store.getLeaseForRequest('A'.repeat(16)), null);
  assert.equal((await store.getLeaseForRequest('B'.repeat(16)))?.channelAccount, channel);

  await store.releaseRequest('B'.repeat(16));
  assert.equal(await store.getLeaseForRequest('B'.repeat(16)), null);
});
