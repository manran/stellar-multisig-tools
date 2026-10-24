import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Address,
  Contract,
  Keypair,
  SorobanDataBuilder,
  hash,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk/base';
import {
  initializeSorobanGAccountAuthorizationWindow,
  sorobanAuthorizationEntryPreimageXdr,
} from '../../../../packages/stellar-core/src/sorobanAuthorization.js';
import { createSorobanAuthorizationPlan, authorizationEntriesFromPlan } from '../../../../packages/stellar-core/src/sorobanAuthorizationPlan.js';
import { emptySorobanEffectsSnapshot } from '../../../../packages/stellar-core/src/sorobanEffects.js';
import { initializeSorobanContractAccountAuthorizationWindow } from '../../../../packages/stellar-core/src/sorobanCustomAuthorization.js';
import { createSorobanIntent, materializeSorobanIntent } from '../../../../packages/stellar-core/src/sorobanIntent.js';
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
  const plan = createSorobanAuthorizationPlan(intent, initialized, emptySorobanEffectsSnapshot());
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
  return { store, stored, plan, authorizer, signerA, signerB, options };
}
function revisedPlan(f: Awaited<ReturnType<typeof fixture>>, expirationLedger = 820) {
  const previousEntry = authorizationEntriesFromPlan(f.plan)[0];
  const nextEntry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(new xdr.SorobanAddressCredentials({
      address: new Address(f.authorizer.publicKey()).toScAddress(),
      nonce: xdr.Int64(84n),
      signatureExpirationLedger: expirationLedger,
      signature: xdr.ScVal.scvVoid(),
    })),
    rootInvocation: previousEntry.rootInvocation,
  });
  const source = Keypair.random();
  const tx = materializeSorobanIntent({
    intent: f.stored.intent,
    sourceAccount: source.publicKey(),
    sourceSequence: '11',
    fee: '100',
    lifetimeSeconds: 300,
    authorizationEntries: [nextEntry],
  });
  return createSorobanAuthorizationPlan(f.stored.intent, tx.toXDR(), f.stored.authorizationPlan.effects);
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

test('authorization contributions are bound to the current AuthorizationPlan', async () => {
  const f = await fixture();
  await contributeSorobanIntentAuthorization(f.store, f.stored.id, {
    entryIndex: 0,
    signerAddress: f.signerA.publicKey(),
    signatureBase64: signatureFor(f.plan, f.signerA),
  }, f.options);
  const [storedContribution] = await f.store.listContributions(f.stored.id);
  assert.equal(storedContribution.authorizationPlanDigest, f.plan.authorizationPlanDigest);
  assert.equal(storedContribution.authorizationPlanRevision, 1);

  const nextPlan = revisedPlan(f);
  await f.store.updateIntent({
    ...f.stored,
    authorizationPlan: nextPlan,
    authorizationPlanRevision: 2,
  });
  const after = await getSorobanIntentAuthorization(f.store, f.stored.id, f.options);
  assert.equal(after.authorizationPlanDigest, nextPlan.authorizationPlanDigest);
  assert.equal(after.contributionCount, 0);
  assert.equal(after.authorizers[0]?.signedWeight, 0);
  assert.equal((await f.store.listContributions(f.stored.id)).length, 1);
});

test('legacy unbound contributions apply only to revision one', async () => {
  const f = await fixture();
  await contributeSorobanIntentAuthorization(f.store, f.stored.id, {
    entryIndex: 0,
    signerAddress: f.signerA.publicKey(),
    signatureBase64: signatureFor(f.plan, f.signerA),
  }, f.options);
  const [current] = await f.store.listContributions(f.stored.id);
  const { authorizationPlanDigest: _digest, authorizationPlanRevision: _revision, ...legacy } = current;
  f.store.contributions.set(f.stored.id, [legacy]);
  const revisionOne = await getSorobanIntentAuthorization(f.store, f.stored.id, f.options);
  assert.equal(revisionOne.contributionCount, 1);
  assert.equal(revisionOne.authorizers[0]?.signedWeight, 1);

  const nextPlan = revisedPlan(f);
  await f.store.updateIntent({ ...f.stored, authorizationPlan: nextPlan, authorizationPlanRevision: 2 });
  const revisionTwo = await getSorobanIntentAuthorization(f.store, f.stored.id, f.options);
  assert.equal(revisionTwo.contributionCount, 0);
  assert.equal(revisionTwo.authorizers[0]?.signedWeight, 0);
});

