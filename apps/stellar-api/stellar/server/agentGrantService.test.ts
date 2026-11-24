import assert from 'node:assert/strict';
import test from 'node:test';
import { FeeBumpTransaction, Keypair, Networks, TransactionBuilder, hash } from '@stellar/stellar-sdk/base';

import {
  beginAgentGrant, inspectAgentGrant, agentApprovalMessage, approvalTransaction,
  verifyAgentApproval, decideAgentGrant, pollAgentGrant,
  type AgentGrantRequest, type AgentGrantDecision, type AgentGrantStore,
} from './agentGrantService.js';
import { authenticateAgentCredential } from './agentCredentialService.js';
import type { AgentCredentialStore, StoredAgentIdempotencyClaim, StoredSignerAgentCredential } from './agentCredentialStore.js';
import type { SignerPrincipalRef } from '../../../../packages/stellar-core/src/agentAccessTypes.js';
import { POST as legacyCreate } from '../routes/agent-access.js';

const domain = 'stellar-testnet.multisig.tools';
const signer = Keypair.random();
const other = Keypair.random();
const server = Keypair.random();
const principal: SignerPrincipalRef = { type: 'signer', network: 'testnet', address: signer.publicKey() };
const prefix = Buffer.from('Stellar Signed Message:\n', 'utf8');

class MemoryGrants implements AgentGrantStore {
  requests = new Map<string, AgentGrantRequest>();
  decisions = new Map<string, AgentGrantDecision>();
  claimed = new Set<string>();
  async create(record: AgentGrantRequest) { assert.ok(!this.requests.has(record.id)); this.requests.set(record.id, record); }
  async get(id: string) { return this.requests.get(id) ?? null; }
  async decision(id: string) { return this.decisions.get(id) ?? null; }
  async decide(id: string, d: AgentGrantDecision) {
    if (this.decisions.has(id)) return false;
    this.decisions.set(id, d); return true;
  }
  async claim(id: string) { if (this.claimed.has(id)) return false; this.claimed.add(id); return true; }
}

class MemoryCredentials implements AgentCredentialStore {
  items = new Map<string, StoredSignerAgentCredential>();
  async listCredentials(p: SignerPrincipalRef) { return [...this.items.values()].filter((x) => x.principal.address === p.address && x.principal.network === p.network); }
  async getCredential(id: string) { return this.items.get(id) ?? null; }
  async putCredential(item: StoredSignerAgentCredential) { this.items.set(item.credentialId, item); }
  async touchCredential() {}
  async claimIdempotency(_claim: StoredAgentIdempotencyClaim): Promise<{ claimed: boolean; claim: StoredAgentIdempotencyClaim }> { throw new Error('unused'); }
  async releaseIdempotency() {}
}

function sep53(message: string, key: Keypair) {
  return Buffer.from(key.sign(hash(Buffer.concat([prefix, Buffer.from(message)])))).toString('base64');
}
async function pending(access: 'read' | 'write' | 'sign' = 'read') {
  const store = new MemoryGrants();
  const created = await beginAgentGrant(store, 'My test Agent', access, 'testnet');
  const request = await inspectAgentGrant(store, created.requestId);
  return { store, created, request: request.grant };
}
function approval() {
  return { status: 'approved' as const, principal, decidedAt: new Date().toISOString() };
}

test('Agent authorization must use new wallet proof, not an existing login cookie', async () => {
  const response = await legacyCreate();
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'agent_approval_required');
});

