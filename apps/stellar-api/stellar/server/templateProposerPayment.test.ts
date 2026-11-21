import assert from 'node:assert/strict';
import test from 'node:test';
import { FeeBumpTransaction, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk/base';
import type { StellarAccountSnapshot } from '../../../../packages/stellar-core/src/types.js';
import type { ReusableTemplateStore, StoredReusableTemplateVersion } from './reusableTemplateStore.js';
import { createReusableTemplate, listWalletTemplates, updateTemplateProposer, ReusableTemplateServiceError } from './reusableTemplateService.js';
import { prepareTemplateProposerPayment } from './templateProposerPayment.js';

const source = Keypair.random().publicKey();
const owner = Keypair.random().publicKey();
const proposer = Keypair.random().publicKey();
const stranger = Keypair.random().publicKey();
const destination = Keypair.random().publicKey();
const issuer = Keypair.random().publicKey();
let ownerWeight = 1;
const now = new Date('2026-11-21T09:00:00Z');

function account(accountId: string, credit = false): StellarAccountSnapshot {
  return {
    accountId, sequence: '10', subentryCount: 0, numSponsoring: 0, numSponsored: 0,
    nativeBalance: '100', nativeSellingLiabilities: '0',
    thresholds: { low: 1, medium: 2, high: 2 },
    signers: accountId === source ? [
      { key: source, type: 'ed25519_public_key', weight: 0 },
      { key: owner, type: 'ed25519_public_key', weight: ownerWeight },
      { key: Keypair.random().publicKey(), type: 'ed25519_public_key', weight: 1 },
    ] : [{ key: accountId, type: 'ed25519_public_key', weight: 1 }],
    balances: [{ assetType: 'native', assetCode: 'XLM', balance: '100', sellingLiabilities: '0', buyingLiabilities: '0' },
      ...(credit ? [{ assetType: 'credit_alphanum4', assetCode: 'USD', assetIssuer: issuer, balance: '100', sellingLiabilities: '0', buyingLiabilities: '0' }] : [])],
  };
}
const deps = {
  accountLoader: async (id: string) => account(id, true),
  networkParametersLoader: async () => ({
    ledgerSequence: 100, ledgerClosedAt: now.toISOString(), baseFeeInStroops: 100, baseReserveInStroops: 5_000_000,
  }),
};

function memory(): ReusableTemplateStore {
  const templates = new Map<string, StoredReusableTemplateVersion>();
  const grants = new Set<string>();
  return {
    async createTemplate(_template, value) { templates.set(value.template.id, value); },
    async listTemplates(wallet, network) { return [...templates.values()].filter((v) => v.template.ownerAddress === wallet && v.template.network === network); },
    async getTemplateVersion(id, version) { const value = templates.get(id); return value?.version === version ? value : null; },
    async listGrantedTemplates(wallet, network) {
      return [...templates.values()].filter((v) => v.template.network === network && grants.has(`${v.template.id}:${wallet}`));
    },
    async listProposers(id) { return [...grants].filter((key) => key.startsWith(`${id}:`)).map((key) => key.slice(id.length + 1)); },
    async hasActiveGrant(id, wallet) { return grants.has(`${id}:${wallet}`); },
    async grantProposer(id, wallet) { grants.add(`${id}:${wallet}`); },
    async revokeProposer(id, wallet) { grants.delete(`${id}:${wallet}`); },
  };
}

async function savedTemplate(store: ReusableTemplateStore, key = 'native') {
  return createReusableTemplate(store, owner, {
    network: 'testnet', name: 'Vendor payment', kind: 'payment',
    definition: {
      version: 1, source, recipients: [{ destination, assetKey: key }], signingWindowSeconds: 3600,
    },
  }, { now });
}

test('Template owner grants a non-signer wallet while retaining sole signing authority', async () => {
  ownerWeight = 1;
  const store = memory();
  const template = await savedTemplate(store);
  const allowed = await updateTemplateProposer(store, owner, 'testnet', template.id, proposer, 'grant', deps.accountLoader);
  assert.deepEqual(allowed, [proposer]);
  assert.equal((await listWalletTemplates(store, owner, 'testnet'))[0].proposerAddresses?.[0], proposer);
  const delegated = await listWalletTemplates(store, proposer, 'testnet');
  assert.equal(delegated.length, 1);
  assert.equal(delegated[0].ownerAddress, owner);
  assert.equal(delegated[0].proposerAddresses, undefined);
  assert.deepEqual(await listWalletTemplates(store, stranger, 'testnet'), []);

  const prepared = await prepareTemplateProposerPayment(store, proposer, 'testnet', {
    template: { id: template.id, version: 1 }, amount: '2.5', memo: 'INV-42',
  }, deps);
  assert.equal(prepared.templateRef.name, template.name);
  const tx = TransactionBuilder.fromXdr(prepared.prepared.xdr, Networks.TESTNET);
  if (tx instanceof FeeBumpTransaction) assert.fail('Template payment must be Classic');
  assert.equal(tx.signatures.length, 0);
  assert.equal(tx.source, source);
  assert.equal(tx.operations.length, 1);
  assert.equal(tx.operations[0].type, 'payment');
  assert.equal((tx.operations[0] as { destination: string }).destination, destination);
  assert.equal((tx.operations[0] as { amount: string }).amount, '2.5000000');
  assert.equal(Buffer.from(tx.memo.value as Uint8Array).toString('utf8'), 'INV-42');
});

test('revocation, wrong wallet, wrong network and inactive owner fail closed', async () => {
  ownerWeight = 1;
  const store = memory();
  const template = await savedTemplate(store);
  const input = { template: { id: template.id, version: 1 }, amount: '1' };
  await assert.rejects(() => prepareTemplateProposerPayment(store, proposer, 'testnet', input, deps),
    (e: unknown) => e instanceof ReusableTemplateServiceError && e.code === 'template_proposer_not_authorized');
  await updateTemplateProposer(store, owner, 'testnet', template.id, proposer, 'grant', deps.accountLoader);
  await assert.rejects(() => prepareTemplateProposerPayment(store, stranger, 'testnet', input, deps),
    (e: unknown) => e instanceof ReusableTemplateServiceError && e.status === 403);
  await assert.rejects(() => prepareTemplateProposerPayment(store, proposer, 'public', input, deps),
    (e: unknown) => e instanceof ReusableTemplateServiceError && e.code === 'template_not_found');
  ownerWeight = 0;
  await assert.rejects(() => prepareTemplateProposerPayment(store, proposer, 'testnet', input, deps),
    (e: unknown) => e instanceof ReusableTemplateServiceError && e.code === 'template_owner_signer_required');
  ownerWeight = 1;
  await updateTemplateProposer(store, owner, 'testnet', template.id, proposer, 'revoke', deps.accountLoader);
  await assert.rejects(() => prepareTemplateProposerPayment(store, proposer, 'testnet', input, deps),
    (e: unknown) => e instanceof ReusableTemplateServiceError && e.code === 'template_proposer_not_authorized');
});

test('delegated Template payments reject arbitrary payment fields, unknown assets and invalid amounts', async () => {
  ownerWeight = 1;
  const store = memory();
  const template = await savedTemplate(store);
  await updateTemplateProposer(store, owner, 'testnet', template.id, proposer, 'grant', deps.accountLoader);
  const reference = { id: template.id, version: 1 };
  await assert.rejects(() => prepareTemplateProposerPayment(store, proposer, 'testnet', {
    template: reference, amount: '2', destination: stranger,
  }, deps), (e: unknown) => e instanceof ReusableTemplateServiceError && e.code === 'invalid_template_payment');
  await assert.rejects(() => prepareTemplateProposerPayment(store, proposer, 'testnet', {
    template: reference, amount: 'not-an-amount',
  }, deps));
  const bad = await savedTemplate(store, 'unsupported:token');
  await updateTemplateProposer(store, owner, 'testnet', bad.id, proposer, 'grant', deps.accountLoader);
  await assert.rejects(() => prepareTemplateProposerPayment(store, proposer, 'testnet', {
    template: { id: bad.id, version: 1 }, amount: '2',
  }, deps), (e: unknown) => e instanceof ReusableTemplateServiceError && e.code === 'invalid_template_asset');
});

test('delegated credit asset is defined by Template, never chosen by proposer', async () => {
  ownerWeight = 1;
  const store = memory();
  const template = await savedTemplate(store, `credit:USD:${issuer}`);
  await updateTemplateProposer(store, owner, 'testnet', template.id, proposer, 'grant', deps.accountLoader);
  const result = await prepareTemplateProposerPayment(store, proposer, 'testnet', {
    template: { id: template.id, version: 1 }, amount: '1.25',
  }, deps);
  const tx = TransactionBuilder.fromXdr(result.prepared.xdr, Networks.TESTNET);
  if (tx instanceof FeeBumpTransaction) assert.fail('Expected Classic');
  assert.equal(tx.operations[0].type, 'payment');
  assert.equal((tx.operations[0] as { asset: { code: string } }).asset.code, 'USD');
});
