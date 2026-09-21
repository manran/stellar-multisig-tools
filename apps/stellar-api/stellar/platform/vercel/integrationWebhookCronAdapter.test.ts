import assert from 'node:assert/strict';
import test from 'node:test';
import { vercelIntegrationWebhookSweepHandler } from './integrationWebhookCronAdapter.js';

function request(secret = 'cron-secret') {
  return new Request('https://stellar-testnet.multisig.tools/api/integration-webhook-sweep', {
    headers: { authorization: `Bearer ${secret}` },
  });
}

test('Cron adapter authenticates before touching storage or Queue', async () => {
  let touched = false;
  const response = await vercelIntegrationWebhookSweepHandler(request('wrong'), {
    cronSecret: 'cron-secret',
    storageMode: () => { touched = true; return 'postgres'; },
    sweep: async () => { touched = true; throw new Error('must not run'); },
  });
  assert.equal(response.status, 401);
  assert.equal(touched, false);
});

test('Cron adapter is inert while coordination storage remains Blob', async () => {
  let swept = false;
  const response = await vercelIntegrationWebhookSweepHandler(request(), {
    cronSecret: 'cron-secret',
    storageMode: () => 'blob',
    sweep: async () => { swept = true; throw new Error('must not run'); },
  });
  assert.deepEqual(await response.json(), { status: 'disabled', storage: 'blob' });
  assert.equal(swept, false);
});

test('Cron adapter exposes aggregate counts only', async () => {
  const response = await vercelIntegrationWebhookSweepHandler(request(), {
    cronSecret: 'cron-secret',
    storageMode: () => 'postgres',
    publisher: { async publish() {} },
    sweep: async () => ({
      scanned: 3,
      published: ['evt-a', 'evt-b'],
      failed: [{ eventId: 'evt-c', error: new Error('queue') }],
    }),
  });
  assert.deepEqual(await response.json(), {
    status: 'ok',
    scanned: 3,
    published: 2,
    failed: 1,
  });
});
