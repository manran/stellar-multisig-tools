import assert from 'node:assert/strict';
import test from 'node:test';
import { apiErrorBody, noStoreJson, publicCorsHeaders, publicCorsJson } from './httpResponse.js';
import { assertKnownRequestFields, RequestBodyError } from './requestBody.js';

test('noStoreJson applies the shared private-response policy and preserves unrelated headers', async () => {
  const response = noStoreJson({ ok: true }, 201, {
    'Set-Cookie': 'session=value',
    'Cache-Control': 'public',
    'Referrer-Policy': 'unsafe-url',
  });

  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('set-cookie'), 'session=value');
  assert.deepEqual(await response.json(), { ok: true });
});

test('publicCorsHeaders shares the public API CORS policy while keeping methods endpoint-specific', () => {
  const headers = publicCorsHeaders('GET, PUT, DELETE, OPTIONS');
  assert.equal(headers['Access-Control-Allow-Origin'], '*');
  assert.equal(headers['Access-Control-Allow-Headers'], 'Authorization, Content-Type');
  assert.equal(headers['Access-Control-Allow-Methods'], 'GET, PUT, DELETE, OPTIONS');
});

test('publicCorsJson combines CORS with the non-cacheable private response policy', () => {
  const response = publicCorsJson({ ok: true }, 'GET, OPTIONS', 200, {
    'Access-Control-Allow-Origin': 'https://example.com',
  });
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
});

test('validation errors expose structured field details without changing recovery fields', async () => {
  assert.throws(() => assertKnownRequestFields({ payments: [{ memoo: 'x' }] }, 'ClassicPaymentPrepareInput'), (cause: unknown) =>
    cause instanceof RequestBodyError && apiErrorBody(cause).details?.field === 'payments[0].memoo');
  const invalid = await noStoreJson({ error: 'unsupported lifetime', code: 'invalid_transaction_lifetime' }, 400).json();
  assert.deepEqual(invalid.details, { field: 'lifetimeSeconds', allowedValues: [3600, 86400, 604800] });
  const existing = { error: 'conflict', code: 'idempotency_conflict', details: { original: 'a' } };
  assert.deepEqual(await noStoreJson(existing, 409).json(), existing);
});
