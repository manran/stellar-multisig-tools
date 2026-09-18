import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Address,
  Contract,
  Keypair,
  SorobanDataBuilder,
  hash,
  inspectAuthEntry,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk/base';
import { sorobanAuthorizationEntryPreimageXdr } from '../../../../src/stellar/sorobanAuthorization.js';
import { authorizationEntriesFromPlan, createSorobanAuthorizationPlan } from '../../../../src/stellar/sorobanAuthorizationPlan.js';
import { emptySorobanEffectsSnapshot, sorobanEffectsSnapshot } from '../../../../src/stellar/sorobanEffects.js';
import { createSorobanIntent, materializeSorobanIntent } from '../../../../src/stellar/sorobanIntent.js';
import { contributeSorobanIntentAuthorization } from './sorobanIntentAuthorizationService.js';
import { replanExpiredSorobanIntent, SorobanIntentReplanServiceError } from './sorobanIntentReplanService.js';
import { createStoredSorobanIntent } from './sorobanIntentService.js';
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
  async putContribution(id: string, value: StoredSorobanIntentAuthorizationContribution) {
    this.contributions.set(id, [...(this.contributions.get(id) ?? []), value]);
  }
}

function accountSnapshot(authorizer: string) {
  return {
    accountId: authorizer,
    sequence: '1',
    subentryCount: 0,
    numSponsoring: 0,
    numSponsored: 0,
    thresholds: { low: 1, medium: 1, high: 1 },
    signers: [{ key: authorizer, type: 'ed25519_public_key' as const, weight: 1 }],
  };
}

function authorizationEntry(
  authorizer: string,
  args: xdr.InvokeContractArgs,
  nonce: bigint,
  expirationLedger: number,
) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(new xdr.SorobanAddressCredentials({
      address: new Address(authorizer).toScAddress(),
      nonce: xdr.Int64(nonce),
      signatureExpirationLedger: expirationLedger,
      signature: xdr.ScVal.scvVoid(),
    })),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(args),
      subInvocations: [],
    }),
  });
}

async function fixture() {
  const authorizer = Keypair.random();
  const source = Keypair.random();
  const planningSource = Keypair.random();
  const contract = new Contract('CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE');
  const args = new xdr.InvokeContractArgs({
    contractAddress: contract.address().toScAddress(),
    functionName: 'authorize',
    args: [nativeToScVal(authorizer.publicKey(), { type: 'address' }), nativeToScVal(19, { type: 'u32' })],
  });
  const intent = createSorobanIntent('testnet', xdr.HostFunction.hostFunctionTypeInvokeContract(args));
  const oldEntry = authorizationEntry(authorizer.publicKey(), args, 42n, 460);
  const oldTx = materializeSorobanIntent({
    intent,
    sourceAccount: source.publicKey(),
    sourceSequence: '4',
    fee: '100',
    lifetimeSeconds: 300,
    authorizationEntries: [oldEntry],
    sorobanData: new SorobanDataBuilder().build(),
  });
  const oldPlan = createSorobanAuthorizationPlan(intent, oldTx.toXDR(), emptySorobanEffectsSnapshot());
  const store = new MemoryIntentStore();
  const stored = await createStoredSorobanIntent(store, {
    intent,
    authorizationPlan: oldPlan,
    creatorAddress: authorizer.publicKey(),
    discoverySignerKeys: [authorizer.publicKey()],
  }, { idFactory: () => 'R'.repeat(16), now: new Date('2026-09-15T00:00:00Z') });
  const accountLoader = async (address: string) => address === planningSource.publicKey()
    ? ({ accountId: planningSource.publicKey(), sequence: '7' } as never)
    : (accountSnapshot(authorizer.publicKey()) as never);
  const activeAuthorizationDependencies = {
    accountLoader,
    networkParametersLoader: async () => ({
      ledgerSequence: 100,
      ledgerClosedAt: '2026-09-15T00:00:00Z',
      baseFeeInStroops: 100,
      baseReserveInStroops: 5_000_000,
    }),
  };
  const expiredAuthorizationDependencies = {
    ...activeAuthorizationDependencies,
    networkParametersLoader: async () => ({
      ledgerSequence: 460,
      ledgerClosedAt: '2026-09-15T00:30:00Z',
      baseFeeInStroops: 100,
      baseReserveInStroops: 5_000_000,
    }),
  };
  const freshEntry = authorizationEntry(authorizer.publicKey(), args, 99n, 0);
  const freshTx = materializeSorobanIntent({
    intent,
    sourceAccount: planningSource.publicKey(),
    sourceSequence: '7',
    fee: '100',
    lifetimeSeconds: 300,
    authorizationEntries: [freshEntry],
    sorobanData: new SorobanDataBuilder().build(),
  });
  const planningDependencies = {
    accountLoader,
    networkParametersLoader: async () => ({
      ledgerSequence: 500,
      ledgerClosedAt: '2026-09-15T00:35:00Z',
      baseFeeInStroops: 100,
      baseReserveInStroops: 5_000_000,
    }),
    simulator: async () => ({ assembledXdr: freshTx.toXDR(), latestLedger: 500, effects: emptySorobanEffectsSnapshot() } as never),
  };
  return {
    store,
    stored,
    oldPlan,
    authorizer,
    planningSource,
    activeAuthorizationDependencies,
    expiredAuthorizationDependencies,
    planningDependencies,
  };
}

