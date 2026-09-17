import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk';
import {
  AddressBookServiceError,
  deleteAddressAlias,
  listAddressAliases,
  upsertAddressAlias,
} from './addressBookService.js';
import type { AddressAliasSubjectType, AddressBookStore, StoredAddressAlias } from './addressBookStore.js';

function memoryStore(): AddressBookStore {
  const values = new Map<string, StoredAddressAlias>();
  const key = (owner: string, type: AddressAliasSubjectType, address: string) => `${owner}:${type}:${address}`;
  return {
    async list(owner) {
      return [...values.entries()].filter(([entryKey]) => entryKey.startsWith(`${owner}:`)).map(([, entry]) => entry);
    },
    async get(owner, type, address) {
      return values.get(key(owner, type, address)) ?? null;
    },
    async put(owner, entry) {
      values.set(key(owner, entry.subjectType, entry.address), entry);
    },
    async delete(owner, type, address) {
      values.delete(key(owner, type, address));
    },
  };
}

test('keeps account and signer names separate for the same Stellar address', async () => {
  const owner = Keypair.random().publicKey();
  const address = Keypair.random().publicKey();
  const store = memoryStore();

  await upsertAddressAlias(store, owner, { address, subjectType: 'account', label: 'Treasury' }, new Date('2026-08-29T12:00:00Z'));
  await upsertAddressAlias(store, owner, { address, subjectType: 'signer', label: 'Alice treasury key' }, new Date('2026-08-29T12:01:00Z'));

  const entries = await listAddressAliases(store, owner);
  assert.equal(entries.length, 2);
  assert.equal(entries.find((entry) => entry.subjectType === 'account')?.label, 'Treasury');
  assert.equal(entries.find((entry) => entry.subjectType === 'signer')?.label, 'Alice treasury key');
});

test('upsert trims names, preserves creation time, and delete is scoped', async () => {
  const owner = Keypair.random().publicKey();
  const otherOwner = Keypair.random().publicKey();
  const address = Keypair.random().publicKey();
  const store = memoryStore();

  const first = await upsertAddressAlias(store, owner, { address, subjectType: 'account', label: '  Main   Treasury  ' }, new Date('2026-08-29T12:00:00Z'));
  const updated = await upsertAddressAlias(store, owner, { address, subjectType: 'account', label: 'Treasury' }, new Date('2026-08-29T13:00:00Z'));
  await upsertAddressAlias(store, otherOwner, { address, subjectType: 'account', label: 'Other name' }, new Date('2026-08-29T12:00:00Z'));

  assert.equal(first.label, 'Main Treasury');
  assert.equal(updated.createdAt, first.createdAt);
  assert.notEqual(updated.updatedAt, first.updatedAt);

  await deleteAddressAlias(store, owner, { address, subjectType: 'account' });
  assert.equal((await listAddressAliases(store, owner)).length, 0);
  assert.equal((await listAddressAliases(store, otherOwner)).length, 1);
});

test('rejects invalid alias input', async () => {
  const owner = Keypair.random().publicKey();
  const address = Keypair.random().publicKey();
  const store = memoryStore();

  await assert.rejects(
    () => upsertAddressAlias(store, owner, { address, subjectType: 'person', label: 'Alice' }),
    (cause: unknown) => cause instanceof AddressBookServiceError && cause.code === 'invalid_subject_type',
  );
  await assert.rejects(
    () => upsertAddressAlias(store, owner, { address: 'not-a-key', subjectType: 'signer', label: 'Alice' }),
    (cause: unknown) => cause instanceof AddressBookServiceError && cause.code === 'invalid_address',
  );
  await assert.rejects(
    () => upsertAddressAlias(store, owner, { address, subjectType: 'signer', label: '   ' }),
    (cause: unknown) => cause instanceof AddressBookServiceError && cause.code === 'invalid_label',
  );
});
