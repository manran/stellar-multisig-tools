import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import {
  enforceIdentityQuota,
  IdentityQuotaError,
  identityClientAddress,
} from './identityQuota.js';

function request(address?: string, header = 'cf-connecting-ip'): Request {
  return new Request('https://stellar-testnet.multisig.tools/api/identity', {
    method: 'POST',
    headers: address ? { [header]: address } : undefined,
  });
}

function fakePool(): Pick<Pool, 'query'> & { counts: Map<string, number> } {
  const counts = new Map<string, number>();
  const query = async (sql: string, parameters?: unknown[]) => {
    if (!sql.includes('INSERT INTO mst_stellar.mst_identity_rate_limits')) return { rows: [] };
    const key = `${parameters?.[0]}:${Buffer.from(parameters?.[1] as Uint8Array).toString('hex')}`;
    const hits = (counts.get(key) ?? 0) + 1;
    counts.set(key, hits);
    return { rows: [{ hits }] };
  };
  return { query, counts } as unknown as Pick<Pool, 'query'> & { counts: Map<string, number> };
}

test('identity quota reads only normalized edge-controlled client addresses', () => {
  assert.equal(identityClientAddress(request('198.51.100.7')), '198.51.100.7');
  assert.equal(identityClientAddress(request('::ffff:198.51.100.7')), '198.51.100.7');
  assert.equal(identityClientAddress(request('203.0.113.4', 'x-vercel-forwarded-for')), null);
  const originalVercel = process.env.VERCEL;
  process.env.VERCEL = '1';
  try {
    assert.equal(identityClientAddress(request('203.0.113.4', 'x-vercel-forwarded-for')), '203.0.113.4');
    assert.equal(identityClientAddress(request('203.0.113.4', 'cf-connecting-ip')), null);
  } finally {
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  }
  const originalProvider = process.env.MST_IDENTITY_TRUSTED_PROXY;
  process.env.MST_IDENTITY_TRUSTED_PROXY = 'cloudflare';
  process.env.VERCEL = '1';
  try {
    assert.equal(identityClientAddress(request('198.51.100.7')), '198.51.100.7');
    assert.equal(identityClientAddress(request('203.0.113.4', 'x-vercel-forwarded-for')), null);
  } finally {
    if (originalProvider === undefined) delete process.env.MST_IDENTITY_TRUSTED_PROXY;
    else process.env.MST_IDENTITY_TRUSTED_PROXY = originalProvider;
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  }
  assert.equal(identityClientAddress(request('198.51.100.1, 203.0.113.4')), null);
  assert.equal(identityClientAddress(request('203.0.113.4', 'x-forwarded-for')), null);
  assert.equal(identityClientAddress(request()), null);
});

test('registration quota is shared, per-client and per-network', async () => {
  const pool = fakePool();
  const first = request('198.51.100.10');
  for (let index = 0; index < 8; index += 1) {
    await enforceIdentityQuota(first, 'testnet', 'registration_options', pool);
  }
  await assert.rejects(() => enforceIdentityQuota(first, 'testnet', 'registration_options', pool),
    (cause: unknown) => cause instanceof IdentityQuotaError
      && cause.status === 429 && cause.code === 'identity_rate_limited'
      && cause.retryAfterSeconds === 300);
  await enforceIdentityQuota(request('198.51.100.11'), 'testnet', 'registration_options', pool);
  await enforceIdentityQuota(first, 'public', 'registration_options', pool);
  // Credential check failures never consume the cheap "start login" quota.
  await enforceIdentityQuota(first, 'testnet', 'authentication_verify', pool);
});

test('unknown actions share a bounded bucket and clients missing edge headers do not get unlimited access', async () => {
  const pool = fakePool();
  for (let index = 0; index < 15; index += 1) {
    await enforceIdentityQuota(request(), 'testnet', 'unknown_aaa', pool);
  }
  await assert.rejects(() => enforceIdentityQuota(request('not an ip'), 'testnet', 'unknown_bbb', pool),
    (cause: unknown) => cause instanceof IdentityQuotaError && cause.status === 429);
});

test('identity quota fails closed when the shared database cannot count attempts', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const pool = { async query() { throw new Error('database down'); } } as unknown as Pick<Pool, 'query'>;
    await assert.rejects(() => enforceIdentityQuota(request('198.51.100.12'), 'testnet', 'authentication_options', pool),
      (cause: unknown) => cause instanceof IdentityQuotaError
        && cause.status === 503 && cause.code === 'identity_rate_limit_unavailable');
  } finally {
    console.error = originalError;
  }
});
