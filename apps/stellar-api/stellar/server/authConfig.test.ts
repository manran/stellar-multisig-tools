import assert from 'node:assert/strict';
import test from 'node:test';
import { authConfigForRequest } from './authConfig.js';

const deploymentNetwork = 'VITE_STELLAR_DEPLOYMENT_NETWORK';
const homeDomain = 'STELLAR_HOME_DOMAIN';
const originalNetwork = process.env[deploymentNetwork];
const originalHomeDomain = process.env[homeDomain];

test.afterEach(() => {
  if (originalNetwork === undefined) delete process.env[deploymentNetwork];
  else process.env[deploymentNetwork] = originalNetwork;
  if (originalHomeDomain === undefined) delete process.env[homeDomain];
  else process.env[homeDomain] = originalHomeDomain;
});

test('fixed Testnet auth identity follows the Human deployment, not the backend host', () => {
  process.env[deploymentNetwork] = 'testnet';
  process.env[homeDomain] = 'stellar-testnet.multisig.tools';
  const config = authConfigForRequest(new Request('https://internal-api.vercel.app/api/auth'));
  assert.deepEqual(config, {
    homeDomain: 'stellar-testnet.multisig.tools',
    webAuthDomain: 'stellar-testnet.multisig.tools',
    issuer: 'https://stellar-testnet.multisig.tools/api/auth',
  });
});

test('fixed Mainnet auth identity follows the Human deployment, not the backend host', () => {
  process.env[deploymentNetwork] = 'public';
  process.env[homeDomain] = 'stellar.multisig.tools';
  const config = authConfigForRequest(new Request('https://internal-api.vercel.app/api/auth'));
  assert.deepEqual(config, {
    homeDomain: 'stellar.multisig.tools',
    webAuthDomain: 'stellar.multisig.tools',
    issuer: 'https://stellar.multisig.tools/api/auth',
  });
});

test('dual/local compatibility still derives auth identity from the request origin', () => {
  process.env[deploymentNetwork] = 'dual';
  delete process.env[homeDomain];
  const config = authConfigForRequest(new Request('http://localhost:3000/api/auth'));
  assert.deepEqual(config, {
    homeDomain: 'stellar.multisig.tools',
    webAuthDomain: 'localhost:3000',
    issuer: 'http://localhost:3000/api/auth',
  });
});
