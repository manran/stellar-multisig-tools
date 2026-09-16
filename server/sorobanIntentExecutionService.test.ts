import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Address,
  Contract,
  FeeBumpTransaction,
  Keypair,
  Networks,
  SorobanDataBuilder,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk/base';
import { createSorobanAuthorizationPlan } from '../src/stellar/sorobanAuthorizationPlan.js';
import { emptySorobanEffectsSnapshot, sorobanEffectsSnapshot, type SorobanEffectsSnapshot } from '../src/stellar/sorobanEffects.js';
import { createSorobanIntent, materializeSorobanIntent } from '../src/stellar/sorobanIntent.js';
import {
  prepareSorobanIntentExecution,
  SorobanIntentExecutionServiceError,
} from './sorobanIntentExecutionService.js';
import type { SorobanIntentAuthorizationSnapshot } from './sorobanIntentAuthorizationService.js';
import type { SorobanIntentStore, StoredSorobanIntent, StoredSorobanIntentExecutionPreparation } from './sorobanIntentStore.js';

class MemoryIntentStore implements SorobanIntentStore {
  readonly preparations: StoredSorobanIntentExecutionPreparation[] = [];
  constructor(readonly stored: StoredSorobanIntent) {}
  async createIntent() { throw new Error('not used'); }
  async getIntent(id: string) { return id === this.stored.id ? this.stored : null; }
  async updateIntent() { throw new Error('not used'); }
  async listContributions() { return []; }
  async putContribution() { throw new Error('not used'); }
  async listExecutionPreparations() { return this.preparations; }
  async putExecutionPreparation(_id: string, preparation: StoredSorobanIntentExecutionPreparation) { this.preparations.push(preparation); }
}
function fixture(effects: SorobanEffectsSnapshot = emptySorobanEffectsSnapshot()) {
  const contract = new Contract('CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE');
  const authorizer = Keypair.random();
  const planningSource = Keypair.random();
  const args = new xdr.InvokeContractArgs({
    contractAddress: contract.address().toScAddress(),
    functionName: 'authorize',
    args: [nativeToScVal(authorizer.publicKey(), { type: 'address' }), nativeToScVal(7, { type: 'u32' })],
  });
  const intent = createSorobanIntent('testnet', xdr.HostFunction.hostFunctionTypeInvokeContract(args));
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(args),
    subInvocations: [],
  });
  const authEntry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(new xdr.SorobanAddressCredentials({
      address: new Address(authorizer.publicKey()).toScAddress(),
      nonce: xdr.Int64(42n),
      signatureExpirationLedger: 460,
      signature: xdr.ScVal.scvVoid(),
    })),
    rootInvocation: invocation,
  });
  const planningTx = materializeSorobanIntent({
    intent,
    sourceAccount: planningSource.publicKey(),
    sourceSequence: '3',
    fee: '100',
    lifetimeSeconds: 300,
    authorizationEntries: [authEntry],
    sorobanData: new SorobanDataBuilder().build(),
  });
  const plan = createSorobanAuthorizationPlan(intent, planningTx.toXDR(), effects);
  const stored: StoredSorobanIntent = {
    version: 1,
    id: 'E'.repeat(16),
    network: 'testnet',
    intent,
    authorizationPlan: plan,
    createdAt: '2026-09-14T00:00:00.000Z',
    creatorAddress: authorizer.publicKey(),
    discoverySignerKeys: [authorizer.publicKey()],
  };
  const authorization: SorobanIntentAuthorizationSnapshot = {
    id: stored.id,
    network: 'testnet',
    intentDigest: intent.intentDigest,
    authorizationPlanDigest: plan.authorizationPlanDigest,
    executionBinding: 'detached',
    status: 'authorization_ready',
    authorizationEntriesXdr: [authEntry.toXdr('base64')],
    contributionCount: 1,
    authorizers: [],
  };
  return { stored, authorization, authEntry };
}

