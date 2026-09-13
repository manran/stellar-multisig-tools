import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalStellarPath, stellarHrefForLocation, stellarHrefWithSearchForLocation } from '../workspaceNavigation.js';

test('internal route aliases canonicalize without becoming public route aliases', () => {
  assert.equal(canonicalStellarPath('/accounts'), '/treasury');
  assert.equal(canonicalStellarPath('/account'), '/treasury');
  assert.equal(canonicalStellarPath('/designer'), '/treasury/change-signing');
  assert.equal(canonicalStellarPath('/request'), '/s');
  assert.equal(canonicalStellarPath('/signers'), '/address-book');
});

test('stellar subdomain hrefs use canonical paths without a /stellar prefix', () => {
  assert.equal(
    stellarHrefForLocation('/accounts', 'https://stellar.multisig.tools/inbox?view=ready#old'),
    'https://stellar.multisig.tools/treasury',
  );
  assert.equal(
    stellarHrefForLocation('/designer', 'https://stellar.multisig.tools/inbox'),
    'https://stellar.multisig.tools/treasury/change-signing',
  );
});

test('directory-host hrefs use the /stellar prefix and canonical paths', () => {
  assert.equal(
    stellarHrefForLocation('/request', 'https://multisig.tools/stellar/inbox?view=ready'),
    'https://multisig.tools/stellar/s',
  );
  assert.equal(
    stellarHrefForLocation('/new/import', 'https://multisig.tools/stellar/inbox'),
    'https://multisig.tools/stellar/new/import',
  );
});


test('query-safe Stellar href keeps search parameters out of the pathname', () => {
  const href = stellarHrefWithSearchForLocation(
    '/receipt',
    'https://stellar.multisig.tools/activity?old=1',
    { request: 'ABCD1234', account: 'GTEST', network: 'testnet' },
  );
  assert.equal(href, 'https://stellar.multisig.tools/receipt?request=ABCD1234&account=GTEST&network=testnet');
  assert.equal(href.includes('%3F'), false);
});
