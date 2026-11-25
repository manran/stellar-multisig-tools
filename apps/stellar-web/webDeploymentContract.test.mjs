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

test('Human Web does not own public Docs or hijack developer product routes', () => {
  assert.equal(config.routes.some((route) => route.src === '/docs' || route.src === '/docs/(.*)'), false);
  assert.equal(config.routes.some((route) => route.src === '/developers' || route.src === '/developers/(.*)'), false);
  assert.match(html, /rel="service-desc" href="\/api\/openapi\.json"/);
  assert.match(html, /rel="api-catalog" href="\/\.well-known\/api-catalog"/);
  assert.match(html, /rel="describedby" href="\/llms\.txt"/);
  assert.match(html, /rel="service-doc" href="https:\/\/docs\.multisig\.tools\/stellar\/developers\/agent-quickstart"/);
});

test('RFC 9727 API Catalog has a real static route, proper media type, and HEAD Link header', () => {
  const catalogRoute = config.routes.find((route) => route.src.includes('api-catalog'));
  const homeRoute = config.routes.find((route) => route.src === '/');
  assert.equal(catalogRoute?.continue, true);
  assert.match(catalogRoute.headers['Content-Type'], /^application\/linkset\+json/);
  assert.match(catalogRoute.headers.Link, /rel="api-catalog"/);
  assert.match(homeRoute?.headers?.Link, /rel="api-catalog"/);
  assert.match(homeRoute?.headers?.Link, /rel="service-desc"/);
  assert.match(homeRoute?.headers?.Link, /rel="service-doc"/);
  const filesystemIndex = config.routes.findIndex((route) => route.handle === 'filesystem');
  assert.ok(config.routes.indexOf(catalogRoute) < filesystemIndex);
  assert.ok(config.routes.indexOf(homeRoute) < filesystemIndex);
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
