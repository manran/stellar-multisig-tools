import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadAdoptedTreasuryAccountIds,
  loadTreasuryOnboardingDismissed,
  saveAdoptedTreasuryAccountIds,
  saveTreasuryOnboardingDismissed,
} from './treasuryPreferences.js';

const WALLET = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const TREASURY = 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCMZX';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
}

test('persists adopted Treasury workspace choices per wallet and network', () => {
  const storage = memoryStorage();

  saveAdoptedTreasuryAccountIds(storage, WALLET, 'testnet', [TREASURY, TREASURY]);
  assert.deepEqual(loadAdoptedTreasuryAccountIds(storage, WALLET, 'testnet'), [TREASURY]);
  assert.deepEqual(loadAdoptedTreasuryAccountIds(storage, WALLET, 'public'), []);
});

test('malformed Treasury workspace preference data fails closed', () => {
  const storage = memoryStorage();
  storage.setItem(`multisig-tools.stellar.treasuries.v1:public:${WALLET}`, '{bad');
  assert.deepEqual(loadAdoptedTreasuryAccountIds(storage, WALLET, 'public'), []);
});


test('persists Treasury onboarding dismissal per wallet and network', () => {
  const storage = memoryStorage();
  assert.equal(loadTreasuryOnboardingDismissed(storage, WALLET, 'public'), false);
  saveTreasuryOnboardingDismissed(storage, WALLET, 'public');
  assert.equal(loadTreasuryOnboardingDismissed(storage, WALLET, 'public'), true);
  assert.equal(loadTreasuryOnboardingDismissed(storage, WALLET, 'testnet'), false);
});
