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
import { describeContractSpec } from '../src/stellar/contractSpec.js';
import { materializeSorobanIntent } from '../src/stellar/sorobanIntent.js';
import { buildContractIntent } from './contractIntentService.js';
import { createHumanSorobanIntent } from './humanSorobanIntentService.js';
import type { SorobanIntentStore, StoredSorobanIntent } from './sorobanIntentStore.js';

const CONTRACT_ID = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';

class MemoryIntentStore implements SorobanIntentStore {
  values = new Map<string, StoredSorobanIntent>();
  async createIntent(value: StoredSorobanIntent) { this.values.set(value.id, value); }
  async getIntent(id: string) { return this.values.get(id) ?? null; }
  async updateIntent(value: StoredSorobanIntent) { this.values.set(value.id, value); }
  async listContributions() { return []; }
  async putContribution() {}
}
function loadedInterface() {
  const entry = xdr.ScSpecEntry.scSpecEntryFunctionV0(new xdr.ScSpecFunctionV0({
    name: 'reserve',
    inputs: [new xdr.ScSpecFunctionInputV0({
      name: 'wallet',
      type: xdr.ScSpecTypeDef.scSpecTypeString(),
      doc: '',
    })],
    outputs: [],
    doc: '',
  }));
  const spec = new Spec([entry]);
  return { spec, methods: describeContractSpec(spec) };
}

async function options(sourceBound = false) {
  const planningSource = Keypair.random();
  const authorizer = Keypair.random();
  const built = await buildContractIntent({
    network: 'testnet',
    contractId: CONTRACT_ID,
    method: 'reserve',
    arguments: { wallet: 'fresnica' },
  }, { interfaceLoader: async () => loadedInterface() });
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: new Contract(CONTRACT_ID).address().toScAddress(),
    functionName: 'reserve',
    args: [nativeToScVal('fresnica')],
  });
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invokeArgs),
    subInvocations: [],
  });
  const auth = sourceBound
    ? new xdr.SorobanAuthorizationEntry({
        credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
        rootInvocation: invocation,
      })
    : new xdr.SorobanAuthorizationEntry({
        credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(new xdr.SorobanAddressCredentials({
          address: new Address(authorizer.publicKey()).toScAddress(),
          nonce: xdr.Int64(42n),
          signatureExpirationLedger: 0,
          signature: xdr.ScVal.scvVoid(),
        })),
        rootInvocation: invocation,
      });
  const assembled = materializeSorobanIntent({
    intent: built.intent,
    sourceAccount: planningSource.publicKey(),
    sourceSequence: '7',
    fee: '100',
    lifetimeSeconds: 300,
    authorizationEntries: [auth],
    sorobanData: new SorobanDataBuilder().build(),
  });
  return {
    planningSource: planningSource.publicKey(),
    contractDependencies: { interfaceLoader: async () => loadedInterface() },
    planningDependencies: {
      accountLoader: async () => ({ accountId: planningSource.publicKey(), sequence: '7' } as never),
      networkParametersLoader: async () => ({ baseFeeInStroops: 100 } as never),
      simulator: async () => ({ assembledXdr: assembled.toXDR(), latestLedger: 100 } as never),
    },
  };
}

const input = {
  network: 'testnet' as const,
  contractId: CONTRACT_ID,
  method: 'reserve',
  arguments: { wallet: 'fresnica' },
  privateNote: 'Human intent',
};

test('Human session creates the same source-free durable Intent model', async () => {
  const store = new MemoryIntentStore();
  const creator = Keypair.random().publicKey();
  const result = await createHumanSorobanIntent(store, creator, input, {
    ...(await options()),
    idFactory: () => 'H'.repeat(16),
  });
  assert.equal(result.id, 'H'.repeat(16));
  assert.equal(result.creatorAddress, creator);
  assert.equal(result.authorizationPlan.executionBinding, 'detached');
  assert.equal(result.privateContext?.initialPrivateNote?.text, 'Human intent');
  assert.equal('transactionSource' in result, false);
});

test('Human Intent rejects SOURCE_ACCOUNT before any durable write', async () => {
  const store = new MemoryIntentStore();
  let beforeCreateCalls = 0;
  const sourceBoundOptions = await options(true);
  await assert.rejects(
    () => createHumanSorobanIntent(store, Keypair.random().publicKey(), input, {
      ...sourceBoundOptions,
      beforeCreate: async () => { beforeCreateCalls += 1; },
    }),
    (cause: unknown) => cause instanceof Error
      && 'code' in cause
      && cause.code === 'source_account_auth_unsupported'
      && /binds authorization to the final transaction source/i.test(cause.message),
  );
  assert.equal(beforeCreateCalls, 0);
  assert.equal(store.values.size, 0);
});
