import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyRequestLocalEffects,
  clearRequestLocalEffects,
  loadRequestLocalEffects,
  saveRequestLocalEffects,
} from './requestLocalEffects.js';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
}

test('request-local post-submit effects round-trip by Request id', () => {
  const storage = memoryStorage();
  saveRequestLocalEffects(storage, 'REQ1', {
    adoptTreasury: {
      accountId: 'GTREASURY',
      walletAddress: 'GWALLET',
      network: 'testnet',
    },
  });
  assert.deepEqual(loadRequestLocalEffects(storage, 'REQ1'), {
    adoptTreasury: {
      accountId: 'GTREASURY',
      walletAddress: 'GWALLET',
      network: 'testnet',
    },
  });
  assert.equal(loadRequestLocalEffects(storage, 'REQ2'), null);
});

test('request-local effects fail closed and clear explicitly', () => {
  const storage = memoryStorage();
  storage.setItem('multisig-tools.stellar.request-local-effects.v1.REQ1', '{bad json');
  assert.equal(loadRequestLocalEffects(storage, 'REQ1'), null);
  saveRequestLocalEffects(storage, 'REQ1', {
    adoptTreasury: { accountId: '', walletAddress: 'GWALLET', network: 'public' },
  });
  assert.equal(loadRequestLocalEffects(storage, 'REQ1'), null);
  saveRequestLocalEffects(storage, 'REQ1', {
    adoptTreasury: { accountId: 'GTREASURY', walletAddress: 'GWALLET', network: 'public' },
  });
  clearRequestLocalEffects(storage, 'REQ1');
  assert.equal(loadRequestLocalEffects(storage, 'REQ1'), null);
});


test('submitted Request effects own Treasury adoption and clear only after persistence succeeds', () => {
  const effects = memoryStorage();
  const preferences = memoryStorage();
  saveRequestLocalEffects(effects, 'REQ1', {
    adoptTreasury: {
      accountId: 'GTREASURY',
      walletAddress: 'GWALLET',
      network: 'testnet',
    },
  });
  assert.equal(applyRequestLocalEffects(effects, preferences, 'REQ1', 'testnet'), true);
  assert.equal(loadRequestLocalEffects(effects, 'REQ1'), null);
  assert.deepEqual(
    JSON.parse(preferences.getItem('multisig-tools.stellar.treasuries.v1:testnet:GWALLET') ?? '[]'),
    ['GTREASURY'],
  );
});

test('failed local preference persistence does not consume a submitted Request effect', () => {
  const effects = memoryStorage();
  saveRequestLocalEffects(effects, 'REQ1', {
    adoptTreasury: {
      accountId: 'GTREASURY',
      walletAddress: 'GWALLET',
      network: 'public',
    },
  });
  const failingPreferences = {
    getItem(_key: string) { return null; },
    setItem(_key: string, _value: string) { throw new Error('storage unavailable'); },
  };
  assert.equal(applyRequestLocalEffects(effects, failingPreferences, 'REQ1', 'public'), false);
  assert.ok(loadRequestLocalEffects(effects, 'REQ1')?.adoptTreasury);
});
