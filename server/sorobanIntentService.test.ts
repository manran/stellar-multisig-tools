import assert from 'node:assert/strict';
import test from 'node:test';
import { Contract, Keypair, nativeToScVal, xdr } from '@stellar/stellar-sdk/base';
import { createSorobanAuthorizationPlan } from '../src/stellar/sorobanAuthorizationPlan.js';
import { createSorobanIntent, materializeSorobanIntent } from '../src/stellar/sorobanIntent.js';
import { createStoredSorobanIntent, SorobanIntentServiceError } from './sorobanIntentService.js';
import type { SorobanIntentStore, StoredSorobanIntent } from './sorobanIntentStore.js';

class MemoryIntentStore implements SorobanIntentStore {
  values = new Map<string, StoredSorobanIntent>();
  async createIntent(value: StoredSorobanIntent) { this.values.set(value.id, value); }
  async getIntent(id: string) { return this.values.get(id) ?? null; }
  async updateIntent(value: StoredSorobanIntent) { this.values.set(value.id, value); }
}

function fixture(invoice = 'invoice-42') {
  const contract = new Contract('CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE');
  const args = new xdr.InvokeContractArgs({
    contractAddress: contract.address().toScAddress(),
    functionName: 'approve_invoice',
    args: [nativeToScVal(invoice)],
  });
  const intent = createSorobanIntent('testnet', xdr.HostFunction.hostFunctionTypeInvokeContract(args));
  return { intent, args };
}
test('stores Intent, AuthorizationPlan and off-chain context without a transaction shell', async () => {
  const store = new MemoryIntentStore();
  const { intent } = fixture();
  const source = Keypair.random();
  const prepared = materializeSorobanIntent({
    intent,
    sourceAccount: source.publicKey(),
    sourceSequence: '1',
    fee: '100',
    lifetimeSeconds: 3600,
  });
  const plan = createSorobanAuthorizationPlan(intent, prepared.toXDR());
  const stored = await createStoredSorobanIntent(store, {
    intent,
    authorizationPlan: plan,
    creatorAddress: source.publicKey(),
    privateNote: 'Payroll approval',
    externalReference: 'erp-42',
  }, { idFactory: () => 'A'.repeat(16), now: new Date('2026-09-14T00:00:00Z') });

  assert.equal(stored.id, 'A'.repeat(16));
  assert.equal(stored.authorizationPlan?.intentDigest, intent.intentDigest);
  assert.equal(stored.privateContext?.initialPrivateNote?.text, 'Payroll approval');
  assert.equal(stored.privateContext?.externalReference, 'erp-42');
  assert.equal('baseXdr' in stored, false);
  assert.equal('transactionSource' in stored, false);
});
test('stores an execution-source requirement without persisting a transient source-bound plan', async () => {
  const store = new MemoryIntentStore();
  const { intent } = fixture();
  const creator = Keypair.random();
  const stored = await createStoredSorobanIntent(store, {
    intent,
    planningRequirement: 'execution_source',
    creatorAddress: creator.publicKey(),
  }, { idFactory: () => 'B'.repeat(16) });

  assert.equal(stored.planningRequirement, 'execution_source');
  assert.equal(stored.authorizationPlan, undefined);
});

test('rejects mismatched or incomplete authorization planning state', async () => {
  const store = new MemoryIntentStore();
  const first = fixture('invoice-42').intent;
  const second = fixture('invoice-43').intent;
  const source = Keypair.random();
  const plan = createSorobanAuthorizationPlan(second, materializeSorobanIntent({
    intent: second,
    sourceAccount: source.publicKey(),
    sourceSequence: '1',
    fee: '100',
    lifetimeSeconds: 3600,
  }).toXDR());

  await assert.rejects(
    () => createStoredSorobanIntent(store, { intent: first, authorizationPlan: plan, creatorAddress: source.publicKey() }),
    (cause: unknown) => cause instanceof SorobanIntentServiceError && cause.code === 'authorization_plan_mismatch',
  );
  await assert.rejects(
    () => createStoredSorobanIntent(store, { intent: first, creatorAddress: source.publicKey() }),
    (cause: unknown) => cause instanceof SorobanIntentServiceError && cause.code === 'authorization_plan_required',
  );
});
