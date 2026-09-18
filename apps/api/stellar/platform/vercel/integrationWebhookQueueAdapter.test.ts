import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createVercelIntegrationWebhookWakePublisher,
  InvalidVercelIntegrationWebhookWakeError,
  processVercelIntegrationWebhookWake,
  retryDelaySeconds,
  scheduleVercelIntegrationWebhookRetryWake,
  VERCEL_INTEGRATION_WEBHOOK_TOPIC,
  vercelIntegrationWebhookQueueRetry,
} from './integrationWebhookQueueAdapter.js';

test('Vercel Queue adapter carries only the outbox event id wake hint', async () => {
  const calls: Array<{ topic: string; payload: unknown; options: unknown }> = [];
  const publisher = createVercelIntegrationWebhookWakePublisher(
    async (topic, payload, options) => {
      calls.push({ topic, payload, options });
      return { messageId: 'q1' };
    },
  );
  await publisher.publish('evt-42');
  assert.equal(VERCEL_INTEGRATION_WEBHOOK_TOPIC, 'mst-stellar-integration-webhooks');
  assert.deepEqual(calls, [{
    topic: VERCEL_INTEGRATION_WEBHOOK_TOPIC,
    payload: { version: 1, eventId: 'evt-42' },
    options: { retentionSeconds: 604800 },
  }]);
});

test('delayed Queue retry timing is derived only from PostgreSQL nextAvailableAt', async () => {
  const calls: Array<{ options?: { delaySeconds?: number } }> = [];
  const now = new Date('2026-09-18T02:00:00Z');
  assert.equal(retryDelaySeconds('2026-09-18T02:10:00Z', now), 600);
  assert.equal(retryDelaySeconds('2026-09-18T01:59:59Z', now), 0);

  const scheduled = await scheduleVercelIntegrationWebhookRetryWake(
    'evt-42',
    '2026-09-18T02:10:00Z',
    async (_topic, _payload, options) => {
      calls.push({ options });
      return { messageId: 'retry' };
    },
    now,
  );
  assert.equal(scheduled, true);
  assert.equal(calls[0]?.options?.delaySeconds, 600);
});

test('consumer delegates to portable dispatcher and schedules only PG-authorized retries', async () => {
  const dispatches: string[] = [];
  const sends: Array<{ delay?: number }> = [];
  await processVercelIntegrationWebhookWake(
    { version: 1, eventId: 'evt-42' },
    async (eventId) => {
      dispatches.push(eventId);
      return {
        status: 'retry_scheduled',
        nextAvailableAt: new Date(Date.now() + 5000).toISOString(),
      };
    },
    async (_topic, _payload, options) => {
      sends.push({ delay: options?.delaySeconds });
      return { messageId: 'retry' };
    },
  );
  assert.deepEqual(dispatches, ['evt-42']);
  assert.equal(sends.length, 1);
});

test('poison Queue messages are acknowledged while infrastructure failures get a short transport retry', async () => {
  await assert.rejects(
    () => processVercelIntegrationWebhookWake(
      { version: 2, eventId: 'evt-42' },
      async () => ({ status: 'delivered' }),
    ),
    InvalidVercelIntegrationWebhookWakeError,
  );
  assert.deepEqual(
    vercelIntegrationWebhookQueueRetry(new InvalidVercelIntegrationWebhookWakeError()),
    { acknowledge: true },
  );
  assert.deepEqual(
    vercelIntegrationWebhookQueueRetry(new Error('dispatcher unavailable')),
    { afterSeconds: 180 },
  );
});
