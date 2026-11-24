import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk/base';
import type {
  IntegrationCredentialStore,
  StoredIntegrationCredential,
} from './integrationCredentialStore.js';
import { createTestnetIntegration } from './testnetIntegrationService.js';
import { authenticateIntegrationCredentialWithResolver } from './integrationCredentialService.js';
import { resolveRuntimeIntegrationCredential } from './integrationCredentialRegistry.js';

class MemoryStore implements IntegrationCredentialStore {
  records = new Map<string, StoredIntegrationCredential>();

  async getCredential(serviceId: string) {
    return this.records.get(serviceId) ?? null;
  }

  async listCredentials() {
    return [...this.records.values()];
  }

  async putCredential(record: StoredIntegrationCredential) {
    this.records.set(record.credential.serviceId, record);
  }
}

test('Testnet Integration self-service forces Testnet and enabled while reusing the existing credential model', async () => {
  const store = new MemoryStore();
  const treasury = Keypair.random().publicKey();

  const created = await createTestnetIntegration(store, {
    serviceId: 'open-testnet',
    label: 'Open Testnet',
    enabled: false,
    networks: ['public'],
    classicSourceAccounts: [treasury],
    classicExternalExecutionSourceAccounts: [],
    sorobanContracts: [],
    sorobanExecutionAccounts: [],
    profile: { authorizationExperience: 'hosted' },
  }, new Date('2026-09-21T03:00:00.000Z'));

  assert.match(created.apiKey, /^msi_open-testnet_/);
  assert.deepEqual(created.service.networks, ['testnet']);
  assert.equal(created.service.enabled, true);
  assert.deepEqual(created.service.classicSourceAccounts, [treasury]);

  const stored = await store.getCredential('open-testnet');
  assert.deepEqual(stored?.credential.networks, ['testnet']);
  assert.equal(stored?.enabled, true);
});


test('a self-service MSI authenticates on fixed Testnet without operator administration', async () => {
  const previousNetwork = process.env.VITE_STELLAR_DEPLOYMENT_NETWORK;
  const previousAdmin = process.env.MULTISIG_INTEGRATION_ADMIN_SECRET_HASH;
  const previousBootstrap = process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON;
  const store = new MemoryStore();
  try {
    process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = 'testnet';
    delete process.env.MULTISIG_INTEGRATION_ADMIN_SECRET_HASH;
    delete process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON;
    const created = await createTestnetIntegration(store, {
      serviceId: 'testnet-agent', label: 'Testnet Agent',
      classicSourceAccounts: [Keypair.random().publicKey()],
    });
    const resolve = (id: string) => resolveRuntimeIntegrationCredential(store, id);
    const verified = await authenticateIntegrationCredentialWithResolver(created.apiKey, resolve);
    assert.equal(verified.serviceId, 'testnet-agent');
    assert.deepEqual(verified.networks, ['testnet']);
    const record = (await store.getCredential('testnet-agent'))!;
    await store.putCredential({ ...record, enabled: false });
    assert.equal(await resolve('testnet-agent'), null);
    await store.putCredential(record);
    process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = 'public';
    assert.equal(await resolve('testnet-agent'), null);
  } finally {
    if (previousNetwork === undefined) delete process.env.VITE_STELLAR_DEPLOYMENT_NETWORK;
    else process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = previousNetwork;
    if (previousAdmin === undefined) delete process.env.MULTISIG_INTEGRATION_ADMIN_SECRET_HASH;
    else process.env.MULTISIG_INTEGRATION_ADMIN_SECRET_HASH = previousAdmin;
    if (previousBootstrap === undefined) delete process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON;
    else process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON = previousBootstrap;
  }
});
