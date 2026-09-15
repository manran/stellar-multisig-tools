import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk/base';
import { createSignerAgentCredential } from './agentCredentialService.js';
import type { AgentCredentialStore, StoredAgentIdempotencyClaim, StoredSignerAgentCredential } from './agentCredentialStore.js';
import { CallerAuthenticationError, machineCallerFromRequest } from './callerAuthentication.js';
import { createIntegrationApiKey } from './integrationCredentialService.js';

class MemoryAgentStore implements AgentCredentialStore {
  credentials = new Map<string, StoredSignerAgentCredential>();
  async listCredentials() { return [...this.credentials.values()]; }
  async getCredential(id: string) { return this.credentials.get(id) ?? null; }
  async putCredential(value: StoredSignerAgentCredential) { this.credentials.set(value.credentialId, value); }
  async touchCredential() {}
  async claimIdempotency(claim: StoredAgentIdempotencyClaim) { return { claimed: true, claim }; }
  async releaseIdempotency() {}
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
    const serviceCaller = await machineCallerFromRequest(store, bearer(service.apiKey));
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
