import test from 'node:test';
import assert from 'node:assert/strict';
import { displayAmount, displayDate, displayTimestamp } from './displayFormat.js';

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
