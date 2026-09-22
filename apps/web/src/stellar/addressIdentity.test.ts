import assert from 'node:assert/strict';
import test from 'node:test';
import { preferredAddressLabel } from './addressIdentity.js';

const A = 'G'.padEnd(56, 'A');
const B = 'G'.padEnd(56, 'B');

test('one G-address uses the newest personal name across account and signer roles', () => {
  const entries = [
    { address: A, label: 'Vendor', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' },
    { address: A, label: 'Alice', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z' },
    { address: B, label: 'Bob', createdAt: '2026-09-02T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z' },
  ];

  assert.equal(preferredAddressLabel(entries, A), 'Alice');
  assert.equal(preferredAddressLabel(entries, B), 'Bob');
  assert.equal(preferredAddressLabel(entries, 'G'.padEnd(56, 'C')), '');
});
