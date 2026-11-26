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
  assert.equal(wrongMethod.headers.get('allow'), 'GET, HEAD, OPTIONS');
});


test('Node HTTP adapter exposes the Human email provider webhook route', async () => {
  const response = await dispatchStellarHttpRequest(new Request(
    'https://api-testnet.multisig.tools/stellar/human-email-events',
    { method: 'POST', body: '{}' },
  ));
  assert.notEqual(response.status, 404);
  assert.notEqual(response.status, 405);
});

test('Node HTTP adapter exposes reusable templates through the Stellar namespace', async () => {
  const response = await dispatchStellarHttpRequest(new Request('https://api-testnet.multisig.tools/stellar/templates?network=testnet'));
  assert.notEqual(response.status, 404);
  assert.notEqual(response.status, 405);
});


test('public discovery supports HEAD, validators and gzip without exposing private data', async () => {
  const url = 'http://localhost/stellar/openapi.json';
  const first = await dispatchStellarHttpRequest(new Request(url));
  assert.equal(first.status, 200);
  assert.match(first.headers.get('cache-control') ?? '', /public/);
  assert.ok(first.headers.get('etag'));
  assert.match(first.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/);
  const conditional = await dispatchStellarHttpRequest(new Request(url, { headers: { 'If-None-Match': first.headers.get('etag')! } }));
  assert.equal(conditional.status, 304);
  assert.equal(conditional.body, null);
  const head = await dispatchStellarHttpRequest(new Request(url, { method: 'HEAD' }));
  assert.equal(head.status, 200);
  assert.equal(head.body, null);
  assert.equal(head.headers.get('etag'), first.headers.get('etag'));
  const gzip = await dispatchStellarHttpRequest(new Request(url, { headers: { 'Accept-Encoding': 'gzip' } }));
  assert.equal(gzip.headers.get('content-encoding'), 'gzip');
  const { gunzipSync } = await import('node:zlib');
  assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(await gzip.arrayBuffer())).toString()), await first.json());
});

test('HEAD does not invoke private GET reconciliation or authentication', async () => {
  for (const path of ['/stellar/request?view=reconciliation', '/stellar/intent', '/stellar/auth']) {
    const response = await dispatchStellarHttpRequest(new Request('http://localhost'+path, { method: 'HEAD' }));
    assert.equal(response.status, 405);
    assert.equal(response.body, null);
  }
});
