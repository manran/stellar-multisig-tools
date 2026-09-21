import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Keypair } from '@stellar/stellar-sdk/base';
import { GET } from '../routes/integration-execution.js';
import { createIntegrationApiKey } from './integrationCredentialService.js';

const MASTER = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const previous = {
  credentials: process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON,
  admin: process.env.MULTISIG_INTEGRATION_ADMIN_SECRET_HASH,
  master: process.env.MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET,
  deployment: process.env.VITE_STELLAR_DEPLOYMENT_NETWORK,
};
const { apiKey, secretHash } = createIntegrationApiKey('execution-test');

before(() => {
  delete process.env.MULTISIG_INTEGRATION_ADMIN_SECRET_HASH;
  process.env.MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET = MASTER;
  process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = 'testnet';
  process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON = JSON.stringify([{
    serviceId: 'execution-test',
    label: 'Execution Test',
    secretHash,
    networks: ['testnet'],
    classicSourceAccounts: [Keypair.random().publicKey()],
    classicExternalExecutionSourceAccounts: [],
    sorobanContracts: [],
    sorobanExecutionAccounts: [],
  }]);
});

after(() => {
  if (previous.credentials === undefined) delete process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON;
  else process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON = previous.credentials;
  if (previous.admin === undefined) delete process.env.MULTISIG_INTEGRATION_ADMIN_SECRET_HASH;
  else process.env.MULTISIG_INTEGRATION_ADMIN_SECRET_HASH = previous.admin;
  if (previous.master === undefined) delete process.env.MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET;
  else process.env.MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET = previous.master;
  if (previous.deployment === undefined) delete process.env.VITE_STELLAR_DEPLOYMENT_NETWORK;
  else process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = previous.deployment;
});

test('Integration execution inspection requires msi and returns only public managed Classic identities', async () => {
  const unauthorized = await GET(new Request('https://example.test/api/integration-execution?network=testnet'));
  assert.equal(unauthorized.status, 401);

  const response = await GET(new Request(
    'https://example.test/api/integration-execution?network=testnet',
    { headers: { Authorization: `Bearer ${apiKey}` } },
  ));
  assert.equal(response.status, 200);
  const body = await response.json() as {
    operation: string;
    version: number;
    serviceId: string;
    network: string;
    classic: {
      scopeConfigured: boolean;
      managedAvailable: boolean;
      managedSourceAccountCount: number;
      externalSourceAccountCount: number;
      channelCount: number;
      elasticChannelLimit: number;
      channelAccounts: string[];
    };
  };
  assert.equal(body.operation, 'integration.execution.inspect');
  assert.equal(body.version, 1);
  assert.equal(body.serviceId, 'execution-test');
  assert.equal(body.network, 'testnet');
  assert.equal(body.classic.scopeConfigured, true);
  assert.equal(body.classic.managedAvailable, true);
  assert.equal(body.classic.managedSourceAccountCount, 1);
  assert.equal(body.classic.externalSourceAccountCount, 0);
  assert.equal(body.classic.channelCount, 4);
  assert.equal(body.classic.elasticChannelLimit, 64);
  assert.equal(body.classic.channelAccounts.length, 4);
  assert.equal(JSON.stringify(body).includes(MASTER), false);
  for (const address of body.classic.channelAccounts) assert.match(address, /^G[A-Z2-7]{55}$/);
});
