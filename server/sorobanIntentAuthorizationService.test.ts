import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Address,
  Contract,
  Keypair,
  hash,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk/base';
import {
  initializeSorobanGAccountAuthorizationWindow,
  sorobanAuthorizationEntryPreimageXdr,
} from '../src/stellar/sorobanAuthorization.js';
import { createSorobanAuthorizationPlan, authorizationEntriesFromPlan } from '../src/stellar/sorobanAuthorizationPlan.js';
import { createSorobanIntent, materializeSorobanIntent } from '../src/stellar/sorobanIntent.js';
import { createStoredSorobanIntent } from './sorobanIntentService.js';
import {
  contributeSorobanIntentAuthorization,
  getSorobanIntentAuthorization,
} from './sorobanIntentAuthorizationService.js';
import type {
  SorobanIntentStore,
  StoredSorobanIntent,
  StoredSorobanIntentAuthorizationContribution,
} from './sorobanIntentStore.js';
class MemoryIntentStore implements SorobanIntentStore {
  values = new Map<string, StoredSorobanIntent>();
  contributions = new Map<string, StoredSorobanIntentAuthorizationContribution[]>();
  async createIntent(value: StoredSorobanIntent) { this.values.set(value.id, value); }
  async getIntent(id: string) { return this.values.get(id) ?? null; }
  async updateIntent(value: StoredSorobanIntent) { this.values.set(value.id, value); }
  async listContributions(id: string) { return this.contributions.get(id) ?? []; }
  async putContribution(id: string, contribution: StoredSorobanIntentAuthorizationContribution) {
    const current = this.contributions.get(id) ?? [];
    const withoutSame = current.filter((item) => item.digest !== contribution.digest);
    this.contributions.set(id, [...withoutSame, contribution]);
  }
}

function accountSnapshot(authorizer: string, signerA: string, signerB: string) {
  return {
    accountId: authorizer,
    sequence: '1',
    subentryCount: 2,
    numSponsoring: 0,
    numSponsored: 0,
    thresholds: { low: 1, medium: 2, high: 2 },
    signers: [
      { key: signerA, type: 'ed25519_public_key' as const, weight: 1 },
      { key: signerB, type: 'ed25519_public_key' as const, weight: 1 },
    ],
  };
}
async function fixture() {
  const authorizer = Keypair.random();
  const signerA = Keypair.random();
  const signerB = Keypair.random();
  const source = Keypair.random();
  const contract = new Contract('CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE');
  const args = new xdr.InvokeContractArgs({
    contractAddress: contract.address().toScAddress(),
    functionName: 'approve_invoice',
    args: [nativeToScVal(authorizer.publicKey()), nativeToScVal('invoice-42')],
  });
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(args),
    subInvocations: [],
  });
  const auth = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(new xdr.SorobanAddressCredentials({
      address: new Address(authorizer.publicKey()).toScAddress(),
      nonce: xdr.Int64(42n),
      signatureExpirationLedger: 0,
      signature: xdr.ScVal.scvVoid(),
    })),
    rootInvocation: invocation,
  });
  const intent = createSorobanIntent('testnet', xdr.HostFunction.hostFunctionTypeInvokeContract(args));
  const raw = materializeSorobanIntent({
    intent,
    sourceAccount: source.publicKey(),
    sourceSequence: '7',
    fee: '100',
    lifetimeSeconds: 300,
    authorizationEntries: [auth],
  });
  const initialized = await initializeSorobanGAccountAuthorizationWindow({
    envelopeXdr: raw.toXDR(),
    network: 'testnet',
    currentLedger: 100,
  });
  const plan = createSorobanAuthorizationPlan(intent, initialized);
  const store = new MemoryIntentStore();
  const stored = await createStoredSorobanIntent(store, {
    intent,
    authorizationPlan: plan,
    creatorAddress: signerA.publicKey(),
  }, { idFactory: () => 'I'.repeat(16), now: new Date('2026-09-14T10:00:00Z') });
  const snapshot = accountSnapshot(authorizer.publicKey(), signerA.publicKey(), signerB.publicKey());
  const options = {
    accountLoader: async () => snapshot,
    networkParametersLoader: async () => ({ ledgerSequence: 100, ledgerClosedAt: '2026-09-14T10:00:00Z', baseFeeInStroops: 100, baseReserveInStroops: 5_000_000 }),
  };
  return { store, stored, plan, signerA, signerB, options };
}
function signatureFor(
  plan: Awaited<ReturnType<typeof fixture>>['plan'],
  signer: Keypair,
): string {
  const entry = authorizationEntriesFromPlan(plan)[0];
  const preimageXdr = sorobanAuthorizationEntryPreimageXdr({
    entry,
    network: 'testnet',
    expirationLedger: 460,
  });
  const preimage = xdr.HashIdPreimage.fromXdr(preimageXdr, 'base64');
  return Buffer.from(signer.sign(hash(preimage.toXdr()))).toString('base64');
}

