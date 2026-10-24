import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchStellarHttpRequest } from '../platform/node/httpAdapter.js';

test('node adapter exposes protocol discovery without changing the public namespace', async () => {
  const response = await dispatchStellarHttpRequest(new Request('http://localhost/'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    service: 'MultiSig Tools API',
    protocols: {
      stellar: {
        base: '/stellar',
        openapi: '/stellar/openapi.json',
      },
    },
  });
});

test('node adapter exposes a private health endpoint', async () => {
  const response = await dispatchStellarHttpRequest(new Request('http://localhost/healthz'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('node adapter maps /stellar/runtime-config to the existing route handler', async () => {
  const previousNetwork = process.env.VITE_STELLAR_DEPLOYMENT_NETWORK;
  const previousManaged = process.env.MULTISIG_CLASSIC_MANAGED_EXECUTION_ENABLED;
  const previousMaster = process.env.MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET;
  process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = 'testnet';
  process.env.MULTISIG_CLASSIC_MANAGED_EXECUTION_ENABLED = 'false';
  delete process.env.MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET;
  try {
    const response = await dispatchStellarHttpRequest(
      new Request('http://localhost/stellar/runtime-config'),
    );
    assert.equal(response.status, 200);
    const body = await response.json() as {
      fixedNetwork: string | null;
      capabilities: { classicManagedExecution: { testnet: boolean; public: boolean } };
    };
    assert.equal(body.fixedNetwork, 'testnet');
    assert.equal(body.capabilities.classicManagedExecution.testnet, false);
    assert.equal(body.capabilities.classicManagedExecution.public, false);
  } finally {
    if (previousNetwork === undefined) delete process.env.VITE_STELLAR_DEPLOYMENT_NETWORK;
    else process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = previousNetwork;
    if (previousManaged === undefined) delete process.env.MULTISIG_CLASSIC_MANAGED_EXECUTION_ENABLED;
    else process.env.MULTISIG_CLASSIC_MANAGED_EXECUTION_ENABLED = previousManaged;
    if (previousMaster === undefined) delete process.env.MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET;
    else process.env.MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET = previousMaster;
  }
});

test('node adapter rejects unknown paths and unsupported methods', async () => {
  const missing = await dispatchStellarHttpRequest(new Request('http://localhost/stellar/missing'));
  assert.equal(missing.status, 404);

  const wrongMethod = await dispatchStellarHttpRequest(
    new Request('http://localhost/stellar/runtime-config', { method: 'POST' }),
  );
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'GET, OPTIONS');
});
