import assert from 'node:assert/strict';
import test from 'node:test';
import { POST as buildContractCall } from '../api/contract-call.js';
import { GET as inspectContractInterface } from '../api/contract-interface.js';
import { GET as inspectRuntimeConfig } from '../api/runtime-config.js';

const variable = 'VITE_STELLAR_DEPLOYMENT_NETWORK';
const original = process.env[variable];

test.afterEach(() => {
  if (original === undefined) delete process.env[variable];
  else process.env[variable] = original;
});

test('runtime config exposes the fixed Testnet deployment contract', async () => {
  process.env[variable] = 'testnet';
  const response = await inspectRuntimeConfig();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    operation: 'runtime.config.inspect',
    version: 1,
    stellarNetwork: 'testnet',
    fixedNetwork: 'testnet',
  });
});

test('public Headless operations reject Mainnet input on a Testnet deployment before upstream work', async () => {
  process.env[variable] = 'testnet';
  const callResponse = await buildContractCall(new Request('https://testnet.multisig.tools/api/contract-call', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ network: 'public' }),
  }));
  assert.equal(callResponse.status, 409);
  assert.equal((await callResponse.json()).code, 'deployment_network_mismatch');

  const inspectResponse = await inspectContractInterface(
    new Request('https://testnet.multisig.tools/api/contract-interface?network=public&contract=C'),
  );
  assert.equal(inspectResponse.status, 409);
  assert.equal((await inspectResponse.json()).code, 'deployment_network_mismatch');
});
