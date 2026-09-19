import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIntegrationAdminConfiguration } from './integrationProvisioning.js';

test('provisioning maps Classic per-Treasury execution ownership into existing authority fields', () => {
  const result = buildIntegrationAdminConfiguration({
    serviceId: ' FedNetwork ',
    label: ' Fed Network ',
    network: 'testnet',
    treasuries: [
      { accountId: 'GA', executionOwner: 'multisigtools' },
      { accountId: 'GB', executionOwner: 'integration' },
    ],
    contracts: [],
    sorobanExecutionOwner: 'multisigtools',
    authorizationExperience: 'hosted',
  });
  assert.equal(result.serviceId, 'fednetwork');
  assert.equal(result.label, 'Fed Network');
  assert.deepEqual(result.classicSourceAccounts, ['GA', 'GB']);
  assert.deepEqual(result.classicExternalExecutionSourceAccounts, ['GB']);
  assert.deepEqual(result.profile, { authorizationExperience: 'hosted' });
});

test('provisioning keeps Soroban contract method allowlists explicit and external executor service-wide', () => {
  const result = buildIntegrationAdminConfiguration({
    serviceId: 'fednetwork',
    label: 'FedNetwork',
    network: 'testnet',
    treasuries: [],
    contracts: [
      { contractId: 'C1', methods: ['transfer', 'transfer', ' claim '] },
      { contractId: 'C2', methods: [] },
    ],
    sorobanExecutionOwner: 'integration',
    sorobanExecutor: ' GEXEC ',
    authorizationExperience: 'native',
    webhook: { url: ' https://fed.network/webhooks/mst ', enabled: true },
  });
  assert.deepEqual(result.sorobanContracts, [{ contractId: 'C1', methods: ['transfer', 'claim'] }]);
  assert.deepEqual(result.sorobanExecutionAccounts, ['GEXEC']);
  assert.equal(result.sorobanDefaultExecutor, 'GEXEC');
  assert.deepEqual(result.profile, { authorizationExperience: 'native' });
  assert.deepEqual(result.webhook, { url: 'https://fed.network/webhooks/mst', enabled: true });
});

test('provisioning does not leak an executor into MST-managed Soroban execution', () => {
  const result = buildIntegrationAdminConfiguration({
    serviceId: 'fednetwork',
    label: 'FedNetwork',
    network: 'public',
    treasuries: [],
    contracts: [{ contractId: 'C1', methods: ['transfer'] }],
    sorobanExecutionOwner: 'multisigtools',
    sorobanExecutor: 'GIGNORED',
    authorizationExperience: 'headless',
  });
  assert.deepEqual(result.sorobanExecutionAccounts, []);
  assert.equal(result.sorobanDefaultExecutor, undefined);
  assert.deepEqual(result.networks, ['public']);
});
