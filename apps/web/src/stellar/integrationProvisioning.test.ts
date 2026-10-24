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
    executorPool: [],
    authorizationExperience: 'hosted',
  });
  assert.equal(result.serviceId, 'fednetwork');
  assert.equal(result.label, 'Fed Network');
  assert.deepEqual(result.classicSourceAccounts, ['GA', 'GB']);
  assert.deepEqual(result.classicExternalExecutionSourceAccounts, ['GB']);
  assert.deepEqual(result.profile, { authorizationExperience: 'hosted' });
});

test('provisioning keeps one global executor pool and binds each contract to a pool member', () => {
  const result = buildIntegrationAdminConfiguration({
    serviceId: 'fednetwork',
    label: 'FedNetwork',
    network: 'testnet',
    treasuries: [],
    contracts: [
      { contractId: 'C1', methods: ['transfer', 'transfer', ' claim '], executionOwner: 'integration', executor: ' GEXEC ' },
      { contractId: 'C2', methods: [], executionOwner: 'multisigtools' },
    ],
    executorPool: [' GEXEC ', 'GSECOND', 'GEXEC'],
    authorizationExperience: 'native',
    webhook: { url: ' https://fed.network/webhooks/mst ', enabled: true },
  });
  assert.deepEqual(result.sorobanContracts, [{
    contractId: 'C1',
    methods: ['transfer', 'claim'],
    execution: { mode: 'external', executor: 'GEXEC' },
  }]);
  assert.deepEqual(result.sorobanExecutionAccounts, ['GEXEC', 'GSECOND']);
  assert.equal(result.sorobanDefaultExecutor, undefined);
  assert.deepEqual(result.profile, { authorizationExperience: 'native' });
  assert.deepEqual(result.webhook, { url: 'https://fed.network/webhooks/mst', enabled: true });
});

test('provisioning does not leak an executor into MST-managed Soroban execution', () => {
  const result = buildIntegrationAdminConfiguration({
    serviceId: 'fednetwork',
    label: 'FedNetwork',
    network: 'public',
    treasuries: [],
    contracts: [{ contractId: 'C1', methods: ['transfer'], executionOwner: 'multisigtools', executor: 'GIGNORED' }],
    executorPool: ['GIGNORED'],
    authorizationExperience: 'headless',
  });
  assert.deepEqual(result.sorobanContracts, [{
    contractId: 'C1', methods: ['transfer'], execution: { mode: 'multisigtools' },
  }]);
  assert.deepEqual(result.sorobanExecutionAccounts, ['GIGNORED']);
  assert.equal(result.sorobanDefaultExecutor, undefined);
  assert.deepEqual(result.networks, ['public']);
});
