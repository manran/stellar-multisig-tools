import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { GET } from '../routes/integration-admin.js';
import { createIntegrationAdminSecret } from './integrationAdminService.js';

const MASTER = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const previous = {
  admin: process.env.MULTISIG_INTEGRATION_ADMIN_SECRET_HASH,
  master: process.env.MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET,
  deployment: process.env.VITE_STELLAR_DEPLOYMENT_NETWORK,
};
const { adminSecret, secretHash } = createIntegrationAdminSecret();

before(() => {
  process.env.MULTISIG_INTEGRATION_ADMIN_SECRET_HASH = secretHash;
  process.env.MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET = MASTER;
  process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = 'testnet';
});

after(() => {
  if (previous.admin === undefined) delete process.env.MULTISIG_INTEGRATION_ADMIN_SECRET_HASH;
  else process.env.MULTISIG_INTEGRATION_ADMIN_SECRET_HASH = previous.admin;
  if (previous.master === undefined) delete process.env.MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET;
  else process.env.MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET = previous.master;
  if (previous.deployment === undefined) delete process.env.VITE_STELLAR_DEPLOYMENT_NETWORK;
  else process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = previous.deployment;
});

test('managed Classic channel status is operator-only and exposes public identities only', async () => {
  const unauthorized = await GET(new Request(
    'https://example.test/api/integration-admin?view=managed_classic_execution&network=testnet',
  ));
  assert.equal(unauthorized.status, 401);

  const response = await GET(new Request(
    'https://example.test/api/integration-admin?view=managed_classic_execution&network=testnet',
    { headers: { Authorization: `Bearer ${adminSecret}` } },
  ));
  assert.equal(response.status, 200);
  const body = await response.json() as {
    managedClassicExecution: {
      network: string;
      configured: boolean;
      channelAccounts: string[];
    };
  };
  assert.equal(body.managedClassicExecution.network, 'testnet');
  assert.equal(body.managedClassicExecution.configured, true);
  assert.equal(body.managedClassicExecution.channelAccounts.length, 4);
  assert.equal(new Set(body.managedClassicExecution.channelAccounts).size, 4);
  assert.equal(JSON.stringify(body).includes(MASTER), false);
  for (const address of body.managedClassicExecution.channelAccounts) {
    assert.match(address, /^G[A-Z2-7]{55}$/);
  }
});

test('managed Classic status obeys the fixed deployment network', async () => {
  const response = await GET(new Request(
    'https://example.test/api/integration-admin?view=managed_classic_execution&network=public',
    { headers: { Authorization: `Bearer ${adminSecret}` } },
  ));
  assert.equal(response.status, 409);
  const body = await response.json() as { code: string };
  assert.equal(body.code, 'deployment_network_mismatch');
});
