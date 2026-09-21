import assert from 'node:assert/strict';
import test from 'node:test';
import { POST } from '../routes/integration-testnet.js';

const previousNetwork = process.env.VITE_STELLAR_DEPLOYMENT_NETWORK;

test.afterEach(() => {
  if (previousNetwork === undefined) delete process.env.VITE_STELLAR_DEPLOYMENT_NETWORK;
  else process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = previousNetwork;
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