test('Agent pairing request is scoped and random, and never returns credential before consent', async () => {
  const { store, created, request } = await pending('write');
  assert.match(created.deviceCode, /^mgd_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/);
  assert.match(created.verificationUri, /\/agent-access\?grant=[a-f0-9]{32}$/);
  assert.match(created.userCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(created.access, 'write');
  assert.equal(created.network, 'testnet');
  assert.equal(created.deviceCode.includes(signer.secret()), false);
  assert.equal(JSON.stringify(request).includes(created.deviceCode), false);
  const status = await pollAgentGrant(store, new MemoryCredentials(), created.deviceCode);
  assert.deepEqual(status, { status: 'authorization_pending' });
  await assert.rejects(
    () => pollAgentGrant(store, new MemoryCredentials(), created.deviceCode + 'x'),
    { code: 'invalid_device_code' },
  );
  await assert.rejects(
    () => beginAgentGrant(store, 'Unsafe', 'sign', 'public'),
    { code: 'testnet_only' },
  );
});

test('SEP-53 wallet consent binds agent label, permission, principal, request ID and domain', async () => {
  const { store, request } = await pending();
  const message = agentApprovalMessage(request, principal, domain);
  verifyAgentApproval(request, principal, domain, server, { mode: 'sep53', signature: sep53(message, signer) });
  assert.throws(() =>
    verifyAgentApproval(request, principal, domain, server, { mode: 'sep53', signature: sep53(message, other) }),
  { code: 'invalid_approval_signature' });
  const changed: AgentGrantRequest = { ...request, access: 'sign' };
  assert.throws(() =>
    verifyAgentApproval(changed, principal, domain, server, { mode: 'sep53', signature: sep53(message, signer) }),
  { code: 'invalid_approval_signature' });
  assert.throws(() =>
    verifyAgentApproval(request, principal, 'evil.example', server, { mode: 'sep53', signature: sep53(message, signer) }),
  { code: 'invalid_approval_signature' });
  assert.throws(() =>
    agentApprovalMessage(request, { ...principal, network: 'public' }, domain),
  { code: 'network_mismatch' });
  await decideAgentGrant(store, request.id, approval());
  await assert.rejects(() => decideAgentGrant(store, request.id, approval()), { code: 'grant_already_decided' });
});

test('Unsupported signMessage wallets can sign a zero-sequence, non-submittable approval XDR', async () => {
  const { request } = await pending('sign');
  const xdr = approvalTransaction(request, principal, domain, server);
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  assert.ok(!(tx instanceof FeeBumpTransaction));
  if (tx instanceof FeeBumpTransaction) throw new Error('Unexpected fee bump');
  assert.equal(tx.sequence, '0');
  tx.sign(signer);
  verifyAgentApproval(request, principal, domain, server, { mode: 'transaction', transaction: tx.toXDR() });
  const missing = approvalTransaction(request, principal, domain, server);
  assert.throws(() =>
    verifyAgentApproval(request, principal, domain, server, { mode: 'transaction', transaction: missing }),
  { code: 'invalid_approval_signature' });
  tx.sign(other);
  assert.throws(() =>
    verifyAgentApproval(request, principal, domain, server, { mode: 'transaction', transaction: tx.toXDR() }),
  { code: 'invalid_approval_signature' });
});

test('Only a one-time pairing secret receives an approved msa credential', async () => {
  const { store, created, request } = await pending('read');
  const credentials = new MemoryCredentials();
  await decideAgentGrant(store, request.id, approval());
  const response = await pollAgentGrant(store, credentials, created.deviceCode);
  assert.equal(response.status, 'approved');
  if (response.status !== 'approved') throw new Error('Expected approved');
  assert.match(response.apiKey, /^msa_/);
  assert.equal(response.credential.access, 'read');
  const stored = await credentials.getCredential(response.credential.credentialId);
  assert.ok(stored);
  assert.equal(JSON.stringify(stored).includes(response.apiKey), false);
  assert.equal((await authenticateAgentCredential(credentials, response.apiKey)).principal.address, principal.address);
  await assert.rejects(() => pollAgentGrant(store, credentials, created.deviceCode), { code: 'already_exchanged' });
  assert.equal(credentials.items.size, 1);
});

test('Denied or expired grants cannot be exchanged or approved', async () => {
  const { store, created, request } = await pending();
  await decideAgentGrant(store, request.id, { status: 'denied', decidedAt: new Date().toISOString() });
  assert.deepEqual(await pollAgentGrant(store, new MemoryCredentials(), created.deviceCode), { status: 'access_denied' });
  const future = new Date(Date.parse(request.expiresAt) + 1000);
  await assert.rejects(() => inspectAgentGrant(store, request.id, future), { code: 'grant_expired' });
  await assert.rejects(() => pollAgentGrant(store, new MemoryCredentials(), created.deviceCode, future), { code: 'grant_expired' });
});
