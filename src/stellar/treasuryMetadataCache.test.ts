import assert from 'node:assert/strict';
import test from 'node:test';
import { cacheTreasuryName, cachedTreasuryName, cachedTreasuryNames, loadSharedTreasuryNames } from '../treasuryMetadataCache.js';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test('Treasury name cache is network/account scoped and removable', () => {
  const storage = new MemoryStorage();
  const account = 'G' + 'A'.repeat(55);
  cacheTreasuryName(storage, 'public', account, 'Operations Treasury', 1000);
  assert.equal(cachedTreasuryName(storage, 'public', account), 'Operations Treasury');
  assert.equal(cachedTreasuryName(storage, 'testnet', account), '');
  assert.deepEqual(cachedTreasuryNames(storage, 'public', [account]), { [account]: 'Operations Treasury' });
  cacheTreasuryName(storage, 'public', account, null, 1000);
  assert.equal(cachedTreasuryName(storage, 'public', account), '');
});

test('Treasury metadata coalesces concurrent reads and negatively caches unnamed treasuries', async () => {
  const storage = new MemoryStorage();
  const account = 'G' + 'B'.repeat(55);
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fetchImpl = (async () => {
    calls += 1;
    await gate;
    return new Response(JSON.stringify({ metadataByAccount: { [account]: null } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const options = { fetchImpl, storage, origin: 'https://stellar.multisig.tools', now: () => 10_000 };
  const signer = 'G' + 'C'.repeat(55);
  const first = loadSharedTreasuryNames([account], 'public', signer, undefined, options);
  const second = loadSharedTreasuryNames([account], 'public', signer, undefined, options);
  release();
  assert.deepEqual(await first, {});
  assert.deepEqual(await second, {});
  assert.equal(calls, 1);
  assert.deepEqual(await loadSharedTreasuryNames([account], 'public', signer, undefined, options), {});
  assert.equal(calls, 1);
});
