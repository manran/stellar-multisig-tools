import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk/base';
import { POST } from '../routes/integration-testnet.js';

const previousNetwork = process.env.VITE_STELLAR_DEPLOYMENT_NETWORK;
const executorEnv = 'STELLAR_SOROBAN_MANAGED_EXECUTOR_TESTNET';
const previousExecutor = process.env[executorEnv];

test.afterEach(() => {
  if (previousNetwork === undefined) delete process.env.VITE_STELLAR_DEPLOYMENT_NETWORK;
  else process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = previousNetwork;
  if (previousExecutor === undefined) delete process.env[executorEnv];
  else process.env[executorEnv] = previousExecutor;
});

test('Testnet Integration self-service is unavailable on fixed Mainnet deployment', async () => {
  process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = 'public';
  const response = await POST(new Request('https://stellar.multisig.tools/api/integration-testnet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: 'Testnet Integration self-service is available only on the fixed Testnet deployment.',
    code: 'testnet_integration_self_service_unavailable',
  });
});

test('invalid service ids fail at the HTTP boundary without reaching credential storage', async () => {
  process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = 'testnet';
  for (const serviceId of ['Bad_ID', '-leading', 'a'.repeat(41), 'has space', 'UPPER', 'leading-space ', 'trailing-newline\n']) {
    const response = await POST(new Request('https://api-testnet.multisig.tools/stellar/integration-testnet', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId, label: 'x', classicSourceAccounts: [Keypair.random().publicKey()] }),
    }));
    assert.equal(response.status, 400, serviceId);
    assert.equal((await response.json()).code, 'invalid_integration_service_id');
  }
});

test('Testnet Integration self-service does not require an operator credential', async () => {
  process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = 'testnet';
  const response = await POST(new Request('https://stellar-testnet.multisig.tools/api/integration-testnet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }));
  assert.equal(response.status, 400);
  const body = await response.json() as { code: string };
  assert.equal(body.code, 'integration_service_id_required');
});
