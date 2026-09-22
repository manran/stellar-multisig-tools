import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Vercel deployment exposes one Queue consumer and an hourly outbox sweep', () => {
  const config = JSON.parse(
    readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8'),
  ) as {
    functions?: Record<string, { experimentalTriggers?: Array<Record<string, unknown>> }>;
    crons?: Array<{ path?: string; schedule?: string }>;
  };

  assert.deepEqual(
    config.functions?.['api/integration-webhook-dispatch.ts']?.experimentalTriggers,
    [{
      type: 'queue/v2beta',
      topic: 'mst-stellar-integration-webhooks',
      retryAfterSeconds: 180,
      initialDelaySeconds: 0,
    }],
  );
  assert.deepEqual(config.crons, [{
    path: '/api/integration-webhook-sweep',
    schedule: '0 * * * *',
  }]);

  const dispatch = readFileSync(
    new URL('../../../../../api/integration-webhook-dispatch.ts', import.meta.url),
    'utf8',
  );
  const sweep = readFileSync(
    new URL('../../../../../api/integration-webhook-sweep.ts', import.meta.url),
    'utf8',
  );
  assert.match(dispatch, /vercelIntegrationWebhookQueueHandler as POST/);
  assert.match(sweep, /vercelIntegrationWebhookSweepHandler as GET/);
});
