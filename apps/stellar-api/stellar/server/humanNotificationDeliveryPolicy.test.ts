import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyHumanNotificationHttpStatus,
  classifyHumanNotificationTransportFailure,
} from './humanNotificationDeliveryPolicy.js';

test('Human email retry policy is bounded', () => {
  const now = new Date('2026-10-30T12:00:00Z');
  assert.deepEqual(classifyHumanNotificationHttpStatus(200, 1, now), { outcome: 'succeeded' });
  assert.deepEqual(classifyHumanNotificationHttpStatus(400, 1, now), {
    outcome: 'permanent_failure',
    errorCode: 'http_400',
  });
  assert.deepEqual(classifyHumanNotificationHttpStatus(429, 1, now), {
    outcome: 'retry',
    errorCode: 'http_429',
    nextAvailableAt: new Date('2026-10-30T12:00:05Z'),
  });
  assert.deepEqual(classifyHumanNotificationHttpStatus(503, 8, now), {
    outcome: 'permanent_failure',
    errorCode: 'http_503_retry_exhausted',
  });
});

test('Human email transport failures use the same bounded schedule', () => {
  const now = new Date('2026-10-30T12:00:00Z');
  assert.deepEqual(classifyHumanNotificationTransportFailure('timeout', 2, now), {
    outcome: 'retry',
    errorCode: 'timeout',
    nextAvailableAt: new Date('2026-10-30T12:00:30Z'),
  });
});
