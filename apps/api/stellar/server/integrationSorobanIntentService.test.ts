import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Address,
  Contract,
  Keypair,
  SorobanDataBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk/base';
import { Spec } from '@stellar/stellar-sdk/contract';
import { describeContractSpec } from '../../../../src/stellar/contractSpec.js';
import { materializeSorobanIntent } from '../../../../src/stellar/sorobanIntent.js';
import { emptySorobanEffectsSnapshot } from '../../../../src/stellar/sorobanEffects.js';
import type { StellarAccountSnapshot } from '../../../../src/stellar/types.js';
import type { ConfiguredIntegrationCredential } from './integrationCredentialService.js';
import { assertIntegrationSorobanExecutionAccount, createIntegrationSorobanIntent, resolveAndBindIntegrationSorobanExecutor } from './integrationSorobanIntentService.js';
import { getSorobanIntentAuthorization } from './sorobanIntentAuthorizationService.js';
import { listSorobanIntentInbox } from './sorobanIntentInbox.js';
import type { SorobanIntentStore, StoredSorobanIntent } from './sorobanIntentStore.js';

const CONTRACT_ID = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';

class MemoryIntentStore implements SorobanIntentStore {
  values = new Map<string, StoredSorobanIntent>();
  async createIntent(value: StoredSorobanIntent) {
    if (this.values.has(value.id)) throw new Error('duplicate');
    this.values.set(value.id, value);
  }
  async getIntent(id: string) { return this.values.get(id) ?? null; }
  async updateIntent(value: StoredSorobanIntent) { this.values.set(value.id, value); }
  async bindExecutionPolicy(id: string, executionPolicy: StoredSorobanIntent['executionPolicy']) {
    if (!executionPolicy) throw new Error('execution policy required');
    const current = this.values.get(id);
    if (!current) throw new Error('intent not found');
    if (current.executionPolicy?.executor) return current.executionPolicy;
    this.values.set(id, { ...current, executionPolicy });
    return executionPolicy;
  }
  async listIntentsBySigner(network: 'public' | 'testnet', signerAddress: string) {
    return [...this.values.values()].filter((value) => value.network === network && value.discoverySignerKeys.includes(signerAddress));
  }
  async listContributions() { return []; }
  async putContribution() {}
}

function loadedInterface() {
  const addressType = xdr.ScSpecTypeDef.scSpecTypeAddress();
  const entry = xdr.ScSpecEntry.scSpecEntryFunctionV0(new xdr.ScSpecFunctionV0({
    name: 'transfer',
    inputs: [
      new xdr.ScSpecFunctionInputV0({ name: 'from', type: addressType, doc: '' }),
      new xdr.ScSpecFunctionInputV0({ name: 'to', type: addressType, doc: '' }),
    ],
    outputs: [],
    doc: '',
  }));
  const spec = new Spec([entry]);
  return { spec, methods: describeContractSpec(spec) };
}

function accountSnapshot(address: string): StellarAccountSnapshot {
  return {
    accountId: address,
    sequence: '1',
    subentryCount: 0,
    numSponsoring: 0,
    numSponsored: 0,
    thresholds: { low: 1, medium: 1, high: 1 },
    signers: [{ key: address, type: 'ed25519_public_key', weight: 1 }],
  };
}

function authEntry(authorizer: string, invocation: xdr.InvokeContractArgs, nonce: bigint) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(new xdr.SorobanAddressCredentials({
      address: new Address(authorizer).toScAddress(),
      nonce: xdr.Int64(nonce),
      signatureExpirationLedger: 0,
      signature: xdr.ScVal.scvVoid(),
    })),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invocation),
      subInvocations: [],
    }),
  });
}

