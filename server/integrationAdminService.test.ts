import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk/base';
import {
  authenticateIntegrationAdminSecret,
  createIntegrationAdminSecret,
  createIntegrationAdminService,
  listIntegrationAdminServices,
  rotateIntegrationAdminCredential,
  updateIntegrationAdminService,
} from './integrationAdminService.js';
import { authenticateIntegrationCredentialWithResolver } from './integrationCredentialService.js';
import { durableIntegrationRegistryEnabled, resolveIntegrationCredential, resolveRuntimeIntegrationCredential } from './integrationCredentialRegistry.js';
import type { IntegrationCredentialStore, StoredIntegrationCredential } from './integrationCredentialStore.js';
import { RequestStorageUnavailableError } from './blobRequestStore.js';

const CONTRACT_ID = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';

class MemoryStore implements IntegrationCredentialStore {
  values = new Map<string, StoredIntegrationCredential>();
  async getCredential(serviceId: string) { return this.values.get(serviceId) ?? null; }
  async listCredentials() { return [...this.values.values()]; }
  async putCredential(record: StoredIntegrationCredential) { this.values.set(record.credential.serviceId, record); }
}

function input(serviceId = 'fednetwork') {
  const executor = Keypair.random().publicKey();
  return {
    serviceId,
    label: 'FedNetwork',
    networks: ['testnet'],
    classicSourceAccounts: [],
    classicExternalExecutionSourceAccounts: [],
    sorobanContracts: [{ contractId: CONTRACT_ID, methods: ['transfer'] }],
    sorobanExecutionAccounts: [executor],
    sorobanDefaultExecutor: executor,
  };
}

test('Integration administrator secret is one-time plaintext with deployment hash verification', () => {
  const generated = createIntegrationAdminSecret();
  assert.match(generated.adminSecret, /^mia_[A-Za-z0-9_-]{32,}$/);
  assert.doesNotThrow(() => authenticateIntegrationAdminSecret(generated.adminSecret, generated.secretHash));
  assert.throws(() => authenticateIntegrationAdminSecret(`${generated.adminSecret}x`, generated.secretHash));
});

test('durable Integration administration creates, updates, disables, and rotates without exposing verifier hash', async () => {
  const store = new MemoryStore();
  const created = await createIntegrationAdminService(store, input(), new Date('2026-09-16T10:00:00Z'));
  assert.match(created.apiKey, /^msi_fednetwork_/);
  assert.equal(created.service.enabled, true);
  assert.equal('secretHash' in created.service, false);
  assert.equal((await listIntegrationAdminServices(store))[0]?.source, 'durable');

  const oldKey = created.apiKey;
  const rotated = await rotateIntegrationAdminCredential(store, 'fednetwork', new Date('2026-09-16T10:01:00Z'));
  assert.notEqual(rotated.apiKey, oldKey);
  await assert.rejects(() => authenticateIntegrationCredentialWithResolver(oldKey, (id) => resolveIntegrationCredential(store, id)));
  assert.equal((await authenticateIntegrationCredentialWithResolver(rotated.apiKey, (id) => resolveIntegrationCredential(store, id))).serviceId, 'fednetwork');

  const current = (await listIntegrationAdminServices(store))[0]!;
  const disabled = await updateIntegrationAdminService(store, 'fednetwork', { ...current, enabled: false });
  assert.equal(disabled.enabled, false);
  assert.equal(await resolveIntegrationCredential(store, 'fednetwork'), null);
});

test('durable disabled record suppresses bootstrap env credential with the same service id', async () => {
  const previous = process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON;
  const store = new MemoryStore();
  const created = await createIntegrationAdminService(store, input('durable-only'));
  const record = store.values.get('durable-only')!;
  process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON = JSON.stringify([{ ...record.credential, serviceId: 'fednetwork' }]);
  store.values.set('fednetwork', { ...record, credential: { ...record.credential, serviceId: 'fednetwork' }, enabled: false });
  const previousAdmin = process.env.MULTISIG_INTEGRATION_ADMIN_SECRET_HASH;
  try {
    assert.equal(await resolveIntegrationCredential(store, 'fednetwork'), null);
    process.env.MULTISIG_INTEGRATION_ADMIN_SECRET_HASH = 'ab'.repeat(32);
    assert.equal(await resolveRuntimeIntegrationCredential(store, 'fednetwork'), null);
    assert.equal(created.service.source, 'durable');
  } finally {
    if (previous === undefined) delete process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON;
    else process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON = previous;
  }
});


test('runtime Integration registry becomes fail-closed when operator administration is enabled', async () => {
  const previous = process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON;
  const previousAdmin = process.env.MULTISIG_INTEGRATION_ADMIN_SECRET_HASH;
  const bootstrap = await createIntegrationAdminService(new MemoryStore(), input('bootstrap-only'));
  const recordStore = new MemoryStore();
  const record = (await createIntegrationAdminService(recordStore, input('bootstrap-source'))).service;
  const source = recordStore.values.get(record.serviceId)!;
  process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON = JSON.stringify([{ ...source.credential, serviceId: 'fednetwork' }]);
  const unavailable: IntegrationCredentialStore = {
    async getCredential() { throw new RequestStorageUnavailableError(); },
    async listCredentials() { throw new RequestStorageUnavailableError(); },
    async putCredential() { throw new RequestStorageUnavailableError(); },
  };
  try {
    delete process.env.MULTISIG_INTEGRATION_ADMIN_SECRET_HASH;
    assert.equal(durableIntegrationRegistryEnabled(), false);
    assert.equal((await resolveRuntimeIntegrationCredential(unavailable, 'fednetwork'))?.serviceId, 'fednetwork');
    process.env.MULTISIG_INTEGRATION_ADMIN_SECRET_HASH = 'ab'.repeat(32);
    assert.equal(durableIntegrationRegistryEnabled(), true);
    await assert.rejects(() => resolveRuntimeIntegrationCredential(unavailable, 'fednetwork'), RequestStorageUnavailableError);
    assert.match(bootstrap.apiKey, /^msi_bootstrap-only_/);
  } finally {
    if (previous === undefined) delete process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON;
    else process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON = previous;
    if (previousAdmin === undefined) delete process.env.MULTISIG_INTEGRATION_ADMIN_SECRET_HASH;
    else process.env.MULTISIG_INTEGRATION_ADMIN_SECRET_HASH = previousAdmin;
  }
});
