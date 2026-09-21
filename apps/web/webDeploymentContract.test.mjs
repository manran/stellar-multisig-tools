import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'));
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

test('Human Web delegates API traffic to the protocol gateway before SPA fallback', () => {
  assert.equal(config.functions, undefined);
  assert.equal(config.crons, undefined);
  const apiIndex = config.routes.findIndex((route) => route.src === '/api/(.*)');
  const filesystemIndex = config.routes.findIndex((route) => route.handle === 'filesystem');
  const fallbackIndex = config.routes.findIndex((route) => route.dest === '/index.html');
  assert.ok(apiIndex >= 0);
  assert.ok(filesystemIndex > apiIndex);
  assert.ok(fallbackIndex > filesystemIndex);
  assert.equal(config.routes[apiIndex].dest, '${STELLAR_API_ORIGIN}/$1');
  assert.deepEqual(config.routes[apiIndex].env, ['STELLAR_API_ORIGIN']);
  assert.equal(config.routes[apiIndex].headers['x-vercel-enable-rewrite-caching'], '0');
});

test('Human Web keeps docs separate and does not advertise itself as the API service', () => {
  const redirects = new Map(config.routes.filter((route) => route.status === 308).map((route) => [route.src, route.headers.Location]));
  assert.equal(redirects.get('/docs'), 'https://docs.multisig.tools/stellar');
  assert.equal(redirects.get('/developers'), 'https://docs.multisig.tools/stellar/developers');
  assert.doesNotMatch(html, /service-desc/);
  assert.doesNotMatch(html, /openapi\.json/);
});

test('Testnet indexing and baseline browser security headers remain deployment routing concerns', () => {
  const noindex = config.routes.find((route) => route.headers?.['X-Robots-Tag'] === 'noindex');
  assert.deepEqual(noindex?.has, [{ type: 'host', value: 'stellar-testnet.multisig.tools' }]);
  assert.equal(noindex?.continue, true);

  const security = config.routes.find((route) => route.headers?.['Content-Security-Policy']);
  assert.equal(security?.continue, true);
  assert.equal(security?.headers['Referrer-Policy'], 'no-referrer');
  assert.equal(security?.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(security?.headers['X-Frame-Options'], 'DENY');
});