test('expired Intent AUTH is visible but refuses further contributions', async () => {
  const f = await fixture();
  const expiredOptions = {
    ...f.options,
    networkParametersLoader: async () => ({ ledgerSequence: 460, ledgerClosedAt: '2026-09-14T10:30:00Z', baseFeeInStroops: 100, baseReserveInStroops: 5_000_000 }),
  };
  const expired = await getSorobanIntentAuthorization(f.store, f.stored.id, expiredOptions);
  assert.equal(expired.status, 'expired');
  assert.equal(expired.authorizers[0]?.expirationLedger, 460);
  await assert.rejects(
    () => contributeSorobanIntentAuthorization(f.store, f.stored.id, {
      entryIndex: 0,
      signerAddress: f.signerA.publicKey(),
      signatureBase64: signatureFor(f.plan, f.signerA),
    }, expiredOptions),
    (cause: unknown) => cause instanceof Error && 'code' in cause && cause.code === 'intent_authorization_not_open',
  );
});

test('cancelled Intent AUTH stays inspectable but refuses further contributions', async () => {
  const f = await fixture();
  await f.store.updateIntent({
    ...f.stored,
    cancellation: {
      version: 1,
      cancelledAt: '2026-09-14T10:05:00.000Z',
      authorizationPlanDigest: f.plan.authorizationPlanDigest,
      authorizationPlanRevision: 1,
      cancelledByAddress: f.signerA.publicKey(),
    },
  });
  const cancelled = await getSorobanIntentAuthorization(f.store, f.stored.id, {
    ...f.options,
    accountLoader: async () => { throw new Error('cancelled state must not require Horizon'); },
    networkParametersLoader: async () => { throw new Error('cancelled state must not require network parameters'); },
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.match(cancelled.statusDetail ?? '', /cannot be revoked/i);
  await assert.rejects(
    () => contributeSorobanIntentAuthorization(f.store, f.stored.id, {
      entryIndex: 0,
      signerAddress: f.signerA.publicKey(),
      signatureBase64: signatureFor(f.plan, f.signerA),
    }, f.options),
    (cause: unknown) => cause instanceof Error && 'code' in cause && cause.code === 'intent_authorization_not_open',
  );
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

const CONTRACT_ACCOUNT = 'CBUGCD3J6RCTJ5RVK7SGDV63JKV7E5YMULD5HAXQ7BGHNLB5DYVVZIEH';

async function withTestnetContractAdapter<T>(ownerAddress: string, run: () => Promise<T>): Promise<T> {
  const contractKey = 'STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_CONTRACT';
  const ownerKey = 'STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_OWNER';
  const previousContract = process.env[contractKey];
  const previousOwner = process.env[ownerKey];
  process.env[contractKey] = CONTRACT_ACCOUNT;
  process.env[ownerKey] = ownerAddress;
  try {
    return await run();
  } finally {
    if (previousContract === undefined) delete process.env[contractKey];
    else process.env[contractKey] = previousContract;
    if (previousOwner === undefined) delete process.env[ownerKey];
    else process.env[ownerKey] = previousOwner;
  }
}

async function contractFixture(owner: Keypair) {
  const source = Keypair.random();
  const contract = new Contract('CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE');
  const args = new xdr.InvokeContractArgs({
    contractAddress: contract.address().toScAddress(),
    functionName: 'authorize',
    args: [nativeToScVal(CONTRACT_ACCOUNT), nativeToScVal(303)],
  });  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(args),
    subInvocations: [],
  });
  const auth = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(new xdr.SorobanAddressCredentials({
      address: new Address(CONTRACT_ACCOUNT).toScAddress(),
      nonce: xdr.Int64(77n),
      signatureExpirationLedger: 0,
      signature: xdr.ScVal.scvVoid(),
    })),
    rootInvocation: invocation,
  });
  const intent = createSorobanIntent('testnet', xdr.HostFunction.hostFunctionTypeInvokeContract(args));
  const raw = materializeSorobanIntent({
    intent,
    sourceAccount: source.publicKey(),
    sourceSequence: '9',
    fee: '100',
    lifetimeSeconds: 300,
    authorizationEntries: [auth],
    sorobanData: new SorobanDataBuilder().build(),
  });
  const initialized = await initializeSorobanContractAccountAuthorizationWindow({
    envelopeXdr: raw.toXDR(),
    network: 'testnet',
    currentLedger: 100,
  });
  const plan = createSorobanAuthorizationPlan(intent, initialized, emptySorobanEffectsSnapshot());
  const store = new MemoryIntentStore();
  const stored = await createStoredSorobanIntent(store, {
    intent,
    authorizationPlan: plan,
    creatorAddress: owner.publicKey(),
  }, { idFactory: () => 'C'.repeat(16), now: new Date('2026-09-14T10:00:00Z') });
  const options = {
    accountLoader: async () => { throw new Error('C-account authorization must not load a Horizon account for the contract address.'); },
    networkParametersLoader: async () => ({
      ledgerSequence: 100,
      ledgerClosedAt: '2026-09-14T10:00:00Z',
      baseFeeInStroops: 100,
      baseReserveInStroops: 5_000_000,
    }),
  };
  return { store, stored, plan, owner, options };
}

