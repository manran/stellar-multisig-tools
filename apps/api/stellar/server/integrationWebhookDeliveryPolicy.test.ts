import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyIntegrationWebhookHttpStatus,
  classifyIntegrationWebhookTransportFailure,
} from './integrationWebhookDeliveryPolicy.js';

test('webhook HTTP retry policy is platform-independent and bounded', () => {
  const now = new Date('2026-09-18T02:00:00Z');
  assert.deepEqual(classifyIntegrationWebhookHttpStatus(204, 1, now), { outcome: 'succeeded' });
  assert.deepEqual(classifyIntegrationWebhookHttpStatus(400, 1, now), {
    outcome: 'permanent_failure',
    errorCode: 'http_400',
  });
  assert.deepEqual(classifyIntegrationWebhookHttpStatus(302, 1, now), {
    outcome: 'permanent_failure',
    errorCode: 'http_302',
  });
  assert.deepEqual(classifyIntegrationWebhookHttpStatus(429, 1, now), {
    outcome: 'retry',
    errorCode: 'http_429',
    nextAvailableAt: new Date('2026-09-18T02:00:05Z'),
  });
  assert.deepEqual(classifyIntegrationWebhookHttpStatus(503, 7, now), {
    outcome: 'retry',
    errorCode: 'http_503',
    nextAvailableAt: new Date('2026-09-18T14:00:00Z'),
  });
  assert.deepEqual(classifyIntegrationWebhookHttpStatus(503, 8, now), {
    outcome: 'permanent_failure',
    errorCode: 'http_503_retry_exhausted',
  });
});

test('transport failures use the same bounded PostgreSQL retry schedule', () => {
  const now = new Date('2026-09-18T02:00:00Z');
  assert.deepEqual(classifyIntegrationWebhookTransportFailure('timeout', 2, now), {
    outcome: 'retry',
    errorCode: 'timeout',
    nextAvailableAt: new Date('2026-09-18T02:00:30Z'),
  });
  assert.deepEqual(classifyIntegrationWebhookTransportFailure('network_econnreset', 8, now), {
    outcome: 'permanent_failure',
    errorCode: 'network_econnreset_retry_exhausted',
  });
});