test('Intent AUTH contributions are append-only and become ready at live threshold', async () => {
  const f = await fixture();
  const initial = await getSorobanIntentAuthorization(f.store, f.stored.id, f.options);
  assert.equal(initial.status, 'awaiting_authorization');
  assert.equal(initial.contributionCount, 0);
  assert.equal(initial.authorizers[0]?.signedWeight, 0);

  const first = await contributeSorobanIntentAuthorization(f.store, f.stored.id, {
    entryIndex: 0,
    signerAddress: f.signerA.publicKey(),
    signatureBase64: signatureFor(f.plan, f.signerA),
  }, f.options);
  assert.equal(first.added, true);
  assert.equal(first.authorization.status, 'awaiting_authorization');
  assert.equal(first.authorization.authorizers[0]?.signedWeight, 1);
  const duplicate = await contributeSorobanIntentAuthorization(f.store, f.stored.id, {
    entryIndex: 0,
    signerAddress: f.signerA.publicKey(),
    signatureBase64: signatureFor(f.plan, f.signerA),
  }, f.options);
  assert.equal(duplicate.added, false);
  assert.equal(duplicate.authorization.contributionCount, 1);

  const second = await contributeSorobanIntentAuthorization(f.store, f.stored.id, {
    entryIndex: 0,
    signerAddress: f.signerB.publicKey(),
    signatureBase64: signatureFor(f.plan, f.signerB),
  }, f.options);
  assert.equal(second.added, true);
  assert.equal(second.authorization.status, 'authorization_ready');
  assert.equal(second.authorization.contributionCount, 2);
  assert.equal(second.authorization.authorizers[0]?.signedWeight, 2);

  const readyReplay = await contributeSorobanIntentAuthorization(f.store, f.stored.id, {
    entryIndex: 0,
    signerAddress: f.signerB.publicKey(),
    signatureBase64: signatureFor(f.plan, f.signerB),
  }, f.options);
  assert.equal(readyReplay.added, false);
  assert.equal(readyReplay.authorization.status, 'authorization_ready');
  assert.equal(readyReplay.authorization.contributionCount, 2);

  const persisted = await f.store.getIntent(f.stored.id);
  assert.equal(persisted?.authorizationPlan?.authorizationPlanDigest, f.plan.authorizationPlanDigest);
  assert.deepEqual(persisted?.authorizationPlan?.authorizationEntriesXdr, f.plan.authorizationEntriesXdr);
});

test('Intent AUTH rejects a signer outside the current authorizer policy', async () => {
  const f = await fixture();
  const outsider = Keypair.random();
  await assert.rejects(
    () => contributeSorobanIntentAuthorization(f.store, f.stored.id, {
      entryIndex: 0,
      signerAddress: outsider.publicKey(),
      signatureBase64: signatureFor(f.plan, outsider),
    }, f.options),
    (cause: unknown) => cause instanceof Error && 'code' in cause && cause.code === 'authorization_signer_not_current',
  );
});
