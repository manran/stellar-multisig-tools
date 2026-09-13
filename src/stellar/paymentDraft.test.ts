import assert from 'node:assert/strict';
import test from 'node:test';
import { clearPaymentDraft, loadPaymentDraft, paymentDraftStorageKey, savePaymentDraft } from './paymentDraft.js';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
}

const owner = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

test('payment drafts round-trip one or many recipients in one unified shape', () => {
  const storage = memoryStorage();
  const draft = {
    version: 3 as const,
    source: 'GSOURCE',
    recipients: [
      { destination: 'GDEST1', amount: '12.5', assetKey: 'native' },
      { destination: 'GDEST2', amount: '3', assetKey: 'credit:USDC:GISSUER' },
    ],
    memo: 'public invoice id',
    privateNote: 'internal approval context',
    addOnChainProof: false,
    signingWindowSeconds: 86400,
  };
  savePaymentDraft(storage, owner, 'public', draft);
  assert.deepEqual(loadPaymentDraft(storage, owner, 'public'), draft);
  assert.equal(loadPaymentDraft(storage, owner, 'testnet'), null);
  assert.notEqual(paymentDraftStorageKey(owner, 'public'), paymentDraftStorageKey(owner, 'testnet'));
});

test('v2 single-recipient drafts migrate into the first unified recipient row', () => {
  const storage = memoryStorage();
  const legacyKey = `multisig-tools.stellar.payment-draft.v2:public:${owner}`;
  storage.setItem(legacyKey, JSON.stringify({
    version: 2,
    source: 'GSOURCE',
    assetKey: 'native',
    destination: 'GDEST',
    amount: '12.5',
    memo: 'previous public memo',
    privateNote: 'previous private context',
    addOnChainProof: false,
    signingWindowSeconds: 86400,
  }));
  assert.deepEqual(loadPaymentDraft(storage, owner, 'public'), {
    version: 3,
    source: 'GSOURCE',
    recipients: [{ destination: 'GDEST', amount: '12.5', assetKey: 'native' }],
    memo: 'previous public memo',
    privateNote: 'previous private context',
    addOnChainProof: false,
    signingWindowSeconds: 86400,
  });
});

test('v1 mutually-exclusive context drafts migrate without losing entered text', () => {
  const storage = memoryStorage();
  const legacyKey = `multisig-tools.stellar.payment-draft.v1:public:${owner}`;
  storage.setItem(legacyKey, JSON.stringify({
    version: 1,
    source: 'GSOURCE',
    assetKey: 'native',
    destination: 'GDEST',
    amount: '12.5',
    contextMode: 'private',
    memo: 'previous public memo',
    privateMemo: 'previous private context',
    addOnChainProof: false,
    signingWindowSeconds: 86400,
  }));
  assert.deepEqual(loadPaymentDraft(storage, owner, 'public'), {
    version: 3,
    source: 'GSOURCE',
    recipients: [{ destination: 'GDEST', amount: '12.5', assetKey: 'native' }],
    memo: 'previous public memo',
    privateNote: 'previous private context',
    addOnChainProof: false,
    signingWindowSeconds: 86400,
  });
});

test('invalid or stale draft payloads fail closed', () => {
  const storage = memoryStorage();
  storage.setItem(paymentDraftStorageKey(owner, 'public'), JSON.stringify({ version: 3, signingWindowSeconds: 123 }));
  assert.equal(loadPaymentDraft(storage, owner, 'public'), null);
});

test('successful handoff clears current v3 and both legacy scoped payment drafts', () => {
  const storage = memoryStorage();
  savePaymentDraft(storage, owner, 'public', {
    version: 3,
    source: '', recipients: [{ destination: '', amount: '', assetKey: 'native' }], memo: '', privateNote: '', addOnChainProof: false, signingWindowSeconds: 86400,
  });
  storage.setItem(`multisig-tools.stellar.payment-draft.v2:public:${owner}`, JSON.stringify({ stale: true }));
  storage.setItem(`multisig-tools.stellar.payment-draft.v1:public:${owner}`, JSON.stringify({ stale: true }));
  clearPaymentDraft(storage, owner, 'public');
  assert.equal(loadPaymentDraft(storage, owner, 'public'), null);
});