function signatureForPlan(
  plan: Awaited<ReturnType<typeof fixture>>['oldPlan'],
  signer: Keypair,
) {
  const entry = authorizationEntriesFromPlan(plan)[0];
  const expirationLedger = inspectAuthEntry(entry).signatureExpirationLedger ?? 0;
  const preimageXdr = sorobanAuthorizationEntryPreimageXdr({
    entry,
    network: 'testnet',
    expirationLedger,
  });
  const preimage = xdr.HashIdPreimage.fromXdr(preimageXdr, 'base64');
  return Buffer.from(signer.sign(hash(preimage.toXdr()))).toString('base64');
}


function structuralEffectsSnapshot() {
  const event = new xdr.ContractEvent({
    ext: xdr.ExtensionPoint.v0(),
    contractId: null,
    type: xdr.ContractEventType.contract,
    body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({
      topics: [nativeToScVal('unexpected_route')],
      data: nativeToScVal(1, { type: 'u32' }),
    })),
  });
  return sorobanEffectsSnapshot([], [new xdr.DiagnosticEvent({
    inSuccessfulContractCall: true,
    event,
  }).toXdr('base64')]);
}


test('expired plan is replaced by a fresh revision without reusing old AUTH', async () => {
  const f = await fixture();
  const first = await contributeSorobanIntentAuthorization(f.store, f.stored.id, {
    entryIndex: 0,
    signerAddress: f.authorizer.publicKey(),
    signatureBase64: signatureForPlan(f.oldPlan, f.authorizer),
  }, { ...f.activeAuthorizationDependencies });
  assert.equal(first.authorization.status, 'authorization_ready');
  const result = await replanExpiredSorobanIntent(
    f.store,
    f.stored.id,
    f.planningSource.publicKey(),
    {
      now: new Date('2026-09-15T00:35:00Z'),
      authorizationDependencies: f.expiredAuthorizationDependencies,
      planningDependencies: f.planningDependencies,
    },
  );
  assert.equal(result.authorizationPlanRevision, 2);
  assert.equal(result.intent.authorizationPlanRevision, 2);
  assert.equal(result.intent.authorizationPlanHistory?.length, 1);
  assert.equal(result.intent.authorizationPlanHistory?.[0]?.revision, 1);
  assert.equal(
    result.intent.authorizationPlanHistory?.[0]?.authorizationPlan.authorizationPlanDigest,
    f.oldPlan.authorizationPlanDigest,
  );
  assert.equal(result.previousAuthorizationPlanDigest, f.oldPlan.authorizationPlanDigest);
  assert.notEqual(result.intent.authorizationPlan.authorizationPlanDigest, f.oldPlan.authorizationPlanDigest);
  assert.equal(result.authorization.status, 'awaiting_authorization');
  assert.equal(result.authorization.contributionCount, 0);
  assert.equal(result.authorization.authorizers[0]?.signedWeight, 0);
  assert.equal(result.authorization.authorizers[0]?.expirationLedger, 860);
  assert.equal((await f.store.listContributions(f.stored.id)).length, 1);

  const second = await contributeSorobanIntentAuthorization(f.store, f.stored.id, {
    entryIndex: 0,
    signerAddress: f.authorizer.publicKey(),
    signatureBase64: signatureForPlan(result.intent.authorizationPlan, f.authorizer),
  }, {
    ...f.expiredAuthorizationDependencies,
    networkParametersLoader: async () => ({
      ledgerSequence: 500,
      ledgerClosedAt: '2026-09-15T00:35:00Z',
      baseFeeInStroops: 100,
      baseReserveInStroops: 5_000_000,
    }),
  });
  assert.equal(second.authorization.status, 'authorization_ready');
  assert.equal(second.authorization.contributionCount, 1);
  const contributions = await f.store.listContributions(f.stored.id);
  assert.equal(contributions.length, 2);
  assert.equal(contributions[1]?.authorizationPlanRevision, 2);
  assert.equal(
    contributions[1]?.authorizationPlanDigest,
    result.intent.authorizationPlan.authorizationPlanDigest,
  );
});

