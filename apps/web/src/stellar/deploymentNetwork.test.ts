import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  fixedStellarDeploymentNetwork,
  parseStellarDeploymentNetwork,
  resolveDeploymentNetwork,
} from '../../../../packages/stellar-core/src/deploymentNetwork.js';

test('deployment network policy defaults safely to Mainnet and keeps dual explicit', () => {
  assert.equal(parseStellarDeploymentNetwork(undefined), 'public');
  assert.equal(parseStellarDeploymentNetwork(''), 'public');
  assert.equal(parseStellarDeploymentNetwork('public'), 'public');
  assert.equal(parseStellarDeploymentNetwork('testnet'), 'testnet');
  assert.equal(parseStellarDeploymentNetwork('dual'), 'dual');
  assert.throws(() => parseStellarDeploymentNetwork('futurenet'), /must be public, testnet, or dual/);
});

test('fixed deployment network overrides URL and wallet context', () => {
  assert.equal(fixedStellarDeploymentNetwork('dual'), null);
  assert.equal(fixedStellarDeploymentNetwork('testnet'), 'testnet');
  assert.equal(resolveDeploymentNetwork('testnet', 'public', 'public'), 'testnet');
  assert.equal(resolveDeploymentNetwork('public', 'testnet', 'testnet'), 'public');
});

test('dual compatibility mode keeps the prior explicit-wallet-default order', () => {
  assert.equal(resolveDeploymentNetwork('dual', 'testnet', 'public'), 'testnet');
  assert.equal(resolveDeploymentNetwork('dual', null, 'testnet'), 'testnet');
  assert.equal(resolveDeploymentNetwork('dual', null, null), 'public');
});

test('client deployment policy keeps the direct Vite-replaceable environment access', () => {
  const source = readFileSync(new URL('../../../../packages/stellar-core/src/deploymentNetwork.ts', import.meta.url), 'utf8');
  assert.match(source, /import\.meta\.env\?\.VITE_STELLAR_DEPLOYMENT_NETWORK/);
  assert.doesNotMatch(source, /const metadata = import\.meta/);
});
