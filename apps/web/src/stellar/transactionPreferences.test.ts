import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_TRANSACTION_LIFETIME_SECONDS,
  getDefaultTransactionLifetime,
  setDefaultTransactionLifetime,
  transactionLifetimeLabel,
} from '../../../../packages/stellar-core/src/transactionPreferences.js';

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
  };
}

test('defaults transaction lifetime to 24 hours', () => {
  assert.equal(getDefaultTransactionLifetime(memoryStorage()), DEFAULT_TRANSACTION_LIFETIME_SECONDS);
});

test('persists only supported transaction lifetime presets', () => {
  const storage = memoryStorage();
  setDefaultTransactionLifetime(storage, 60 * 60);
  assert.equal(getDefaultTransactionLifetime(storage), 60 * 60);
  assert.throws(() => setDefaultTransactionLifetime(storage, 123), /Unsupported/);
});

test('renders stable lifetime labels', () => {
  assert.equal(transactionLifetimeLabel(24 * 60 * 60), '24 hours');
});
