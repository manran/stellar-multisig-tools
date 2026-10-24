import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk/base';
import {
  AgentCredentialServiceError,
  authenticateAgentCredential,
  createSignerAgentCredential,
  requireAgentAccess,
  revokeSignerAgentCredential,
} from './agentCredentialService.js';
import type {
  AgentCredentialStore,
  StoredAgentIdempotencyClaim,
  StoredSignerAgentCredential,
} from './agentCredentialStore.js';
import type { SignerPrincipalRef } from '../../../../packages/stellar-core/src/agentAccessTypes.js';

class MemoryAgentStore implements AgentCredentialStore {
  credentials = new Map<string, StoredSignerAgentCredential>();
  claims = new Map<string, StoredAgentIdempotencyClaim>();
  async listCredentials(principal: SignerPrincipalRef) { return [...this.credentials.values()].filter((item) => JSON.stringify(item.principal) === JSON.stringify(principal)); }
  async getCredential(id: string) { return this.credentials.get(id) ?? null; }
  async putCredential(item: StoredSignerAgentCredential) { this.credentials.set(item.credentialId, item); }
  async touchCredential(id: string, usedAt: string) { const item = this.credentials.get(id); if (item) this.credentials.set(id, { ...item, lastUsedAt: usedAt }); }
  async claimIdempotency(claim: StoredAgentIdempotencyClaim) { const key = `${claim.credentialId}:${claim.idempotencyHash}`; const existing = this.claims.get(key); if (existing) return { claimed: false, claim: existing }; this.claims.set(key, claim); return { claimed: true, claim }; }
  async releaseIdempotency(claim: StoredAgentIdempotencyClaim) { this.claims.delete(`${claim.credentialId}:${claim.idempotencyHash}`); }
}

function principal(): SignerPrincipalRef {
  return { type: 'signer', network: 'testnet', address: Keypair.random().publicKey() };
}

test('Signer Agent credential belongs to a Principal and stores only a verifier hash', async () => {
  const store = new MemoryAgentStore();
  const owner = principal();
  const created = await createSignerAgentCredential(store, owner, 'My ChatGPT', 'write', owner.address);
  assert.match(created.apiKey, /^msa_/);
  assert.equal(created.credential.principal.address, owner.address);
  assert.equal(created.credential.access, 'write');
  const stored = await store.getCredential(created.credential.credentialId);
  assert.ok(stored);
  assert.notEqual(stored.secretHash, created.apiKey);
  assert.equal((await authenticateAgentCredential(store, created.apiKey)).credentialId, created.credential.credentialId);
});

test('Read Write Sign are cumulative capabilities', async () => {
  const store = new MemoryAgentStore();
  const owner = principal();
  const read = await createSignerAgentCredential(store, owner, 'Reader', 'read', owner.address);
  const write = await createSignerAgentCredential(store, owner, 'Writer', 'write', owner.address);
  const sign = await createSignerAgentCredential(store, owner, 'Signer agent', 'sign', owner.address);
  const readRecord = await authenticateAgentCredential(store, read.apiKey);
  const writeRecord = await authenticateAgentCredential(store, write.apiKey);
  const signRecord = await authenticateAgentCredential(store, sign.apiKey);
  assert.doesNotThrow(() => requireAgentAccess(readRecord, 'read'));
  assert.throws(() => requireAgentAccess(readRecord, 'write'), (cause: unknown) => cause instanceof AgentCredentialServiceError && cause.code === 'agent_access_denied');
  assert.doesNotThrow(() => requireAgentAccess(writeRecord, 'read'));
  assert.doesNotThrow(() => requireAgentAccess(writeRecord, 'write'));
  assert.throws(() => requireAgentAccess(writeRecord, 'sign'), (cause: unknown) => cause instanceof AgentCredentialServiceError && cause.code === 'agent_access_denied');
  assert.doesNotThrow(() => requireAgentAccess(signRecord, 'read'));
  assert.doesNotThrow(() => requireAgentAccess(signRecord, 'write'));
  assert.doesNotThrow(() => requireAgentAccess(signRecord, 'sign'));
});

test('revocation is scoped to the Signer Principal and fails authentication immediately', async () => {
  const store = new MemoryAgentStore();
  const owner = principal();
  const other = principal();
  const created = await createSignerAgentCredential(store, owner, 'My Agent', 'read', owner.address);
  await assert.rejects(() => revokeSignerAgentCredential(store, other, created.credential.credentialId, other.address), (cause: unknown) => cause instanceof AgentCredentialServiceError && cause.code === 'agent_credential_not_found');
  await revokeSignerAgentCredential(store, owner, created.credential.credentialId, owner.address);
  await assert.rejects(() => authenticateAgentCredential(store, created.apiKey), (cause: unknown) => cause instanceof AgentCredentialServiceError && cause.code === 'agent_credential_revoked');
});