test('cancelled Intent cannot create a fresh AuthorizationPlan', async () => {
  const f = await fixture();
  await f.store.updateIntent({
    ...f.stored,
    cancellation: {
      version: 1,
      cancelledAt: '2026-09-15T00:31:00.000Z',
      authorizationPlanDigest: f.stored.authorizationPlan.authorizationPlanDigest,
      authorizationPlanRevision: 1,
      cancelledByAddress: f.authorizer.publicKey(),
    },
  });
  await assert.rejects(
    () => replanExpiredSorobanIntent(
      f.store,
      f.stored.id,
      f.planningSource.publicKey(),
      {
        authorizationDependencies: f.expiredAuthorizationDependencies,
        planningDependencies: f.planningDependencies,
      },
    ),
    (cause: unknown) => cause instanceof SorobanIntentReplanServiceError
      && cause.code === 'intent_cancelled',
  );
});

test('re-plan is rejected while the current authorization plan is still active', async () => {
  const f = await fixture();
  let planningCalled = false;
  await assert.rejects(
    () => replanExpiredSorobanIntent(
      f.store,
      f.stored.id,
      f.planningSource.publicKey(),
      {
        authorizationDependencies: f.activeAuthorizationDependencies,
        planningDependencies: {
          ...f.planningDependencies,
          simulator: async () => {
            planningCalled = true;
            throw new Error('must not plan');
          },
        },
      },
    ),
    (cause: unknown) => cause instanceof SorobanIntentReplanServiceError
      && cause.code === 'intent_replan_not_allowed',
  );
  assert.equal(planningCalled, false);
});


test('ready authorization is not re-planned when fresh effects keep the same structure', async () => {
  const f = await fixture();
  const signed = await contributeSorobanIntentAuthorization(f.store, f.stored.id, {
    entryIndex: 0,
    signerAddress: f.authorizer.publicKey(),
    signatureBase64: signatureForPlan(f.oldPlan, f.authorizer),
  }, f.activeAuthorizationDependencies);
  assert.equal(signed.authorization.status, 'authorization_ready');
  await assert.rejects(
    () => replanExpiredSorobanIntent(f.store, f.stored.id, f.planningSource.publicKey(), {
      authorization: signed.authorization,
      authorizationDependencies: f.activeAuthorizationDependencies,
      planningDependencies: f.planningDependencies,
    }),
    (cause: unknown) => cause instanceof SorobanIntentReplanServiceError
      && cause.code === 'intent_replan_not_needed',
  );
});

test('ready authorization is superseded when fresh planning changes effect structure', async () => {
  const f = await fixture();
  const signed = await contributeSorobanIntentAuthorization(f.store, f.stored.id, {
    entryIndex: 0,
    signerAddress: f.authorizer.publicKey(),
    signatureBase64: signatureForPlan(f.oldPlan, f.authorizer),
  }, f.activeAuthorizationDependencies);
  const baselineSimulation = await f.planningDependencies.simulator() as unknown as { assembledXdr: string };
  const changedPlanning = {
    ...f.planningDependencies,
    simulator: async () => ({
      assembledXdr: baselineSimulation.assembledXdr,
      latestLedger: 500,
      effects: structuralEffectsSnapshot(),
    } as never),
  };
  const result = await replanExpiredSorobanIntent(f.store, f.stored.id, f.planningSource.publicKey(), {
    authorization: signed.authorization,
    authorizationDependencies: f.activeAuthorizationDependencies,
    planningDependencies: changedPlanning,
  });
  assert.equal(result.authorizationPlanRevision, 2);
  assert.equal(result.authorization.status, 'awaiting_authorization');
  assert.equal(result.authorization.contributionCount, 0);
  assert.equal(result.intent.authorizationPlanHistory?.[0]?.authorizationPlan.authorizationPlanDigest, f.oldPlan.authorizationPlanDigest);
});
