import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TimeoutInfinite,
  TransactionBuilder,
} from '@stellar/stellar-sdk/base';
import { createSignerAgentCredential } from './agentCredentialService.js';
import type {
  AgentCredentialStore,
  StoredAgentIdempotencyClaim,
  StoredSignerAgentCredential,
} from './agentCredentialStore.js';
import { createAgentSigningRequest } from './agentRequestService.js';
import type {
  SigningRequestStore,
  StoredRequestParticipant,
  StoredSignatureContribution,
  StoredSigningRequest,
  StoredSubmissionResult,
} from './requestStore.js';
import type { SignerPrincipalRef } from '../src/stellar/agentAccessTypes.js';
import type { StellarAccountSnapshot } from '../src/stellar/types.js';

class MemoryAgentStore implements AgentCredentialStore {
  credentials = new Map<string, StoredSignerAgentCredential>();
  claims = new Map<string, StoredAgentIdempotencyClaim>();
  async listCredentials(principal: SignerPrincipalRef) { return [...this.credentials.values()].filter((item) => item.principal.network === principal.network && item.principal.address === principal.address); }
  async getCredential(id: string) { return this.credentials.get(id) ?? null; }
  async putCredential(item: StoredSignerAgentCredential) { this.credentials.set(item.credentialId, item); }
  async touchCredential(id: string, usedAt: string) { const item = this.credentials.get(id); if (item) this.credentials.set(id, { ...item, lastUsedAt: usedAt }); }
  async claimIdempotency(claim: StoredAgentIdempotencyClaim) { const key = `${claim.credentialId}:${claim.idempotencyHash}`; const existing = this.claims.get(key); if (existing) return { claimed: false, claim: existing }; this.claims.set(key, claim); return { claimed: true, claim }; }
  async releaseIdempotency(claim: StoredAgentIdempotencyClaim) { this.claims.delete(`${claim.credentialId}:${claim.idempotencyHash}`); }
}

class MemoryRequestStore implements SigningRequestStore {
  requests = new Map<string, StoredSigningRequest>();
  contributions = new Map<string, StoredSignatureContribution[]>();
  submissions = new Map<string, StoredSubmissionResult>();
  participants = new Map<string, StoredRequestParticipant>();
  participantKey(requestId: string, address: string) { return `${requestId}:${address}`; }
  async createRequest(request: StoredSigningRequest) { if (this.requests.has(request.id)) throw new Error('duplicate'); this.requests.set(request.id, request); }
  async getRequest(id: string) { return this.requests.get(id) ?? null; }
  async listContributions(id: string) { return this.contributions.get(id) ?? []; }
  async putContribution(id: string, contribution: StoredSignatureContribution) { this.contributions.set(id, [...(this.contributions.get(id) ?? []), contribution]); }
  async getSubmission(id: string, transactionHash: string) { const result = this.submissions.get(id); return result?.transactionHash === transactionHash ? result : null; }
  async putSubmission(id: string, submission: StoredSubmissionResult) { this.submissions.set(id, submission); }
  async getRequestParticipant(id: string, address: string) { return this.participants.get(this.participantKey(id, address)) ?? null; }
  async putRequestParticipant(id: string, participant: StoredRequestParticipant) { this.participants.set(this.participantKey(id, participant.address), participant); }
}

class FailOnceParticipantStore extends MemoryRequestStore {
  failuresRemaining = 1;
  async putRequestParticipant(id: string, participant: StoredRequestParticipant) {
    if (this.failuresRemaining > 0) { this.failuresRemaining -= 1; throw new Error('participant write failed'); }
    await super.putRequestParticipant(id, participant);
  }
}

class RejectActivityWriteStore extends MemoryRequestStore {
  async putActivityEvent() {
    throw new Error('derived Request state must not be persisted as Activity');
  }
}

