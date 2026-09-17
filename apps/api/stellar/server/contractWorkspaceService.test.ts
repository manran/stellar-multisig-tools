import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk/base';
import {
  ContractWorkspaceServiceError,
  forgetContractWorkspace,
  keepContractWorkspace,
  listContractWorkspaces,
} from './contractWorkspaceService.js';
import type { ContractWorkspaceStore, StoredContractWorkspace } from './contractWorkspaceStore.js';
import type { SignerPrincipalRef } from '../../../../src/stellar/agentAccessTypes.js';

const CONTRACT_A = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
const CONTRACT_B = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';

function memoryStore(): ContractWorkspaceStore {
  const values = new Map<string, StoredContractWorkspace>();
  const key = (principal: SignerPrincipalRef, contractId: string) =>
    `${principal.network}:${principal.address}:${contractId}`;
  return {
    async list(principal) {
      const prefix = `${principal.network}:${principal.address}:`;
      return [...values.entries()].filter(([entryKey]) => entryKey.startsWith(prefix)).map(([, entry]) => entry);
    },
    async get(principal, contractId) {
      return values.get(key(principal, contractId)) ?? null;
    },
    async put(principal, workspace) {
      values.set(key(principal, workspace.contractId), workspace);
    },
    async delete(principal, contractId) {
      values.delete(key(principal, contractId));
    },
  };
}

test('contract workspaces are signer-and-network scoped durable resources', async () => {
  const store = memoryStore();
  const address = Keypair.random().publicKey();
  const principal: SignerPrincipalRef = { type: 'signer', network: 'testnet', address };
  const otherNetwork: SignerPrincipalRef = { ...principal, network: 'public' };
  const otherSigner: SignerPrincipalRef = { ...principal, address: Keypair.random().publicKey() };

  await keepContractWorkspace(store, principal, CONTRACT_A, new Date('2026-09-12T01:00:00Z'));
  await keepContractWorkspace(store, otherNetwork, CONTRACT_B, new Date('2026-09-12T02:00:00Z'));
  await keepContractWorkspace(store, otherSigner, CONTRACT_B, new Date('2026-09-12T03:00:00Z'));

  assert.deepEqual((await listContractWorkspaces(store, principal)).map((entry) => entry.contractId), [CONTRACT_A]);
  assert.deepEqual((await listContractWorkspaces(store, otherNetwork)).map((entry) => entry.contractId), [CONTRACT_B]);
  assert.deepEqual((await listContractWorkspaces(store, otherSigner)).map((entry) => entry.contractId), [CONTRACT_B]);
});

test('upsert preserves creation time, orders recent work first, and delete is scoped', async () => {
  const store = memoryStore();
  const principal: SignerPrincipalRef = {
    type: 'signer',
    network: 'testnet',
    address: Keypair.random().publicKey(),
  };
  const first = await keepContractWorkspace(store, principal, CONTRACT_A, new Date('2026-09-12T01:00:00Z'));
  await keepContractWorkspace(store, principal, CONTRACT_B, new Date('2026-09-12T02:00:00Z'));
  const updated = await keepContractWorkspace(store, principal, CONTRACT_A, new Date('2026-09-12T03:00:00Z'));

  assert.equal(updated.createdAt, first.createdAt);
  assert.deepEqual((await listContractWorkspaces(store, principal)).map((entry) => entry.contractId), [CONTRACT_A, CONTRACT_B]);
  await forgetContractWorkspace(store, principal, CONTRACT_A);
  assert.deepEqual((await listContractWorkspaces(store, principal)).map((entry) => entry.contractId), [CONTRACT_B]);
});

test('invalid contract ids fail before storage mutation', async () => {
  const store = memoryStore();
  const principal: SignerPrincipalRef = {
    type: 'signer',
    network: 'public',
    address: Keypair.random().publicKey(),
  };
  await assert.rejects(
    () => keepContractWorkspace(store, principal, 'not-a-contract'),
    (cause: unknown) => cause instanceof ContractWorkspaceServiceError && cause.code === 'invalid_contract',
  );
});
