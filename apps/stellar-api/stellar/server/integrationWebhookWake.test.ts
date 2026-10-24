import assert from 'node:assert/strict';
import test from 'node:test';
import {
  publishIntegrationWebhookWakeBatch,
  type IntegrationWebhookWakePublisher,
} from './integrationWebhookWake.js';

test('platform-neutral webhook wake publisher isolates scheduler failures from outbox authority', async () => {
  const seen: string[] = [];
  const publisher: IntegrationWebhookWakePublisher = {
    async publish(eventId) {
      seen.push(eventId);
      if (eventId === 'evt-2') throw new Error('queue unavailable');
    },
  };
  const result = await publishIntegrationWebhookWakeBatch(['evt-1', 'evt-2', 'evt-3'], publisher);
  assert.deepEqual(seen, ['evt-1', 'evt-2', 'evt-3']);
  assert.deepEqual(result.published, ['evt-1', 'evt-3']);
  assert.deepEqual(result.failed.map((item) => item.eventId), ['evt-2']);
});
