import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveStellarNetwork } from './networkPreference.js';

process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = 'dual';

test('explicit page network wins over connected wallet network', () => {
  assert.equal(resolveStellarNetwork('public', 'testnet'), 'public');
  assert.equal(resolveStellarNetwork('testnet', 'public'), 'testnet');
});

test('connected wallet network is used when the page does not specify one', () => {
  assert.equal(resolveStellarNetwork(null, 'testnet'), 'testnet');
  assert.equal(resolveStellarNetwork(undefined, 'public'), 'public');
});

test('Mainnet is only the final fallback when no network context exists', () => {
  assert.equal(resolveStellarNetwork(null, null), 'public');
});
