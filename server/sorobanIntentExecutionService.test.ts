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
import { createSorobanIntent, materializeSorobanIntent } from '../src/stellar/sorobanIntent.js';
import {
  prepareSorobanIntentExecution,
  SorobanIntentExecutionServiceError,
} from './sorobanIntentExecutionService.js';
import type { SorobanIntentAuthorizationSnapshot } from './sorobanIntentAuthorizationService.js';
import type { SorobanIntentStore, StoredSorobanIntent } from './sorobanIntentStore.js';

class MemoryIntentStore implements SorobanIntentStore {
  constructor(readonly stored: StoredSorobanIntent) {}
  async createIntent() { throw new Error('not used'); }
  async getIntent(id: string) { return id === this.stored.id ? this.stored : null; }
  async updateIntent() { throw new Error('not used'); }
  async listContributions() { return []; }
  async putContribution() { throw new Error('not used'); }
}
function fixture() {
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
  const plan = createSorobanAuthorizationPlan(intent, planningTx.toXDR());
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
      return { endpointUrl: 'test', latestLedger: 123, assembledXdr: envelopeXdr };
    },
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
    enforcer: async ({ envelopeXdr }: { envelopeXdr: string }) => ({ endpointUrl: 'test', latestLedger: 123, assembledXdr: envelopeXdr }),
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
