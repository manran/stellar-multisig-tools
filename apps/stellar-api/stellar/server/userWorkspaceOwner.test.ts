import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import {
  userWorkspaceOwner, isUserWorkspaceOwner,
  requestedUserNetwork, assertUserWorkspaceWriteOrigin, UserWorkspaceError,
} from './userWorkspaceOwner.js';
import { importLegacyAddressBook, listAddressAliases, upsertAddressAlias, deleteAddressAlias } from './addressBookService.js';
import type { AddressBookStore, StoredAddressAlias } from './addressBookStore.js';
import {
  importLegacyContractWorkspaces, keepContractWorkspace, listContractWorkspaces, forgetContractWorkspace,
} from './contractWorkspaceService.js';
import type { ContractWorkspacePrincipal, ContractWorkspaceStore, StoredContractWorkspace } from './contractWorkspaceStore.js';

const CONTRACT = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
const CONTRACT2 = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';

function addressBook(): AddressBookStore {
  const rows = new Map<string, StoredAddressAlias>();
  const imported = new Set<string>();
  const key = (o: string, t: string, a: string) => o + '/' + t + '/' + a;
  return {
    async list(o) { return [...rows.entries()].filter(([k]) => k.startsWith(o + '/')).map(([, v]) => v); },
    async get(o, t, a) { return rows.get(key(o, t, a)) ?? null; },
    async put(o, v) { rows.set(key(o, v.subjectType, v.address), v); },
    async delete(o, t, a) { rows.delete(key(o, t, a)); },
    async hasImportedWallet(o, wallet) { return imported.has(key(o, 'imported', wallet)); },
    async markImportedWallet(o, wallet) { imported.add(key(o, 'imported', wallet)); },
  };
}

function contracts(): ContractWorkspaceStore {
  const rows = new Map<string, StoredContractWorkspace>();
  const imported = new Set<string>();
  const key = (p: ContractWorkspacePrincipal, id: string) =>
    p.network + '/' + p.type + '/' + (p.type === 'user' ? p.userId : p.address) + '/' + id;
  return {
    async list(p) { const prefix = key(p, ''); return [...rows.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v); },
    async get(p, id) { return rows.get(key(p, id)) ?? null; },
    async put(p, v) { rows.set(key(p, v.contractId), v); },
    async delete(p, id) { rows.delete(key(p, id)); },
    async hasImportedWallet(p, wallet) { return imported.has(key(p, wallet)); },
    async markImportedWallet(p, wallet) { imported.add(key(p, wallet)); },
  };
}

test('walletless MST User owner is separate per account and network', async () => {
  const user = randomUUID();
  const other = randomUUID();
  const owner = userWorkspaceOwner('testnet', user);
  assert.ok(isUserWorkspaceOwner(owner));
  assert.notEqual(owner, userWorkspaceOwner('public', user));
  assert.notEqual(owner, userWorkspaceOwner('testnet', other));
  const store = addressBook();
  const contact = Keypair.random().publicKey();
  await upsertAddressAlias(store, owner, { address: contact, subjectType: 'signer', label: 'Alice', notificationEmail: 'alice@example.org' });
  assert.equal((await listAddressAliases(store, owner)).length, 1);
  assert.equal((await listAddressAliases(store, userWorkspaceOwner('public', user))).length, 0);
  assert.equal((await listAddressAliases(store, userWorkspaceOwner('testnet', other))).length, 0);
  await assert.rejects(() => listAddressAliases(store, 'user:bad:xyz'));
});

test('verified wallet legacy contact import copies once without overwriting or resurrecting deletes', async () => {
  const wallet = Keypair.random().publicKey();
  const user = userWorkspaceOwner('testnet', randomUUID());
  const second = userWorkspaceOwner('testnet', randomUUID());
  const contact = Keypair.random().publicKey();
  const store = addressBook();
  await upsertAddressAlias(store, wallet, { address: contact, subjectType: 'signer', label: 'Old wallet name' });
  await upsertAddressAlias(store, user, { address: contact, subjectType: 'signer', label: 'User name' });
  await importLegacyAddressBook(store, user, wallet);
  assert.equal((await listAddressAliases(store, user))[0].label, 'User name');
  await deleteAddressAlias(store, user, { address: contact, subjectType: 'signer' });
  await importLegacyAddressBook(store, user, wallet);
  assert.deepEqual(await listAddressAliases(store, user), []);
  assert.equal((await listAddressAliases(store, wallet)).length, 1);
  assert.deepEqual(await listAddressAliases(store, second), []);
});

test('legacy contract import preserves the original signer workspace', async () => {
  const wallet = Keypair.random().publicKey();
  const user: ContractWorkspacePrincipal = { type: 'user', network: 'testnet', userId: randomUUID() };
  const other: ContractWorkspacePrincipal = { type: 'user', network: 'testnet', userId: randomUUID() };
  const signer: ContractWorkspacePrincipal = { type: 'signer', network: 'testnet', address: wallet };
  const store = contracts();
  await keepContractWorkspace(store, signer, CONTRACT);
  await keepContractWorkspace(store, user, CONTRACT2);
  await importLegacyContractWorkspaces(store, user, wallet);
  assert.deepEqual(new Set((await listContractWorkspaces(store, user)).map(v => v.contractId)), new Set([CONTRACT, CONTRACT2]));
  await forgetContractWorkspace(store, user, CONTRACT);
  await importLegacyContractWorkspaces(store, user, wallet);
  assert.deepEqual((await listContractWorkspaces(store, user)).map(v => v.contractId), [CONTRACT2]);
  assert.deepEqual((await listContractWorkspaces(store, signer)).map(v => v.contractId), [CONTRACT]);
  assert.deepEqual(await listContractWorkspaces(store, other), []);
});

test('wrong origin is denied for user workspace changes and network is explicit', () => {
  const req = (url: string, origin?: string) => new Request(url, { headers: origin ? { origin } : {} });
  const network = process.env.VITE_STELLAR_DEPLOYMENT_NETWORK === 'testnet' ? 'testnet' : 'public';
  assert.equal(requestedUserNetwork(req('https://stellar-testnet.multisig.tools/api/contracts?network=' + network)), network);
  const other = network === 'testnet' ? 'public' : 'testnet';
  assert.throws(() => requestedUserNetwork(req('https://stellar-testnet.multisig.tools/api/contracts?network=' + network), { network: other }), UserWorkspaceError);
  assert.throws(() => userWorkspaceOwner('testnet', 'not-a-uuid'), UserWorkspaceError);
  assert.throws(() => assertUserWorkspaceWriteOrigin(req('https://stellar-testnet.multisig.tools/api/contracts', 'https://evil.example')), UserWorkspaceError);
});
