import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertDeploymentNetwork,
  configuredDeploymentNetwork,
  DeploymentNetworkPolicyError,
} from './deploymentNetworkPolicy.js';

test('missing deployment policy fails safe to Mainnet', () => {
  const environment = {} as NodeJS.ProcessEnv;
  assert.equal(configuredDeploymentNetwork(environment), 'public');
  assert.doesNotThrow(() => assertDeploymentNetwork('public', environment));
  assert.throws(() => assertDeploymentNetwork('testnet', environment), DeploymentNetworkPolicyError);
});

test('explicit dual policy remains available for local compatibility', () => {
  const environment = { VITE_STELLAR_DEPLOYMENT_NETWORK: 'dual' } as NodeJS.ProcessEnv;
  assert.doesNotThrow(() => assertDeploymentNetwork('public', environment));
  assert.doesNotThrow(() => assertDeploymentNetwork('testnet', environment));
});

test('fixed deployment accepts its own network and rejects the other network', () => {
  const environment = { VITE_STELLAR_DEPLOYMENT_NETWORK: 'testnet' } as NodeJS.ProcessEnv;
  assert.doesNotThrow(() => assertDeploymentNetwork('testnet', environment));
  assert.throws(
    () => assertDeploymentNetwork('public', environment),
    (error) => error instanceof DeploymentNetworkPolicyError
      && error.status === 409
      && error.code === 'deployment_network_mismatch',
  );
});

test('invalid deployment configuration fails closed', () => {
  const environment = { VITE_STELLAR_DEPLOYMENT_NETWORK: 'future' } as NodeJS.ProcessEnv;
  assert.throws(
    () => configuredDeploymentNetwork(environment),
    (error) => error instanceof DeploymentNetworkPolicyError
      && error.status === 500
      && error.code === 'invalid_deployment_network',
  );
});
