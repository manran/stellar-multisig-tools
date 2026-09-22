import assert from 'node:assert/strict';
import test from 'node:test';
import { takeReviewHandoff, writeReviewHandoff } from './reviewHandoff.js';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

class MemoryHistory {
  pathname = '/signing-room';
  state: unknown = { returnTo: '/new/payment' };
  replaceState(state: unknown) { this.state = state; }
}

test('review handoff round-trips transaction and optional workflow context', () => {
  const storage = new MemoryStorage();
  const commitment = { text: 'board approval', saltHex: 'ab'.repeat(32), hashHex: 'cd'.repeat(32) };
  writeReviewHandoff(storage, {
    xdr: '  AAAA  ',
    network: 'testnet',
    privateNote: ' internal note ',
    privateCommitment: commitment,
    createTreasuryAccountId: ' GABC ',
    accountSigningIntent: 'offline',
    sorobanEffectsBaseline: null,
    sorobanTransactionHash: null,
  });

  assert.deepEqual(takeReviewHandoff(storage, null), {
    xdr: 'AAAA',
    network: 'testnet',
    privateNote: 'internal note',
    privateCommitment: commitment,
    createTreasuryAccountId: 'GABC',
    accountSigningIntent: 'offline',
    sorobanEffectsBaseline: null,
    sorobanTransactionHash: null,
  });
});


test('review handoff binds Soroban effects to the exact transaction hash', () => {
  const storage = new MemoryStorage();
  const effects = {
    version: 1 as const,
    digest: 'effects-digest',
    structureDigest: 'structure-digest',
    stateChangeCount: 0,
    eventCount: 0,
    stateChanges: [],
    events: [],
    numericEffects: [{ key: 'quote', label: 'Quote', value: '100' }],
    truncated: false,
  };
  const transactionHash = 'ab'.repeat(32);
  writeReviewHandoff(storage, {
    xdr: 'SOROBAN',
    network: 'testnet',
    sorobanEffectsBaseline: effects,
    sorobanTransactionHash: transactionHash.toUpperCase(),
    sorobanIntentId: 'R'.repeat(16).toLowerCase(),
  });

  const handoff = takeReviewHandoff(storage, null);
  assert.deepEqual(handoff.sorobanEffectsBaseline, effects);
  assert.equal(handoff.sorobanTransactionHash, transactionHash);
  assert.equal(handoff.sorobanIntentId, 'R'.repeat(16));
});

test('writing a new handoff clears optional context from the previous workflow', () => {
  const storage = new MemoryStorage();
  writeReviewHandoff(storage, {
    xdr: 'FIRST',
    network: 'public',
    privateNote: 'private',
    privateCommitment: { text: 'private', saltHex: '11', hashHex: '22' },
    createTreasuryAccountId: 'GOLD',
    accountSigningIntent: 'standalone',
  });
  writeReviewHandoff(storage, { xdr: 'SECOND', network: 'testnet' });

  assert.deepEqual(takeReviewHandoff(storage, null), {
    xdr: 'SECOND',
    network: 'testnet',
    privateNote: null,
    privateCommitment: null,
    createTreasuryAccountId: null,
    accountSigningIntent: null,
    sorobanEffectsBaseline: null,
    sorobanTransactionHash: null,
  });
});

test('taking a handoff consumes every protocol field exactly once outside review history', () => {
  const storage = new MemoryStorage();
  writeReviewHandoff(storage, { xdr: 'AAAA', network: 'public', privateNote: 'note' });
  assert.equal(takeReviewHandoff(storage, null).xdr, 'AAAA');
  assert.deepEqual(takeReviewHandoff(storage, null), {
    xdr: '',
    network: null,
    privateNote: null,
    privateCommitment: null,
    createTreasuryAccountId: null,
    accountSigningIntent: null,
    sorobanEffectsBaseline: null,
    sorobanTransactionHash: null,
  });
});

test('signing-room history retains the consumed handoff for browser back and forward', () => {
  const storage = new MemoryStorage();
  const history = new MemoryHistory();
  writeReviewHandoff(storage, { xdr: 'AAAA', network: 'public', privateNote: 'note' });

  const first = takeReviewHandoff(storage, history);
  assert.equal(storage.getItem('multisig-tools.stellar.review-handoff.xdr'), null);
  assert.equal(first.xdr, 'AAAA');
  assert.deepEqual(takeReviewHandoff(storage, history), first);

  history.pathname = '/new/payment';
  assert.equal(takeReviewHandoff(storage, history).xdr, '');
});

test('malformed optional context fails closed and is still consumed', () => {
  const storage = new MemoryStorage();
  storage.setItem('multisig-tools.stellar.review-handoff.xdr', 'AAAA');
  storage.setItem('multisig-tools.stellar.review-handoff.network', 'future-network');
  storage.setItem('multisig-tools.stellar.private-commitment-handoff', '{bad json');
  storage.setItem('multisig-tools.stellar.private-note-handoff', ' note ');
  storage.setItem('multisig-tools.stellar.account-signing-intent-handoff', 'future-mode');

  assert.deepEqual(takeReviewHandoff(storage, null), {
    xdr: 'AAAA',
    network: null,
    privateNote: 'note',
    privateCommitment: null,
    createTreasuryAccountId: null,
    accountSigningIntent: null,
    sorobanEffectsBaseline: null,
    sorobanTransactionHash: null,
  });
  assert.equal(storage.getItem('multisig-tools.stellar.private-commitment-handoff'), null);
});

test('history handoff remains compatible when account signing intent predates the field', () => {
  const storage = new MemoryStorage();
  const history = new MemoryHistory();
  history.state = {
    __multisigToolsReviewHandoff: {
      xdr: 'OLD-XDR',
      network: 'public',
      privateNote: null,
      privateCommitment: null,
      createTreasuryAccountId: null,
    },
  };
  assert.equal(takeReviewHandoff(storage, history).accountSigningIntent, null);
});
