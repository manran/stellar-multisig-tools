import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { authConfigForRequest } from './authConfig.js';
import { createAuthChallenge, exchangeAuthChallenge } from './authService.js';
import type { AuthStore, StoredAuthServerKey } from './authStore.js';
import { createSignerAgentCredential } from './agentCredentialService.js';
import type { AgentCredentialStore, StoredAgentIdempotencyClaim, StoredSignerAgentCredential } from './agentCredentialStore.js';
import { CallerAuthenticationError, machineCallerFromRequest, signerWorkspaceCallerFromRequest } from './callerAuthentication.js';
import { createIntegrationApiKey } from './integrationCredentialService.js';
import type { IntegrationCredentialStore, StoredIntegrationCredential } from './integrationCredentialStore.js';

class MemoryAgentStore implements AgentCredentialStore {
  credentials = new Map<string, StoredSignerAgentCredential>();
  async listCredentials() { return [...this.credentials.values()]; }
  async getCredential(id: string) { return this.credentials.get(id) ?? null; }
  async putCredential(value: StoredSignerAgentCredential) { this.credentials.set(value.credentialId, value); }
  async touchCredential() {}
  async claimIdempotency(claim: StoredAgentIdempotencyClaim) { return { claimed: true, claim }; }
  async releaseIdempotency() {}
}

class MemoryIntegrationStore implements IntegrationCredentialStore {
  credentials = new Map<string, StoredIntegrationCredential>();
  async getCredential(id: string) { return this.credentials.get(id) ?? null; }
  async listCredentials() { return [...this.credentials.values()]; }
  async createCredential(value: StoredIntegrationCredential) {
    if (this.credentials.has(value.credential.serviceId)) return false;
    this.credentials.set(value.credential.serviceId, value); return true;
  }
  async putCredential(value: StoredIntegrationCredential) { this.credentials.set(value.credential.serviceId, value); }
}

function bearer(value: string) {
  return new Request('https://stellar-testnet.multisig.tools/api/request', {
    headers: { authorization: `Bearer ${value}` },
  });
}
test('machine caller auth distinguishes signer Agent and independent Service credentials', async () => {
  const store = new MemoryAgentStore();
  const principal = { type: 'signer' as const, network: 'testnet' as const, address: Keypair.random().publicKey() };
  const agent = await createSignerAgentCredential(store, principal, 'bot', 'read', principal.address);
  const agentCaller = await machineCallerFromRequest(store, bearer(agent.apiKey));
  assert.equal(agentCaller?.kind, 'agent');
  assert.equal(agentCaller?.credential.principal.address, principal.address);

  const service = createIntegrationApiKey('fednetwork');
  const previous = process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON;
  process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON = JSON.stringify([{
    serviceId: 'fednetwork', label: 'FedNetwork', secretHash: service.secretHash,
    networks: ['testnet'], classicSourceAccounts: [principal.address],
    classicExternalExecutionSourceAccounts: [], sorobanContracts: [], sorobanExecutionAccounts: [],
  }]);
  try {
    const integrationStore = new MemoryIntegrationStore();
    const serviceCaller = await machineCallerFromRequest(store, bearer(service.apiKey), integrationStore);
    assert.equal(serviceCaller?.kind, 'service');
    assert.equal(serviceCaller?.credential.serviceId, 'fednetwork');
  } finally {
    if (previous === undefined) delete process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON;
    else process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON = previous;
  }
});
test('Human Bearer JWT shape is left for signer-session verification', async () => {
  const caller = await machineCallerFromRequest(new MemoryAgentStore(), bearer('header.payload.signature'));
  assert.equal(caller, null);
});

test('Signer workspace accepts verified Human bearer and cookie sessions, not service credentials', async (t) => {
  const previousNetwork = process.env.VITE_STELLAR_DEPLOYMENT_NETWORK;
  t.after(() => {
    if (previousNetwork === undefined) delete process.env.VITE_STELLAR_DEPLOYMENT_NETWORK;
    else process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = previousNetwork;
  });
  process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = 'testnet';
  const agentStore = new MemoryAgentStore();
  let key: StoredAuthServerKey | null = null;
  const authStore: AuthStore = {
    async getServerKey() { return key; },
    async createServerKey(value) { key = value; },
    async claimChallengeRedemption() { return true; },
  };
  const signer = Keypair.random();
  const config = authConfigForRequest(bearer('placeholder'));
  const challenge = await createAuthChallenge(authStore, signer.publicKey(), 'testnet', config);
  const transaction = TransactionBuilder.fromXDR(challenge.transaction, Networks.TESTNET);
  transaction.sign(signer);
  const session = await exchangeAuthChallenge(authStore, transaction.toXDR(), 'testnet', config);
  const principal = { type: 'signer', address: signer.publicKey(), network: 'testnet', actor: 'human' };
  for (const request of [
    bearer(session.token),
    new Request('https://stellar-testnet.multisig.tools/api/inbox', { headers: { Cookie: 'mst_auth=' + encodeURIComponent(session.token) } }),
  ]) {
    assert.deepEqual(await signerWorkspaceCallerFromRequest(agentStore, authStore, request, 'read', 'Unlock wallet'), principal);
  }
  const agent = await createSignerAgentCredential(agentStore, { type: 'signer', network: 'testnet', address: signer.publicKey() }, 'Monitor', 'read', signer.publicKey());
  const caller = await signerWorkspaceCallerFromRequest(agentStore, authStore, bearer(agent.apiKey), 'read', 'Unlock wallet');
  assert.equal(caller.actor, 'agent');
  await assert.rejects(() => signerWorkspaceCallerFromRequest(agentStore, authStore, bearer(agent.apiKey), 'write', 'Unlock wallet'), { code: 'agent_access_denied' });
  for (const invalid of ['msi_invalid', 'mta_invalid']) {
    await assert.rejects(() => signerWorkspaceCallerFromRequest(agentStore, authStore, bearer(invalid), 'read', 'Unlock wallet'), { code: 'invalid_agent_credential' });
  }
  await assert.rejects(() => signerWorkspaceCallerFromRequest(agentStore, authStore, bearer('invalid.jwt.signature'), 'read', 'Unlock wallet'), { status: 401 });
  process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = 'public';
  await assert.rejects(() => signerWorkspaceCallerFromRequest(agentStore, authStore, bearer(agent.apiKey), 'read', 'Unlock wallet'), { code: 'deployment_network_mismatch' });
});

test('malformed authorization header fails before caller classification', async () => {
  const request = new Request('https://stellar-testnet.multisig.tools/api/request', {
    headers: { authorization: 'Basic abc' },
  });
  await assert.rejects(
    () => machineCallerFromRequest(new MemoryAgentStore(), request),
    (cause: unknown) => cause instanceof CallerAuthenticationError
      && cause.status === 401
      && cause.code === 'invalid_credential',
  );
});
