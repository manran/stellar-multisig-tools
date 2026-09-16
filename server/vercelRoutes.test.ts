import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CANONICAL_STELLAR_ROUTES } from '../src/workspaceRoutes.js';

interface Rewrite { source: string; destination: string }
interface ConditionalRoute {
  source: string;
  destination?: string;
  permanent?: boolean;
  has?: Array<{ type: string; value?: string }>;
  headers?: Array<{ key: string; value: string }>;
}

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  rewrites?: Rewrite[];
  redirects?: ConditionalRoute[];
  headers?: ConditionalRoute[];
};
const spaSources = (config.rewrites ?? [])
  .filter((rewrite) => rewrite.destination === '/index.html')
  .map((rewrite) => rewrite.source);

function covers(source: string, path: string) {
  if (source === path) return true;
  if (!source.endsWith('/:path*')) return false;
  const parent = source.slice(0, -7);
  return path.startsWith(`${parent}/`);
}

test('Vercel SPA rewrites cover every canonical Stellar route on refresh', () => {
  for (const route of CANONICAL_STELLAR_ROUTES) {
    if (route.path === '/') continue;
    assert.ok(spaSources.some((source) => covers(source, route.path)), route.path);
    const prefixed = `/stellar${route.path}`;
    assert.ok(spaSources.some((source) => covers(source, prefixed)), prefixed);
  }
});

test('Vercel does not preserve retired pre-launch route families', () => {
  assert.equal(spaSources.includes('/account'), false, '/account');
  for (const retired of ['/accounts', '/designer', '/request', '/transaction']) {
    assert.equal(
      spaSources.some((source) => source === retired || source.startsWith(`${retired}/`)),
      false,
      retired,
    );
  }
});


test('Testnet serves runtime routes but redirects shared content to the canonical Mainnet site', () => {
  const redirects = config.redirects ?? [];
  const expected = new Map([
    ['/demo', 'https://stellar.multisig.tools/demo'],
    ['/docs', 'https://stellar.multisig.tools/docs'],
    ['/developers', 'https://stellar.multisig.tools/developers'],
    ['/privacy', 'https://stellar.multisig.tools/privacy'],
    ['/terms', 'https://stellar.multisig.tools/terms'],
  ]);
  for (const [source, destination] of expected) {
    const redirect = redirects.find((item) => item.source === source);
    assert.ok(redirect, source);
    assert.equal(redirect.destination, destination);
    assert.equal(redirect.permanent, true);
    assert.deepEqual(redirect.has, [{ type: 'host', value: 'stellar-testnet.multisig.tools' }]);
  }
  const nestedDocs = redirects.find((item) => item.source === '/docs/:path*');
  assert.equal(nestedDocs?.destination, 'https://stellar.multisig.tools/docs/:path*');
  assert.deepEqual(nestedDocs?.has, [{ type: 'host', value: 'stellar-testnet.multisig.tools' }]);
});

test('Testnet runtime is excluded from search indexing without changing Mainnet headers', () => {
  const header = (config.headers ?? []).find((item) =>
    item.has?.some((condition) => condition.type === 'host' && condition.value === 'stellar-testnet.multisig.tools'));
  assert.ok(header);
  assert.deepEqual(header.headers, [{ key: 'X-Robots-Tag', value: 'noindex' }]);
});
