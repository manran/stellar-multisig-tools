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
import {
  assertTreasuryProposalBound,
  authenticateTreasuryAuditKey,
  BoxServiceError,
  createTreasuryAuditKey,
  normalizeTreasuryName,
  renameTreasuryBox,
  revokeTreasuryAuditKey,
  treasuryBoxRef,
} from './boxService.js';
import type { BoxStore, StoredTreasuryAuditKey } from './boxStore.js';
import {
  MAX_ACTIVE_TREASURY_AUDIT_KEYS,
  type BoxAuditEvent,
  type TreasuryBoxMetadata,
  type TreasuryBoxRef,
} from '../src/stellar/boxTypes.js';

class MemoryBoxStore implements BoxStore {
  metadata = new Map<string, TreasuryBoxMetadata>();
  keys = new Map<string, StoredTreasuryAuditKey>();
  audit: BoxAuditEvent[] = [];
  key(box: TreasuryBoxRef) { return `${box.network}:${box.accountId}`; }
  async getMetadata(box: TreasuryBoxRef) { return this.metadata.get(this.key(box)) ?? null; }
  async putMetadata(value: TreasuryBoxMetadata) { this.metadata.set(this.key(value.box), value); }
  async listAuditKeys(box: TreasuryBoxRef) { return [...this.keys.values()].filter((key) => this.key(key.box) === this.key(box)); }
  async getAuditKey(keyId: string) { return this.keys.get(keyId) ?? null; }
  async putAuditKey(key: StoredTreasuryAuditKey) { this.keys.set(key.keyId, key); }
  async touchAuditKey(keyId: string, usedAt: string) { const key = this.keys.get(keyId); if (key) this.keys.set(keyId, { ...key, lastUsedAt: usedAt }); }
  async listAuditEvents(box: TreasuryBoxRef) { return this.audit.filter((event) => this.key(event.box) === this.key(box)); }
  async putAuditEvent(event: BoxAuditEvent) { this.audit.push(event); }
}

function transaction(source: Keypair, operationSource?: Keypair) {
  return new TransactionBuilder(new Account(source.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({
      destination: Keypair.random().publicKey(),
      asset: Asset.native(),
      amount: '1',
      ...(operationSource ? { source: operationSource.publicKey() } : {}),
    }))
    .setTimeout(TimeoutInfinite)
    .build();
}

test('Treasury-specific XDR assertion still rejects another transaction or operation source', () => {
  const source = Keypair.random();
  const other = Keypair.random();
  const box = treasuryBoxRef('testnet', source.publicKey());
  assert.doesNotThrow(() => assertTreasuryProposalBound(box, 'testnet', transaction(source).toXdr()));
  assert.throws(() => assertTreasuryProposalBound(box, 'public', transaction(source).toXdr()), (cause: unknown) => cause instanceof BoxServiceError && cause.code === 'box_network_mismatch');
  assert.throws(() => assertTreasuryProposalBound(box, 'testnet', transaction(other).toXdr()), (cause: unknown) => cause instanceof BoxServiceError && cause.code === 'box_source_mismatch');
  assert.throws(() => assertTreasuryProposalBound(box, 'testnet', transaction(source, other).toXdr()), (cause: unknown) => cause instanceof BoxServiceError && cause.code === 'box_multi_source_denied');
});

test('Treasury Audit credential is shown once, stored hashed, and revocable', async () => {
  const store = new MemoryBoxStore();
  const signer = Keypair.random().publicKey();
  const box = treasuryBoxRef('testnet', Keypair.random().publicKey());
  const created = await createTreasuryAuditKey(store, box, 'External auditor', signer, new Date('2026-09-04T00:00:00Z'));
  assert.match(created.auditKey, /^mta_/);
  const stored = await store.getAuditKey(created.key.keyId);
  assert.ok(stored);
  assert.equal(stored.label, 'External auditor');
  assert.equal('auditKey' in stored, false);
  assert.notEqual(stored.secretHash, created.auditKey);
  assert.equal((await authenticateTreasuryAuditKey(store, created.auditKey)).keyId, created.key.keyId);

  const revoked = await revokeTreasuryAuditKey(store, box, created.key.keyId, signer, new Date('2026-09-04T00:01:00Z'));
  assert.equal(revoked.revokedBy, signer);
  await assert.rejects(() => authenticateTreasuryAuditKey(store, created.auditKey), (cause: unknown) => cause instanceof BoxServiceError && cause.code === 'audit_credential_revoked');
  assert.deepEqual(store.audit.map((event) => event.action), ['audit_credential_created', 'audit_credential_revoked']);
  assert.ok(store.audit.every((event) => !JSON.stringify(event).includes(created.auditKey)));
});

test('Treasury limits active Audit credentials and revoked credentials release capacity', async () => {
  const store = new MemoryBoxStore();
  const signer = Keypair.random().publicKey();
  const box = treasuryBoxRef('testnet', Keypair.random().publicKey());
  const created = [];
  for (let index = 0; index < MAX_ACTIVE_TREASURY_AUDIT_KEYS; index += 1) {
    created.push(await createTreasuryAuditKey(store, box, `Auditor ${index + 1}`, signer));
  }
  assert.equal((await store.listAuditKeys(box)).filter((key) => !key.revokedAt).length, MAX_ACTIVE_TREASURY_AUDIT_KEYS);
  await assert.rejects(() => createTreasuryAuditKey(store, box, 'One too many', signer), (cause: unknown) => cause instanceof BoxServiceError && cause.code === 'audit_credential_limit_reached');
  await revokeTreasuryAuditKey(store, box, created[0].key.keyId, signer);
  const replacement = await createTreasuryAuditKey(store, box, 'Replacement auditor', signer);
  assert.match(replacement.auditKey, /^mta_/);
});

test('shared Treasury names remain normalized private metadata', () => {
  assert.equal(normalizeTreasuryName('  Operations   Treasury  '), 'Operations Treasury');
  assert.throws(() => normalizeTreasuryName('Operations\u0000Treasury'), (cause: unknown) => cause instanceof BoxServiceError && cause.code === 'invalid_treasury_name');
});

test('Treasury rename remains append-only audited by Stellar actor', async () => {
  const store = new MemoryBoxStore();
  const box = treasuryBoxRef('testnet', Keypair.random().publicKey());
  const alice = Keypair.random().publicKey();
  const bob = Keypair.random().publicKey();
  await renameTreasuryBox(store, box, 'Operations Treasury', alice, new Date('2026-09-04T02:00:00Z'));
  await renameTreasuryBox(store, box, 'Reserve Treasury', bob, new Date('2026-09-04T02:01:00Z'));
  assert.equal((await store.getMetadata(box))?.name, 'Reserve Treasury');
  assert.deepEqual(store.audit.map((event) => event.action), ['box_name_changed', 'box_name_changed']);
  assert.equal(store.audit[0].actor.type, 'stellar');
  assert.equal(store.audit[1].metadata?.previousName, 'Operations Treasury');
});
