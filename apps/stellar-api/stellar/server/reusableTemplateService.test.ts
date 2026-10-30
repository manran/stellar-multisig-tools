import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk';
import type { ReusableTemplateStore, StoredReusableTemplateVersion } from './reusableTemplateStore.js';
import {
  createReusableTemplate,
  listReusableTemplates,
  resolveReusableTemplateReference,
  ReusableTemplateServiceError,
} from './reusableTemplateService.js';

function memoryStore(): ReusableTemplateStore {
  const values = new Map<string, StoredReusableTemplateVersion>();
  return {
    async createTemplate(_template, version) {
      values.set(`${version.template.id}:${version.version}`, version);
    },
    async listTemplates(ownerAddress, network) {
      return [...values.values()].filter((value) =>
        value.template.ownerAddress === ownerAddress
        && value.template.network === network
        && !value.template.archivedAt
        && value.version === value.template.currentVersion,
      );
    },
    async getTemplateVersion(id, version) {
      return values.get(`${id}:${version}`) ?? null;
    },
  };
}

test('creates a signer-owned payment template with only reusable fields', async () => {
  const owner = Keypair.random().publicKey();
  const destination = Keypair.random().publicKey();
  const store = memoryStore();
  const created = await createReusableTemplate(store, owner, {
    network: 'testnet',
    name: '  Pay   ACME ',
    kind: 'payment',
    definition: {
      version: 1,
      source: owner,
      recipients: [{ destination, assetKey: 'native' }],
      signingWindowSeconds: 86400,
    },
  }, {
    now: new Date('2026-10-30T01:00:00Z'),
    idFactory: () => 'tpl_abcdefghijklmnop',
  });

  assert.equal(created.name, 'Pay ACME');
  assert.equal(created.currentVersion, 1);
  assert.deepEqual(created.definition.recipients, [{ destination, assetKey: 'native' }]);
  assert.equal((await listReusableTemplates(store, owner, 'testnet')).length, 1);
  assert.deepEqual(
    await resolveReusableTemplateReference(store, owner, 'testnet', { id: created.id, version: 1 }),
    { id: created.id, version: 1 },
  );
});

test('enforces single and batch recipient shape', async () => {
  const owner = Keypair.random().publicKey();
  const first = Keypair.random().publicKey();
  const second = Keypair.random().publicKey();
  const store = memoryStore();

  await assert.rejects(
    () => createReusableTemplate(store, owner, {
      network: 'testnet',
      name: 'Bad payment',
      kind: 'payment',
      definition: {
        version: 1,
        source: owner,
        recipients: [
          { destination: first, assetKey: 'native' },
          { destination: second, assetKey: 'native' },
        ],
        signingWindowSeconds: 86400,
      },
    }),
    (cause: unknown) => cause instanceof ReusableTemplateServiceError && cause.code === 'invalid_template_recipients',
  );

  await assert.rejects(
    () => createReusableTemplate(store, owner, {
      network: 'testnet',
      name: 'Bad batch',
      kind: 'batch_payment',
      definition: {
        version: 1,
        source: owner,
        recipients: [{ destination: first, assetKey: 'native' }],
        signingWindowSeconds: 86400,
      },
    }),
    (cause: unknown) => cause instanceof ReusableTemplateServiceError && cause.code === 'invalid_template_recipients',
  );
});

test('template references are owner and network scoped', async () => {
  const owner = Keypair.random().publicKey();
  const other = Keypair.random().publicKey();
  const destination = Keypair.random().publicKey();
  const store = memoryStore();
  const created = await createReusableTemplate(store, owner, {
    network: 'testnet',
    name: 'Vendor',
    kind: 'payment',
    definition: {
      version: 1,
      source: owner,
      recipients: [{ destination, assetKey: 'native' }],
      signingWindowSeconds: 86400,
    },
  }, { idFactory: () => 'tpl_abcdefghijklmnop' });

  await assert.rejects(
    () => resolveReusableTemplateReference(store, other, 'testnet', { id: created.id, version: 1 }),
    (cause: unknown) => cause instanceof ReusableTemplateServiceError && cause.code === 'template_not_found',
  );
  await assert.rejects(
    () => resolveReusableTemplateReference(store, owner, 'public', { id: created.id, version: 1 }),
    (cause: unknown) => cause instanceof ReusableTemplateServiceError && cause.code === 'template_not_found',
  );
});
