import assert from 'node:assert/strict';
import test from 'node:test';
import { POST as buildContractCall } from '../routes/contract-call.js';
import { GET as inspectContractInterface } from '../routes/contract-interface.js';
import { GET as inspectRuntimeConfig } from '../routes/runtime-config.js';

const variable = 'VITE_STELLAR_DEPLOYMENT_NETWORK';
const original = process.env[variable];
const classicChannelsVariable = 'MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET';
const classicChannelPoolSizeVariable = 'MULTISIG_CLASSIC_CHANNEL_POOL_SIZE';
const originalClassicChannels = process.env[classicChannelsVariable];
const originalClassicChannelPoolSize = process.env[classicChannelPoolSizeVariable];

test.afterEach(() => {
  if (original === undefined) delete process.env[variable];
  else process.env[variable] = original;
  if (originalClassicChannels === undefined) delete process.env[classicChannelsVariable];
  else process.env[classicChannelsVariable] = originalClassicChannels;
  if (originalClassicChannelPoolSize === undefined) delete process.env[classicChannelPoolSizeVariable];
  else process.env[classicChannelPoolSizeVariable] = originalClassicChannelPoolSize;
});

test('runtime config exposes the fixed Testnet deployment contract', async () => {
  process.env[variable] = 'testnet';
  delete process.env[classicChannelsVariable];
  const response = await inspectRuntimeConfig();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    operation: 'runtime.config.inspect',
    version: 1,
    stellarNetwork: 'testnet',
    fixedNetwork: 'testnet',
    capabilities: {
      classicManagedExecution: { testnet: false, public: false },
    },
  });
});

test('runtime config exposes managed Classic capability without exposing channel secrets', async () => {
  process.env[variable] = 'testnet';
  process.env[classicChannelsVariable] = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env[classicChannelPoolSizeVariable] = '4';
  const response = await inspectRuntimeConfig();
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.deepEqual(body.capabilities, {
    classicManagedExecution: { testnet: true, public: false },
  });
  assert.doesNotMatch(JSON.stringify(body), /S[A-Z2-7]{55}/);
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
