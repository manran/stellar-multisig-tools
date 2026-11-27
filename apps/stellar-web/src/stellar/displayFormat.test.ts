import test from 'node:test';
import assert from 'node:assert/strict';
import { displayAmount, displayDate, displayTimestamp, humanTimeParts, recentEventLabel, deadlineEstimate } from './displayFormat.js';

test('display amounts preserve every significant digit', () => {
  assert.equal(displayAmount('1.5000000'), '1.5');
  assert.equal(displayAmount('0.0000001'), '0.0000001');
  assert.equal(displayAmount('100000000000000.0000001'), '100,000,000,000,000.0000001');
  assert.equal(displayAmount('-1234.8900000'), '-1,234.89');
  assert.equal(displayAmount('0.0000000'), '0');
  assert.equal(displayAmount('unknown'), 'unknown');
});
test('display dates and timestamps explicitly use UTC', () => {
  assert.equal(displayTimestamp('2026-11-27T00:10:20+09:00'), '2026-11-26 15:10:20 UTC');
  assert.equal(displayDate('2026-11-27T00:10:20+09:00'), '2026-11-26 UTC');
  assert.equal(displayTimestamp('invalid'), 'Unknown time');
});

test('local time uses the offset at the event instant, including DST and date rollover', () => {
  const before = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Tokyo';
    assert.deepEqual(humanTimeParts('2026-11-26T16:10:20Z', 'local'), { text: '2026-11-27 01:10:20', zone: 'UTC+09:00', iso: '2026-11-26T16:10:20.000Z' });
    assert.equal(humanTimeParts('2026-11-26T16:10:20Z', 'local', true)?.text, '2026-11-27');
    assert.equal(humanTimeParts('2026-11-26T16:10:20Z', 'utc', true)?.text, '2026-11-26');
    process.env.TZ = 'America/New_York';
    assert.equal(humanTimeParts('2026-11-01T05:30:00Z', 'local')?.zone, 'UTC-04:00');
    assert.equal(humanTimeParts('2026-11-01T06:30:00Z', 'local')?.zone, 'UTC-05:00');
    process.env.TZ = 'Asia/Kolkata';
    assert.equal(humanTimeParts('2026-11-27T00:00:00Z', 'local')?.zone, 'UTC+05:30');
    assert.equal(humanTimeParts('invalid', 'local'), null);
    assert.equal(displayTimestamp('2026-11-27T00:00:00Z'), '2026-11-27 00:00:00 UTC');
  } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
});
test('relative times and estimated deadlines are bounded and never imply server expiry', () => {
  const now = Date.parse('2026-11-27T00:00:00Z');
  assert.equal(recentEventLabel(now - 1000, now), 'Just now');
  assert.equal(recentEventLabel(now - 300000, now), '5 mins ago');
  assert.equal(recentEventLabel(now - 86400000, now), null);
  assert.equal(recentEventLabel(now + 1000, now), null);
  assert.equal(recentEventLabel('invalid', now), null);
  assert.deepEqual(deadlineEstimate(now + 30000, now), { label: 'Less than 1 min left', urgent: true });
  assert.deepEqual(deadlineEstimate(now + 3600000, now), { label: 'About 1 hour left', urgent: true });
  assert.deepEqual(deadlineEstimate(now + 86400000, now), { label: 'About 24 hours left', urgent: false });
  assert.deepEqual(deadlineEstimate(now - 1000, now), { label: 'Check current status', urgent: true });
  assert.equal(deadlineEstimate('invalid', now), null);
});
