import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk/base';
import type {
  IntegrationCredentialStore,
  StoredIntegrationCredential,
} from './integrationCredentialStore.js';
import { createTestnetIntegration } from './testnetIntegrationService.js';

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