class FailOnceTouchStore extends MemoryAgentStore {
  failuresRemaining = 1;
  async touchCredential(id: string, usedAt: string) {
    if (this.failuresRemaining > 0) { this.failuresRemaining -= 1; throw new Error('credential usage write failed'); }
    await super.touchCredential(id, usedAt);
  }
}

class PersistThenFailRequestStore extends MemoryRequestStore {
  failuresRemaining = 1;
  async createRequest(request: StoredSigningRequest) {
    await super.createRequest(request);
    if (this.failuresRemaining > 0) { this.failuresRemaining -= 1; throw new Error('request write outcome unknown'); }
  }
}

class FailBeforePersistRequestStore extends MemoryRequestStore {
  failuresRemaining = 1;
  async createRequest(request: StoredSigningRequest) {
    if (this.failuresRemaining > 0) { this.failuresRemaining -= 1; throw new Error('request storage unavailable'); }
    await super.createRequest(request);
  }
}

function setup() {
  const source = Keypair.random();
  const second = Keypair.random();
  const transaction = new TransactionBuilder(new Account(source.publicKey(), '1'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '10' }))
    .setTimeout(TimeoutInfinite)
    .build();
  const snapshot: StellarAccountSnapshot = {
    accountId: source.publicKey(), sequence: '1', subentryCount: 1, numSponsoring: 0, numSponsored: 0,
    thresholds: { low: 1, medium: 2, high: 2 },
    signers: [
      { key: source.publicKey(), type: 'ed25519_public_key', weight: 1 },
      { key: second.publicKey(), type: 'ed25519_public_key', weight: 1 },
    ],
  };
  return { source, second, transaction, snapshot };
}

async function credential(store: MemoryAgentStore, principalAddress: string, access: 'read' | 'write' | 'sign' = 'write') {
  const principal: SignerPrincipalRef = { type: 'signer', network: 'testnet', address: principalAddress };
  const created = await createSignerAgentCredential(store, principal, `Agent ${access}`, access, principalAddress);
  const record = await store.getCredential(created.credential.credentialId);
  assert.ok(record);
  return record;
}

test('Write Agent creates an unsigned Request as signer Principal and becomes a Request participant', async () => {
  const agents = new MemoryAgentStore();
  const requests = new MemoryRequestStore();
  const { source, transaction, snapshot } = setup();
  const key = await credential(agents, source.publicKey(), 'write');
  const result = await createAgentSigningRequest(agents, requests, key, {
    network: 'testnet', xdr: transaction.toXdr(), idempotencyKey: 'payment-42', privateNote: 'Invoice 42', externalReference: 'invoice-42',
  }, { accountLoader: async () => snapshot, idFactory: () => 'A'.repeat(16), now: new Date('2026-09-04T01:00:00Z') });
  assert.equal(result.replayed, false);
  assert.equal(result.request.id, 'A'.repeat(16));
  assert.equal(result.externalReference, 'invoice-42');
  const stored = requests.requests.get('A'.repeat(16));
  assert.equal(stored?.creatorAddress, source.publicKey());
  assert.equal(stored?.creatorActor?.id, key.credentialId);
  assert.equal(stored?.initialPrivateNote?.text, 'Invoice 42');
  assert.equal((await requests.getRequestParticipant('A'.repeat(16), source.publicKey()))?.address, source.publicKey());
});

test('Write Agent cannot create a pre-signed Request while Sign Agent can', async () => {
  const { source, transaction, snapshot } = setup();
  const signed = TransactionBuilder.fromXdr(transaction.toXdr(), Networks.TESTNET);
  signed.sign(source);
  const writeAgents = new MemoryAgentStore();
  const writeKey = await credential(writeAgents, source.publicKey(), 'write');
  await assert.rejects(
    () => createAgentSigningRequest(writeAgents, new MemoryRequestStore(), writeKey, { network: 'testnet', xdr: signed.toXdr(), idempotencyKey: 'signed-write' }, { accountLoader: async () => snapshot }),
    (cause: unknown) => cause instanceof Error && 'code' in cause && cause.code === 'agent_access_denied',
  );
  const signAgents = new MemoryAgentStore();
  const signKey = await credential(signAgents, source.publicKey(), 'sign');
  const result = await createAgentSigningRequest(signAgents, new MemoryRequestStore(), signKey, { network: 'testnet', xdr: signed.toXdr(), idempotencyKey: 'signed-sign' }, { accountLoader: async () => snapshot, idFactory: () => 'B'.repeat(16) });
  assert.equal(result.request.signatureCount, 1);
});

