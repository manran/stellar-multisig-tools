import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalStellarContentHref, canonicalStellarContentLocationForLocation, canonicalStellarPath, canonicalStellarRuntimeLocationForLocation, stellarHrefForLocation, stellarHrefWithSearchForLocation } from '../workspaceNavigation.js';

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
  assert.equal(
    stellarHrefForLocation('/contracts', 'https://stellar-testnet.multisig.tools/inbox'),
    'https://stellar-testnet.multisig.tools/contracts',
  );
});

test('stellar runtime hosts canonicalize legacy /stellar URLs at startup', () => {
  assert.equal(
    canonicalStellarRuntimeLocationForLocation('https://stellar-testnet.multisig.tools/stellar/contracts?from=old#saved'),
    'https://stellar-testnet.multisig.tools/contracts?from=old#saved',
  );
  assert.equal(
    canonicalStellarRuntimeLocationForLocation('https://stellar.multisig.tools/stellar/inbox'),
    'https://stellar.multisig.tools/inbox',
  );
  assert.equal(
    canonicalStellarRuntimeLocationForLocation('https://multisig.tools/stellar/contracts'),
    null,
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

test('canonical content always resolves to the Mainnet content origin', () => {
  assert.equal(
    canonicalStellarContentHref('/docs'),
    'https://stellar.multisig.tools/docs',
  );
  assert.equal(
    canonicalStellarContentLocationForLocation('https://stellar-testnet.multisig.tools/docs/automation?from=testnet#permissions'),
    'https://stellar.multisig.tools/docs/automation?from=testnet#permissions',
  );
  assert.equal(
    canonicalStellarContentLocationForLocation('https://multisig.tools/stellar/privacy'),
    'https://stellar.multisig.tools/privacy',
  );
});
