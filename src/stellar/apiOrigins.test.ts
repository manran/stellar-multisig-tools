import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STELLAR_MAINNET_API_BASE,
  STELLAR_PUBLIC_DOCS_BASE,
  STELLAR_TESTNET_API_BASE,
  stellarApiBaseForDeployment,
} from './apiOrigins.js';

test('public API bases separate protocol namespace from deployment environment', () => {
  assert.equal(STELLAR_MAINNET_API_BASE, 'https://api.multisig.tools/stellar');
  assert.equal(STELLAR_TESTNET_API_BASE, 'https://api-testnet.multisig.tools/stellar');
  assert.equal(STELLAR_PUBLIC_DOCS_BASE, 'https://docs.multisig.tools/stellar');
  assert.equal(stellarApiBaseForDeployment('public'), STELLAR_MAINNET_API_BASE);
  assert.equal(stellarApiBaseForDeployment('testnet'), STELLAR_TESTNET_API_BASE);
  assert.equal(stellarApiBaseForDeployment('dual'), '/api');
});
