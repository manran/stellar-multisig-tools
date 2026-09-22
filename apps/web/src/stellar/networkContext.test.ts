import assert from 'node:assert/strict';
import test from 'node:test';
import {
  explicitNetworkFromSearch,
  resolveNetworklessWalletContext,
} from './networkContext.js';

process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = 'dual';

test('explicit URL context accepts only supported Stellar networks', () => {
  assert.equal(explicitNetworkFromSearch('?network=testnet'), 'testnet');
  assert.equal(explicitNetworkFromSearch('?network=public'), 'public');
  assert.equal(explicitNetworkFromSearch('?network=future'), null);
  assert.equal(explicitNetworkFromSearch(''), null);
});

test('explicit Human context outranks WalletKit application defaults for networkless hardware', () => {
  assert.equal(resolveNetworklessWalletContext('public', 'testnet'), 'testnet');
  assert.equal(resolveNetworklessWalletContext('testnet', 'public'), 'public');
});

test('networkless hardware uses its application context only when no explicit context exists', () => {
  assert.equal(resolveNetworklessWalletContext('testnet', null), 'testnet');
  assert.equal(resolveNetworklessWalletContext('public', null), 'public');
});