async function fixture() {
  const from = Keypair.random();
  const to = Keypair.random();
  const planningSource = Keypair.random();
  const executor = Keypair.random();
  const invocation = new xdr.InvokeContractArgs({
    contractAddress: new Contract(CONTRACT_ID).address().toScAddress(),
    functionName: 'transfer',
    args: [nativeToScVal(from.publicKey(), { type: 'address' }), nativeToScVal(to.publicKey(), { type: 'address' })],
  });
  const func = xdr.HostFunction.hostFunctionTypeInvokeContract(invocation);
  const intent = {
    version: 1 as const,
    network: 'testnet' as const,
    hostFunctionXdr: func.toXdr('base64'),
    intentDigest: '',
  };
  const builtModule = await import('../../../../src/stellar/sorobanIntent.js');
  const canonicalIntent = builtModule.createSorobanIntent('testnet', func);
  const assembled = materializeSorobanIntent({
    intent: canonicalIntent,
    sourceAccount: planningSource.publicKey(),
    sourceSequence: '7',
    fee: '100',
    lifetimeSeconds: 300,
    authorizationEntries: [
      authEntry(from.publicKey(), invocation, 41n),
      authEntry(to.publicKey(), invocation, 42n),
    ],
    sorobanData: new SorobanDataBuilder().build(),
  });
  const credential: ConfiguredIntegrationCredential = {
    serviceId: 'fednetwork',
    label: 'FedNetwork',
    secretHash: 'ab'.repeat(32),
    networks: ['testnet'],
    classicSourceAccounts: [],
    classicExternalExecutionSourceAccounts: [],
    sorobanContracts: [{ contractId: CONTRACT_ID, methods: ['transfer'] }],
    sorobanExecutionAccounts: [executor.publicKey()],
  };
  const loader = async (address: string) => {
    if (address === from.publicKey() || address === to.publicKey()) return accountSnapshot(address) as never;
    return { accountId: planningSource.publicKey(), sequence: '7' } as never;
  };
  return {
    from,
    to,
    executor,
    credential,
    input: {
      network: 'testnet' as const,
      contractId: CONTRACT_ID,
      method: 'transfer',
      arguments: { from: from.publicKey(), to: to.publicKey() },
      idempotencyKey: 'ownership-transfer-42',
      externalReference: 'fed-transfer-42',
    },
    options: {
      planningSource: planningSource.publicKey(),
      contractDependencies: { interfaceLoader: async () => loadedInterface() },
      planningDependencies: {
        accountLoader: loader,
        networkParametersLoader: async () => ({ baseFeeInStroops: 100 } as never),
        simulator: async () => ({ assembledXdr: assembled.toXDR(), latestLedger: 100, effects: emptySorobanEffectsSnapshot() } as never),
      },
      intentIdFactory: () => 'F'.repeat(16),
    },
    authOptions: {
      accountLoader: loader,
      networkParametersLoader: async () => ({ ledgerSequence: 100 } as never),
    },
  };
}

test('Integration creates one external Soroban Intent and simulation discovers two unrelated authorizers', async () => {
  const f = await fixture();
  const store = new MemoryIntentStore();
  const result = await createIntegrationSorobanIntent(store, f.credential, f.input, f.options);
  assert.equal(result.replayed, false);
  assert.equal(result.intent.creatorAddress, undefined);
  assert.deepEqual(result.intent.creatorActor, { type: 'service', id: 'fednetwork', label: 'FedNetwork' });
  assert.equal(result.intent.executionPolicy?.mode, 'external');
  assert.deepEqual(result.intent.integration, {
    version: 1, serviceId: 'fednetwork', serviceLabel: 'FedNetwork', correlationId: 'fed-transfer-42',
  });
  assert.deepEqual(result.intent.discoverySignerKeys.sort(), [f.from.publicKey(), f.to.publicKey()].sort());
  assert.doesNotThrow(() => assertIntegrationSorobanExecutionAccount(f.credential, 'testnet', f.executor.publicKey()));
  assert.throws(
    () => assertIntegrationSorobanExecutionAccount(f.credential, 'testnet', Keypair.random().publicKey()),
    (cause: unknown) => cause instanceof Error
      && 'code' in cause
      && cause.code === 'integration_execution_account_not_allowed',
  );

  const authorization = await getSorobanIntentAuthorization(store, result.intent.id, f.authOptions);
  assert.equal(authorization.authorizers.length, 2);
  assert.deepEqual(authorization.authorizers.map((item) => item.authorizer).sort(), [f.from.publicKey(), f.to.publicKey()].sort());

  const fromInbox = await listSorobanIntentInbox(store, f.from.publicKey(), 'testnet', f.authOptions);
  const toInbox = await listSorobanIntentInbox(store, f.to.publicKey(), 'testnet', f.authOptions);
  assert.equal(fromInbox[0]?.viewerAction, 'sign');
  assert.equal(toInbox[0]?.viewerAction, 'sign');
  assert.deepEqual(fromInbox[0]?.creatorActor, { type: 'service', id: 'fednetwork', label: 'FedNetwork' });
});

