import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_UNLOCK_DURATION_SECONDS,
  getDefaultUnlockDuration,
  setDefaultUnlockDuration,
  unlockDurationLabel,
} from './unlockPreferences.js';

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
  };
}

test('defaults private workspace unlock duration to one hour', () => {
  assert.equal(getDefaultUnlockDuration(memoryStorage()), DEFAULT_UNLOCK_DURATION_SECONDS);
});

test('persists only supported private workspace unlock durations', () => {
  const storage = memoryStorage();
  setDefaultUnlockDuration(storage, 15 * 60);
  assert.equal(getDefaultUnlockDuration(storage), 15 * 60);
  setDefaultUnlockDuration(storage, 8 * 60 * 60);
  assert.equal(getDefaultUnlockDuration(storage), 8 * 60 * 60);
  assert.throws(() => setDefaultUnlockDuration(storage, 123), /Unsupported/);
});

test('renders stable unlock duration labels', () => {
  assert.equal(unlockDurationLabel(15 * 60), '15 minutes');
  assert.equal(unlockDurationLabel(60 * 60), '1 hour');
  assert.equal(unlockDurationLabel(8 * 60 * 60), '8 hours');
});