function contractSignature(plan: Awaited<ReturnType<typeof contractFixture>>['plan'], owner: Keypair): string {
  const entry = authorizationEntriesFromPlan(plan)[0];
  const preimageXdr = sorobanAuthorizationEntryPreimageXdr({
    entry,
    network: 'testnet',
    expirationLedger: 460,
  });
  const preimage = xdr.HashIdPreimage.fromXdr(preimageXdr, 'base64');
  return Buffer.from(owner.sign(hash(preimage.toXdr()))).toString('base64');
}
test('configured C-account AUTH uses the same Intent contribution lifecycle', async () => {
  const owner = Keypair.random();
  await withTestnetContractAdapter(owner.publicKey(), async () => {
    const f = await contractFixture(owner);
    const initial = await getSorobanIntentAuthorization(f.store, f.stored.id, f.options);
    assert.equal(initial.status, 'awaiting_authorization');
    assert.equal(initial.authorizers[0]?.authorizer, CONTRACT_ACCOUNT);
    assert.equal(initial.authorizers[0]?.activeSigners[0]?.publicKey, owner.publicKey());
    assert.equal(initial.authorizers[0]?.signedWeight, 0);

    const signatureBase64 = contractSignature(f.plan, owner);
    const added = await contributeSorobanIntentAuthorization(f.store, f.stored.id, {
      entryIndex: 0,
      signerAddress: owner.publicKey(),
      signatureBase64,
    }, f.options);
    assert.equal(added.added, true);
    assert.equal(added.authorization.status, 'authorization_ready');
    assert.equal(added.authorization.authorizers[0]?.signedWeight, 1);
    assert.equal(added.authorization.authorizers[0]?.signerEvidence[0]?.publicKey, owner.publicKey());

    const replay = await contributeSorobanIntentAuthorization(f.store, f.stored.id, {
      entryIndex: 0,
      signerAddress: owner.publicKey(),
      signatureBase64,
    }, f.options);
    assert.equal(replay.added, false);
    assert.equal(replay.authorization.contributionCount, 1);

    const persisted = await f.store.getIntent(f.stored.id);
    assert.equal(persisted?.authorizationPlan.authorizationPlanDigest, f.plan.authorizationPlanDigest);
    assert.deepEqual(persisted?.authorizationPlan.authorizationEntriesXdr, f.plan.authorizationEntriesXdr);
  });
});