test('Integration Intent is idempotent and exact contract/method scope fails closed', async () => {
  const f = await fixture();
  const store = new MemoryIntentStore();
  const first = await createIntegrationSorobanIntent(store, f.credential, f.input, f.options);
  const replay = await createIntegrationSorobanIntent(store, f.credential, f.input, f.options);
  assert.equal(replay.replayed, true);
  assert.equal(replay.intent.id, first.intent.id);

  const denied = { ...f.credential, sorobanContracts: [{ contractId: CONTRACT_ID, methods: ['other'] }] };
  await assert.rejects(
    () => createIntegrationSorobanIntent(new MemoryIntentStore(), denied, f.input, f.options),
    (cause: unknown) => cause instanceof Error && 'code' in cause && cause.code === 'integration_contract_call_not_allowed',
  );
});

test('Integration executor precedence is Intent override, then snapshotted Service default, then managed fallback', async () => {
  const f = await fixture();
  const defaultExecutor = f.executor.publicKey();
  const overrideExecutor = Keypair.random().publicKey();
  const scoped = {
    ...f.credential,
    sorobanExecutionAccounts: [defaultExecutor, overrideExecutor],
    sorobanDefaultExecutor: defaultExecutor,
  };

  const withOverride = await createIntegrationSorobanIntent(
    new MemoryIntentStore(),
    scoped,
    { ...f.input, idempotencyKey: 'executor-override', executor: overrideExecutor },
    { ...f.options, intentIdFactory: () => 'A'.repeat(16) },
  );
  assert.deepEqual(withOverride.intent.executionPolicy, {
    mode: 'external',
    executor: { address: overrideExecutor, source: 'intent' },
  });

  const withDefault = await createIntegrationSorobanIntent(
    new MemoryIntentStore(),
    scoped,
    { ...f.input, idempotencyKey: 'executor-default' },
    { ...f.options, intentIdFactory: () => 'B'.repeat(16) },
  );
  assert.deepEqual(withDefault.intent.executionPolicy, {
    mode: 'external',
    executor: { address: defaultExecutor, source: 'service_default' },
  });

  const unresolved = await createIntegrationSorobanIntent(
    new MemoryIntentStore(),
    { ...f.credential, sorobanExecutionAccounts: [], sorobanDefaultExecutor: undefined },
    { ...f.input, idempotencyKey: 'executor-unresolved' },
    { ...f.options, intentIdFactory: () => 'C'.repeat(16) },
  );
  assert.deepEqual(unresolved.intent.executionPolicy, {
    mode: 'external', fallback: 'multisigtools_managed',
  });
});

test('contract executor policy selects its bound global executor and rejects an Intent override', async () => {
  const f = await fixture();
  const contractExecutor = f.executor.publicKey();
  const otherExecutor = Keypair.random().publicKey();
  const credential = {
    ...f.credential,
    sorobanContracts: [{
      contractId: CONTRACT_ID,
      methods: ['transfer'],
      execution: { mode: 'external' as const, executor: contractExecutor },
    }],
    sorobanExecutionAccounts: [contractExecutor, otherExecutor],
  };

  const created = await createIntegrationSorobanIntent(
    new MemoryIntentStore(),
    credential,
    { ...f.input, idempotencyKey: 'contract-executor-policy' },
    { ...f.options, intentIdFactory: () => 'D'.repeat(16) },
  );
  assert.deepEqual(created.intent.executionPolicy, {
    mode: 'external',
    executor: { address: contractExecutor, source: 'contract_policy' },
  });

  await assert.rejects(
    () => createIntegrationSorobanIntent(
      new MemoryIntentStore(),
      credential,
      { ...f.input, idempotencyKey: 'contract-executor-override', executor: otherExecutor },
      { ...f.options, intentIdFactory: () => 'E'.repeat(16) },
    ),
    (cause: unknown) => cause instanceof Error
      && 'code' in cause
      && cause.code === 'integration_contract_executor_policy_conflict',
  );
});

test('contract can require MultiSigTools-managed execution and cannot be rebound to a Service executor', async () => {
  const f = await fixture();
  const credential = {
    ...f.credential,
    sorobanContracts: [{
      contractId: CONTRACT_ID,
      methods: ['transfer'],
      execution: { mode: 'multisigtools' as const },
    }],
  };
  const store = new MemoryIntentStore();
  const created = await createIntegrationSorobanIntent(
    store,
    credential,
    { ...f.input, idempotencyKey: 'contract-managed-policy' },
    { ...f.options, intentIdFactory: () => 'G'.repeat(16) },
  );
  assert.deepEqual(created.intent.executionPolicy, { mode: 'multisigtools' });

  await assert.rejects(
    () => resolveAndBindIntegrationSorobanExecutor(
      store,
      created.intent,
      credential,
      f.executor.publicKey(),
      null,
    ),
    (cause: unknown) => cause instanceof Error
      && 'code' in cause
      && cause.code === 'integration_contract_executor_policy_conflict',
  );
});