test('execution late-binds a fresh source and preserves finalized detached AUTH', async () => {
  const f = fixture();
  const source = Keypair.random();
  const store = new MemoryIntentStore(f.stored);
  let enforcedInput = '';
  const result = await prepareSorobanIntentExecution(store, f.stored.id, source.publicKey(), {
    authorization: f.authorization,
    accountLoader: async () => ({ accountId: source.publicKey(), sequence: '7' } as never),
    networkParametersLoader: async () => ({ baseFeeInStroops: 100 } as never),
    enforcer: async ({ envelopeXdr }) => {
      enforcedInput = envelopeXdr;
      return { endpointUrl: 'test', latestLedger: 123, assembledXdr: envelopeXdr, effects: f.stored.authorizationPlan.effects };
    },
    preparedByAddress: f.stored.creatorAddress,
    preparedBy: { type: 'agent', id: 'agent-a', label: 'Agent A', principalAddress: f.stored.creatorAddress! },
    now: new Date('2026-09-16T00:00:00.000Z'),
  });
  const parsed = TransactionBuilder.fromXdr(enforcedInput, Networks.TESTNET);
  if (parsed instanceof FeeBumpTransaction) throw new Error('unexpected fee bump');
  assert.equal(parsed.source, source.publicKey());
  assert.equal(parsed.sequence, '8');
  assert.equal(parsed.operations[0]?.type, 'invokeHostFunction');
  if (parsed.operations[0]?.type !== 'invokeHostFunction') throw new Error('missing invokeHostFunction');
  assert.equal(parsed.operations[0].auth?.[0]?.toXdr('base64'), f.authEntry.toXdr('base64'));
  assert.equal(result.executionSource, source.publicKey());
  assert.equal(result.transactionSequence, '8');
  assert.equal(result.latestLedger, 123);
  assert.equal(result.authorizationPlanDigest, f.stored.authorizationPlan.authorizationPlanDigest);
  assert.equal(result.xdr, enforcedInput);
  assert.equal(store.preparations.length, 1);
  assert.equal(store.preparations[0]?.transactionHash, result.transactionHash);
  assert.equal(store.preparations[0]?.executionSource, source.publicKey());
  assert.equal(store.preparations[0]?.preparedAt, '2026-09-16T00:00:00.000Z');
  assert.equal(store.preparations[0]?.preparedByAddress, f.stored.creatorAddress);
  assert.deepEqual(store.preparations[0]?.preparedBy, { type: 'agent', id: 'agent-a', label: 'Agent A', principalAddress: f.stored.creatorAddress });
});

test('execution fails closed when durable preparation evidence cannot be stored', async () => {
  const f = fixture();
  const source = Keypair.random();
  const store: SorobanIntentStore = {
    async createIntent() { throw new Error('not used'); },
    async getIntent(id) { return id === f.stored.id ? f.stored : null; },
    async updateIntent() { throw new Error('not used'); },
    async listContributions() { return []; },
    async putContribution() { throw new Error('not used'); },
  };
  await assert.rejects(
    () => prepareSorobanIntentExecution(store, f.stored.id, source.publicKey(), {
      authorization: f.authorization,
      accountLoader: async () => ({ accountId: source.publicKey(), sequence: '7' } as never),
      networkParametersLoader: async () => ({ baseFeeInStroops: 100 } as never),
      enforcer: async ({ envelopeXdr }) => ({ endpointUrl: 'test', latestLedger: 123, assembledXdr: envelopeXdr, effects: f.stored.authorizationPlan.effects }),
    }),
    (cause: unknown) => cause instanceof SorobanIntentExecutionServiceError
      && cause.code === 'intent_execution_evidence_unavailable',
  );
});

test('execution refuses to materialize before detached AUTH is ready', async () => {
  const f = fixture();
  const store = new MemoryIntentStore(f.stored);
  await assert.rejects(
    () => prepareSorobanIntentExecution(store, f.stored.id, Keypair.random().publicKey(), {
      authorization: { ...f.authorization, status: 'awaiting_authorization' },
      accountLoader: async () => { throw new Error('account loader must not run'); },
    }),
    (cause: unknown) => cause instanceof SorobanIntentExecutionServiceError
      && cause.code === 'intent_authorization_not_ready',
  );
});


test('execution can be rematerialized with a fresh source sequence without changing detached AUTH', async () => {
  const f = fixture();
  const source = Keypair.random();
  const store = new MemoryIntentStore(f.stored);
  let sequence = '7';
  const options = {
    authorization: f.authorization,
    accountLoader: async () => ({ accountId: source.publicKey(), sequence } as never),
    networkParametersLoader: async () => ({ baseFeeInStroops: 100 } as never),
    enforcer: async ({ envelopeXdr }: { envelopeXdr: string }) => ({ endpointUrl: 'test', latestLedger: 123, assembledXdr: envelopeXdr, effects: f.stored.authorizationPlan.effects }),
  };
  const first = await prepareSorobanIntentExecution(store, f.stored.id, source.publicKey(), options);
  sequence = '8';
  const second = await prepareSorobanIntentExecution(store, f.stored.id, source.publicKey(), options);
  assert.equal(first.transactionSequence, '8');
  assert.equal(second.transactionSequence, '9');
  assert.notEqual(second.transactionHash, first.transactionHash);
  for (const xdrValue of [first.xdr, second.xdr]) {
    const parsed = TransactionBuilder.fromXdr(xdrValue, Networks.TESTNET);
    if (parsed instanceof FeeBumpTransaction) throw new Error('unexpected fee bump');
    const operation = parsed.operations[0];
    assert.equal(operation?.type, 'invokeHostFunction');
    if (operation?.type !== 'invokeHostFunction') throw new Error('missing invokeHostFunction');
    assert.equal(operation.auth?.[0]?.toXdr('base64'), f.authEntry.toXdr('base64'));
  }
});

