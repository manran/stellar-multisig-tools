import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CANONICAL_STELLAR_ROUTES } from '../src/workspaceRoutes.js';

interface Rewrite { source: string; destination: string }

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  rewrites?: Rewrite[];
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
