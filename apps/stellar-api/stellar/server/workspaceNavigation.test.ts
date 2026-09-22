import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalStellarPath } from '../../../../src/workspaceNavigation.js';
import {
  CANONICAL_STELLAR_ROUTES,
  isCanonicalStellarContentPath,
  isStellarWorkspaceHost,
  stellarActivityScopeForPath,
  stellarWorkspaceRouteForPath,
} from '../../../../src/workspaceRoutes.js';

const expectedCanonicalPaths = [
  '/',
  '/demo',
  '/inbox',
  '/new',
  '/new/payment',
  '/new/create-account',
  '/new/batch',
  '/new/claimable',
  '/new/multi-party',
  '/new/contract',
  '/new/import',
  '/contracts',
  '/contract',
  '/account/signing',
  '/account/signing/edit',
  '/activity',
  '/address-book',
  '/agent-access',
  '/treasury',
  '/treasury/activity',
  '/treasury/settings',
  '/treasury/bootstrap',
  '/treasury/change-signing',
  '/s',
  '/a',
  '/receipt',
  '/signing-room',
  '/privacy',
  '/terms',
  '/admin/integrations',
  '/developers/integrations/new',
];

test('Stellar workspace hosts include both Mainnet and Testnet deployments', () => {
  assert.equal(isStellarWorkspaceHost('stellar.multisig.tools'), true);
  assert.equal(isStellarWorkspaceHost('stellar-testnet.multisig.tools'), true);
  assert.equal(isStellarWorkspaceHost('multisig.tools'), false);
  assert.equal(isStellarWorkspaceHost('www.multisig.tools'), false);
});

test('canonical Stellar route inventory matches the public product routes', () => {
  assert.deepEqual(CANONICAL_STELLAR_ROUTES.map((route) => route.path), expectedCanonicalPaths);

  for (const route of CANONICAL_STELLAR_ROUTES) {
    assert.equal(stellarWorkspaceRouteForPath(route.path)?.kind, route.kind);
    assert.equal(stellarWorkspaceRouteForPath(route.path)?.mode, route.mode);
    const prefixed = route.path === '/' ? '/stellar' : `/stellar${route.path}`;
    assert.equal(stellarWorkspaceRouteForPath(prefixed)?.kind, route.kind);
    assert.equal(stellarWorkspaceRouteForPath(prefixed)?.mode, route.mode);
  }
});

test('Payment and CreateAccount are distinct canonical entries on the same New surface', () => {
  assert.equal(stellarWorkspaceRouteForPath('/new/payment')?.kind, 'new');
  assert.equal(stellarWorkspaceRouteForPath('/new/create-account')?.kind, 'new');
  assert.equal(stellarWorkspaceRouteForPath('/stellar/new/create-account')?.kind, 'new');
});

test('retired public URL paths are not routes', () => {
  for (const path of ['/account', '/accounts', '/signers', '/designer', '/request', '/transaction', '/docs', '/developers']) {
    assert.equal(stellarWorkspaceRouteForPath(path), null, path);
    assert.equal(stellarWorkspaceRouteForPath(`/stellar${path}`), null, `/stellar${path}`);
  }
  assert.equal(stellarWorkspaceRouteForPath('/treasury/unknown'), null);
  assert.equal(stellarWorkspaceRouteForPath('/new/unknown'), null);
  assert.equal(stellarWorkspaceRouteForPath('/docs/unknown'), null);
});

test('Activity scope is owned by the explicit route, not a saved workspace preference', () => {
  assert.equal(stellarActivityScopeForPath('/activity'), 'personal');
  assert.equal(stellarActivityScopeForPath('/stellar/activity'), 'personal');
  assert.equal(stellarActivityScopeForPath('/treasury/activity'), 'treasury');
  assert.equal(stellarActivityScopeForPath('/stellar/treasury/activity'), 'treasury');
  assert.equal(stellarActivityScopeForPath('/treasury'), null);
  assert.equal(stellarActivityScopeForPath('/inbox'), null);
});

test('internal call-site aliases generate canonical URLs without becoming public routes', () => {
  assert.equal(canonicalStellarPath('/request'), '/s');
  assert.equal(canonicalStellarPath('/accounts'), '/treasury');
  assert.equal(canonicalStellarPath('/account'), '/treasury');
  assert.equal(canonicalStellarPath('/signers'), '/address-book');
  assert.equal(canonicalStellarPath('/designer'), '/treasury/change-signing');

  assert.equal(canonicalStellarPath('/address-book'), '/address-book');
  assert.equal(canonicalStellarPath('/activity'), '/activity');
  assert.equal(canonicalStellarPath('/treasury'), '/treasury');
});

test('shared Human content routes are separate from network-bound runtime routes', () => {
  for (const path of ['/demo', '/privacy', '/terms']) {
    assert.equal(isCanonicalStellarContentPath(path), true, path);
  }
  for (const path of ['/', '/docs', '/developers', '/inbox', '/new', '/treasury', '/contracts', '/activity', '/s', '/a', '/admin/integrations']) {
    assert.equal(isCanonicalStellarContentPath(path), false, path);
  }
});