test('Agent Request creation is bound to Principal network and live transaction signer access', async () => {
  const agents = new MemoryAgentStore();
  const requests = new MemoryRequestStore();
  const { transaction, snapshot } = setup();
  const outsider = Keypair.random().publicKey();
  const key = await credential(agents, outsider, 'write');
  await assert.rejects(
    () => createAgentSigningRequest(agents, requests, key, { network: 'testnet', xdr: transaction.toXdr(), idempotencyKey: 'outsider' }, { accountLoader: async () => snapshot }),
    (cause: unknown) => cause instanceof Error && 'code' in cause && cause.code === 'principal_transaction_access_denied',
  );
  await assert.rejects(
    () => createAgentSigningRequest(agents, requests, key, { network: 'public', xdr: transaction.toXdr(), idempotencyKey: 'wrong-network' }, { accountLoader: async () => snapshot }),
    (cause: unknown) => cause instanceof Error && 'code' in cause && cause.code === 'principal_network_mismatch',
  );
});

test('Agent idempotency replays the same Request without a second mapping subsystem', async () => {
  const agents = new MemoryAgentStore();
  const requests = new MemoryRequestStore();
  const { source, transaction, snapshot } = setup();
  const key = await credential(agents, source.publicKey());
  let sequence = 0;
  const options = { accountLoader: async () => snapshot, idFactory: () => `${sequence++ ? 'B' : 'A'}`.repeat(16), now: new Date('2026-09-04T01:00:00Z') };
  const input = { network: 'testnet' as const, xdr: transaction.toXdr(), idempotencyKey: 'same-job' };
  const first = await createAgentSigningRequest(agents, requests, key, input, options);
  const second = await createAgentSigningRequest(agents, requests, key, input, options);
  assert.equal(first.request.id, 'A'.repeat(16));
  assert.equal(second.request.id, 'A'.repeat(16));
  assert.equal(second.replayed, true);
  assert.equal(requests.requests.size, 1);
  assert.equal(agents.claims.size, 1);
});

test('retry heals a failed participant projection without creating another Request', async () => {
  const agents = new MemoryAgentStore();
  const requests = new FailOnceParticipantStore();
  const { source, transaction, snapshot } = setup();
  const key = await credential(agents, source.publicKey());
  const input = { network: 'testnet' as const, xdr: transaction.toXdr(), idempotencyKey: 'participant-recovery' };
  await assert.rejects(() => createAgentSigningRequest(agents, requests, key, input, { accountLoader: async () => snapshot, idFactory: () => 'A'.repeat(16) }), /participant write failed/);
  assert.equal(requests.requests.size, 1);
  assert.equal(agents.claims.size, 1);
  const recovered = await createAgentSigningRequest(agents, requests, key, input, { accountLoader: async () => snapshot, idFactory: () => 'B'.repeat(16) });
  assert.equal(recovered.replayed, true);
  assert.equal(recovered.request.id, 'A'.repeat(16));
  assert.equal(requests.requests.size, 1);
  assert.equal((await requests.getRequestParticipant('A'.repeat(16), source.publicKey()))?.address, source.publicKey());
});

