import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blobIntegrationCredentialStore } from './blobIntegrationCredentialStore.js';
import { POST as createProfileRoute } from '../routes/integration-testnet.js';
import { Keypair, StrKey } from '@stellar/stellar-sdk/base';
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

  async createCredential(record: StoredIntegrationCredential) {
    if (this.records.has(record.credential.serviceId)) return false;
    this.records.set(record.credential.serviceId, record); return true;
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


test('concurrent profile creation is create-only in the real filesystem store', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mst-profile-create-'));
  const oldMode = process.env.MULTISIG_PRIVATE_OBJECT_STORAGE;
  const oldRoot = process.env.MULTISIG_PRIVATE_OBJECT_ROOT;
  process.env.MULTISIG_PRIVATE_OBJECT_STORAGE = 'filesystem';
  process.env.MULTISIG_PRIVATE_OBJECT_ROOT = directory;
  try {
    const input = { serviceId: 'concurrent-profile', label: 'Fixture Profile',
      classicSourceAccounts: [Keypair.random().publicKey()] };
    const outcomes = await Promise.allSettled([
      createTestnetIntegration(blobIntegrationCredentialStore, input),
      createTestnetIntegration(blobIntegrationCredentialStore, input),
    ]);
    const winners = outcomes.filter((item) => item.status === 'fulfilled');
    const losers = outcomes.filter((item) => item.status === 'rejected');
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.equal(losers[0].reason.code, 'integration_service_exists');
    assert.deepEqual(losers[0].reason.details, { serviceId: input.serviceId, recovery: 'new_service_id_or_authorized_operator_rotation' });
    const original = winners[0].value;
    // Discarding the successful response cannot justify returning another key.
    await assert.rejects(() => createTestnetIntegration(blobIntegrationCredentialStore, input), { code: 'integration_service_exists' });
    await assert.rejects(() => createTestnetIntegration(blobIntegrationCredentialStore, { ...input, label: 'Changed' }), { code: 'integration_service_exists' });
    const stored = await blobIntegrationCredentialStore.getCredential(input.serviceId);
    assert.ok(stored);
    assert.equal(stored.credential.label, input.label);
    assert.equal((await authenticateIntegrationCredentialWithResolver(original.apiKey, async () => stored.credential)).serviceId, input.serviceId);
    assert.equal((await blobIntegrationCredentialStore.listCredentials()).length, 1);
  } finally {
    if (oldMode === undefined) delete process.env.MULTISIG_PRIVATE_OBJECT_STORAGE; else process.env.MULTISIG_PRIVATE_OBJECT_STORAGE = oldMode;
    if (oldRoot === undefined) delete process.env.MULTISIG_PRIVATE_OBJECT_ROOT; else process.env.MULTISIG_PRIVATE_OBJECT_ROOT = oldRoot;
    await rm(directory, { recursive: true, force: true });
  }
});

test('profile creation rejects an unsupported idempotency header before writing', async () => {
  const oldNetwork = process.env.VITE_STELLAR_DEPLOYMENT_NETWORK;
  process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = 'testnet';
  try {
    const response = await createProfileRoute(new Request('https://example.test/integration-testnet', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'not-supported' }, body: '{}',
    }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'idempotency_key_unsupported');
  } finally {
    if (oldNetwork === undefined) delete process.env.VITE_STELLAR_DEPLOYMENT_NETWORK; else process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = oldNetwork;
  }
});

test('self-service cannot create a Soroban profile with no available execution route', async () => {
  const store = new MemoryStore();
  const env = 'STELLAR_SOROBAN_MANAGED_EXECUTOR_TESTNET';
  const previous = process.env[env];
  delete process.env[env];
  const contractId = StrKey.encodeContract(new Uint8Array(32).fill(1));
  const executor = Keypair.random().publicKey();
  try {
    for (const [execution, accounts] of [
      [{ mode: 'multisigtools' }, [executor]],
      [undefined, []],
    ] as const) {
      await assert.rejects(() => createTestnetIntegration(store, {
        serviceId: 'unavailable', label: 'Unavailable',
        sorobanContracts: [{ contractId, methods: ['transfer'], execution }],
        sorobanExecutionAccounts: accounts,
      }), (cause: unknown) => cause instanceof Error && 'status' in cause && cause.status === 409 && 'code' in cause && cause.code === 'managed_executor_not_configured');
      assert.equal(store.records.size, 0);
    }
    const created = await createTestnetIntegration(store, {
      serviceId: 'external-ready', label: 'External ready',
      sorobanContracts: [{ contractId, methods: ['transfer'], execution: { mode: 'external', executor } }],
      sorobanExecutionAccounts: [executor],
    });
    assert.equal(created.service.sorobanContracts[0].execution?.mode, 'external');
  } finally {
    if (previous === undefined) delete process.env[env];
    else process.env[env] = previous;
  }
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