test('Integration binds a late Service executor once and refresh cannot replace it', async () => {
  const f = await fixture();
  const store = new MemoryIntentStore();
  const secondExecutor = Keypair.random().publicKey();
  const credential = {
    ...f.credential,
    sorobanExecutionAccounts: [f.executor.publicKey(), secondExecutor],
  };
  const created = await createIntegrationSorobanIntent(
    store,
    credential,
    { ...f.input, idempotencyKey: 'late-executor' },
    { ...f.options, intentIdFactory: () => 'D'.repeat(16) },
  );
  const bound = await resolveAndBindIntegrationSorobanExecutor(
    store,
    created.intent,
    credential,
    f.executor.publicKey(),
    null,
  );
  assert.deepEqual(bound.executor, { address: f.executor.publicKey(), source: 'service_prepare' });
  assert.deepEqual((await store.getIntent(created.intent.id))?.executionPolicy, {
    mode: 'external', executor: bound.executor,
  });

  await assert.rejects(
    () => resolveAndBindIntegrationSorobanExecutor(store, bound.intent, credential, secondExecutor, null),
    (cause: unknown) => cause instanceof Error && 'code' in cause && cause.code === 'intent_executor_locked',
  );
});

test('Integration without a Service executor binds the configured MultiSigTools managed executor', async () => {
  const f = await fixture();
  const store = new MemoryIntentStore();
  const managedExecutor = Keypair.random().publicKey();
  const credential = { ...f.credential, sorobanExecutionAccounts: [] };
  const created = await createIntegrationSorobanIntent(
    store,
    credential,
    { ...f.input, idempotencyKey: 'managed-executor' },
    { ...f.options, intentIdFactory: () => 'E'.repeat(16) },
  );
  const bound = await resolveAndBindIntegrationSorobanExecutor(
    store,
    created.intent,
    credential,
    undefined,
    managedExecutor,
  );
  assert.deepEqual(bound.executor, { address: managedExecutor, source: 'multisigtools_managed' });
  assert.deepEqual((await store.getIntent(created.intent.id))?.executionPolicy, {
    mode: 'multisigtools', executor: bound.executor,
  });
});


test('Integration idempotent replay keeps the executor snapshotted when the Service default later changes', async () => {
  const f = await fixture();
  const store = new MemoryIntentStore();
  const originalDefault = f.executor.publicKey();
  const laterDefault = Keypair.random().publicKey();
  const originalCredential = {
    ...f.credential,
    sorobanExecutionAccounts: [originalDefault, laterDefault],
    sorobanDefaultExecutor: originalDefault,
  };
  const first = await createIntegrationSorobanIntent(
    store,
    originalCredential,
    { ...f.input, idempotencyKey: 'default-snapshot' },
    { ...f.options, intentIdFactory: () => 'F'.repeat(16) },
  );
  assert.deepEqual(first.intent.executionPolicy?.executor, {
    address: originalDefault,
    source: 'service_default',
  });

  const replay = await createIntegrationSorobanIntent(
    store,
    { ...originalCredential, sorobanDefaultExecutor: laterDefault },
    { ...f.input, idempotencyKey: 'default-snapshot' },
    { ...f.options, intentIdFactory: () => 'F'.repeat(16) },
  );
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.intent.executionPolicy?.executor, {
    address: originalDefault,
    source: 'service_default',
  });
});


test('concurrent late executor binding has one durable winner', async () => {
  const f = await fixture();
  const store = new MemoryIntentStore();
  const executorA = f.executor.publicKey();
  const executorB = Keypair.random().publicKey();
  const credential = { ...f.credential, sorobanExecutionAccounts: [executorA, executorB] };
  const created = await createIntegrationSorobanIntent(
    store,
    credential,
    { ...f.input, idempotencyKey: 'executor-race' },
    { ...f.options, intentIdFactory: () => 'G'.repeat(16) },
  );

  const results = await Promise.allSettled([
    resolveAndBindIntegrationSorobanExecutor(store, created.intent, credential, executorA, null),
    resolveAndBindIntegrationSorobanExecutor(store, created.intent, credential, executorB, null),
  ]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  const rejected = results.find((item): item is PromiseRejectedResult => item.status === 'rejected');
  assert.ok(rejected?.reason instanceof Error && 'code' in rejected.reason && rejected.reason.code === 'intent_executor_locked');
  const winner = (await store.getIntent(created.intent.id))?.executionPolicy?.executor?.address;
  assert.ok(winner === executorA || winner === executorB);
});
