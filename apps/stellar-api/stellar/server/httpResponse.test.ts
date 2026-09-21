import assert from 'node:assert/strict';
import test from 'node:test';
import { noStoreJson, publicCorsHeaders, publicCorsJson } from './httpResponse.js';

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