function effectSnapshot(amount: number, topic = 'transfer') {
  const event = new xdr.ContractEvent({
    ext: xdr.ExtensionPoint.v0(),
    contractId: null,
    type: xdr.ContractEventType.contract,
    body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({
      topics: [nativeToScVal(topic)],
      data: nativeToScVal(amount, { type: 'u32' }),
    })),
  });
  return sorobanEffectsSnapshot([], [new xdr.DiagnosticEvent({ inSuccessfulContractCall: true, event }).toXdr('base64')]);
}

function executionOptions(f: ReturnType<typeof fixture>, source: Keypair, effects: SorobanEffectsSnapshot) {
  return {
    authorization: f.authorization,
    accountLoader: async () => ({ accountId: source.publicKey(), sequence: '7' } as never),
    networkParametersLoader: async () => ({ baseFeeInStroops: 100 } as never),
    enforcer: async ({ envelopeXdr }: { envelopeXdr: string }) => ({ endpointUrl: 'test', latestLedger: 123, assembledXdr: envelopeXdr, effects }),
  };
}

test('small numeric effects drift stays executable and returns the measured diff', async () => {
  const expected = effectSnapshot(100);
  const current = effectSnapshot(99);
  const f = fixture(expected);
  const source = Keypair.random();
  const result = await prepareSorobanIntentExecution(new MemoryIntentStore(f.stored), f.stored.id, source.publicKey(), executionOptions(f, source, current));
  assert.equal(result.effectsDiff.kind, 'numeric');
  assert.equal(result.effectsDiff.maxChangeBasisPoints, 100);
  assert.equal(result.effectsDiff.requiresExplicitReview, false);
  assert.equal(result.effectsAccepted, false);
});

test('exact-effects execution policy rejects drift before persisting execution evidence', async () => {
  const expected = effectSnapshot(100);
  const current = effectSnapshot(99);
  const f = fixture(expected);
  const source = Keypair.random();
  const store = new MemoryIntentStore(f.stored);
  await assert.rejects(
    () => prepareSorobanIntentExecution(store, f.stored.id, source.publicKey(), {
      ...executionOptions(f, source, current),
      requireExactEffects: true,
    }),
    (cause: unknown) => cause instanceof SorobanIntentExecutionServiceError
      && cause.code === 'intent_execution_effects_reauthorization_required',
  );
  assert.equal(store.preparations.length, 0);
});

test('large numeric effects drift blocks until the current digest is explicitly accepted', async () => {
  const expected = effectSnapshot(100);
  const current = effectSnapshot(90);
  const f = fixture(expected);
  const source = Keypair.random();
  const store = new MemoryIntentStore(f.stored);
  await assert.rejects(
    () => prepareSorobanIntentExecution(store, f.stored.id, source.publicKey(), executionOptions(f, source, current)),
    (cause: unknown) => cause instanceof SorobanIntentExecutionServiceError
      && cause.status === 409
      && cause.code === 'intent_execution_effects_review_required'
      && (cause.details as { effectsDiff?: { currentDigest?: string } } | undefined)?.effectsDiff?.currentDigest === current.digest,
  );
  const accepted = await prepareSorobanIntentExecution(store, f.stored.id, source.publicKey(), {
    ...executionOptions(f, source, current),
    acceptedEffectsDigest: current.digest,
  });
  assert.equal(accepted.effectsDiff.severity, 'critical');
  assert.equal(accepted.effectsAccepted, true);
});

test('effects acceptance is bound to the exact enforcing digest', async () => {
  const expected = effectSnapshot(100);
  const reviewed = effectSnapshot(90);
  const changedAgain = effectSnapshot(80);
  const f = fixture(expected);
  const source = Keypair.random();
  await assert.rejects(
    () => prepareSorobanIntentExecution(new MemoryIntentStore(f.stored), f.stored.id, source.publicKey(), {
      ...executionOptions(f, source, changedAgain),
      acceptedEffectsDigest: reviewed.digest,
    }),
    (cause: unknown) => cause instanceof SorobanIntentExecutionServiceError
      && cause.code === 'intent_execution_effects_review_required'
      && (cause.details as { effectsDiff?: { currentDigest?: string } } | undefined)?.effectsDiff?.currentDigest === changedAgain.digest,
  );
});

test('structural effects changes require a new authorization revision and cannot be digest-accepted', async () => {
  const expected = effectSnapshot(100, 'transfer');
  const current = effectSnapshot(99, 'mint');
  const f = fixture(expected);
  const source = Keypair.random();
  await assert.rejects(
    () => prepareSorobanIntentExecution(new MemoryIntentStore(f.stored), f.stored.id, source.publicKey(), {
      ...executionOptions(f, source, current),
      acceptedEffectsDigest: current.digest,
    }),
    (cause: unknown) => cause instanceof SorobanIntentExecutionServiceError
      && cause.code === 'intent_execution_effects_reauthorization_required'
      && (cause.details as { effectsDiff?: { kind?: string; requiresReauthorization?: boolean } } | undefined)?.effectsDiff?.kind === 'structural'
      && (cause.details as { effectsDiff?: { requiresReauthorization?: boolean } } | undefined)?.effectsDiff?.requiresReauthorization === true,
  );
});