test('ready Agent Request creation does not persist derived Activity state', async () => {
  const agents = new MemoryAgentStore();
  const requests = new RejectActivityWriteStore();
  const { source, second, transaction, snapshot } = setup();
  const signed = TransactionBuilder.fromXdr(transaction.toXdr(), Networks.TESTNET);
  signed.sign(source);
  signed.sign(second);
  const key = await credential(agents, source.publicKey(), 'sign');

  const result = await createAgentSigningRequest(agents, requests, key, {
    network: 'testnet',
    xdr: signed.toXdr(),
    idempotencyKey: 'ready-without-activity-projection',
  }, {
    accountLoader: async () => snapshot,
    idFactory: () => 'A'.repeat(16),
    now: new Date('2026-09-04T01:00:00Z'),
  });

  assert.equal(result.request.status, 'ready');
  assert.equal(requests.requests.size, 1);
  assert.equal(agents.claims.size, 1);
});

test('retry recovers an uncertain Request write using the reserved Request id', async () => {
  const agents = new MemoryAgentStore();
  const requests = new PersistThenFailRequestStore();
  const { source, transaction, snapshot } = setup();
  const key = await credential(agents, source.publicKey());
  const result = await createAgentSigningRequest(agents, requests, key, { network: 'testnet', xdr: transaction.toXdr(), idempotencyKey: 'uncertain-write' }, { accountLoader: async () => snapshot, idFactory: () => 'A'.repeat(16) });
  assert.equal(result.request.id, 'A'.repeat(16));
  assert.equal(requests.requests.size, 1);
  assert.equal(agents.claims.size, 1);
});

test('retry resumes the reserved Request id when first Request write never persisted', async () => {
  const agents = new MemoryAgentStore();
  const requests = new FailBeforePersistRequestStore();
  const { source, transaction, snapshot } = setup();
  const key = await credential(agents, source.publicKey());
  let sequence = 0;
  const options = { accountLoader: async () => snapshot, idFactory: () => `${sequence++ ? 'B' : 'A'}`.repeat(16) };
  const input = { network: 'testnet' as const, xdr: transaction.toXdr(), idempotencyKey: 'request-write-retry' };
  await assert.rejects(() => createAgentSigningRequest(agents, requests, key, input, options), /request storage unavailable/);
  assert.equal(requests.requests.size, 0);
  assert.equal(agents.claims.size, 1);
  const recovered = await createAgentSigningRequest(agents, requests, key, input, options);
  assert.equal(recovered.replayed, true);
  assert.equal(recovered.request.id, 'A'.repeat(16));
  assert.equal(requests.requests.size, 1);
});

test('late credential usage failure preserves Request and claim for safe replay', async () => {
  const agents = new FailOnceTouchStore();
  const requests = new MemoryRequestStore();
  const { source, transaction, snapshot } = setup();
  const key = await credential(agents, source.publicKey());
  const input = { network: 'testnet' as const, xdr: transaction.toXdr(), idempotencyKey: 'touch-recovery' };
  await assert.rejects(() => createAgentSigningRequest(agents, requests, key, input, { accountLoader: async () => snapshot, idFactory: () => 'A'.repeat(16) }), /credential usage write failed/);
  assert.equal(requests.requests.size, 1);
  assert.equal(agents.claims.size, 1);
  const recovered = await createAgentSigningRequest(agents, requests, key, input, { accountLoader: async () => snapshot, idFactory: () => 'B'.repeat(16) });
  assert.equal(recovered.replayed, true);
  assert.equal(recovered.request.id, 'A'.repeat(16));
});

test('validation failure before Request store call releases a fresh idempotency claim', async () => {
  const agents = new MemoryAgentStore();
  const requests = new MemoryRequestStore();
  const { source, transaction, snapshot } = setup();
  const key = await credential(agents, source.publicKey());
  await assert.rejects(
    () => createAgentSigningRequest(agents, requests, key, { network: 'testnet', xdr: transaction.toXdr(), idempotencyKey: 'bad-id' }, { accountLoader: async () => snapshot, idFactory: () => 'bad' }),
    (cause: unknown) => cause instanceof Error && 'code' in cause && cause.code === 'invalid_request_id',
  );
  assert.equal(agents.claims.size, 0);
  assert.equal(requests.requests.size, 0);
});
