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
import { inspectAuthEntry } from '@stellar/stellar-sdk/base';
import { authorizationEntriesFromPlan } from '../src/stellar/sorobanAuthorizationPlan.js';
import { createSorobanIntent, materializeSorobanIntent } from '../src/stellar/sorobanIntent.js';
import { planSorobanIntent, planSorobanIntentForStorage } from './sorobanIntentPlanningService.js';

function fixture() {
  const source = Keypair.random();
  const authorizer = Keypair.random();
  const contract = new Contract('CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE');
  const args = new xdr.InvokeContractArgs({
    contractAddress: contract.address().toScAddress(),
    functionName: 'approve_invoice',
    args: [nativeToScVal(authorizer.publicKey()), nativeToScVal('invoice-42')],
  });
  const func = xdr.HostFunction.hostFunctionTypeInvokeContract(args);
  const intent = createSorobanIntent('testnet', func);
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
  const assembled = materializeSorobanIntent({
    intent,
    sourceAccount: source.publicKey(),
    sourceSequence: '7',
    fee: '100',
    lifetimeSeconds: 300,
    authorizationEntries: [auth],
    sorobanData: new SorobanDataBuilder().build(),
  });
  return { source, authorizer, intent, args, assembled };
}

test('planning converts a transient recording transaction into an AuthorizationPlan only', async () => {
  const f = fixture();
  const plan = await planSorobanIntent(f.intent, f.source.publicKey(), {
    accountLoader: async () => ({ accountId: f.source.publicKey(), sequence: '7' } as never),
    networkParametersLoader: async () => ({ baseFeeInStroops: 100 } as never),
    simulator: async () => ({ assembledXdr: f.assembled.toXDR(), latestLedger: 100 } as never),
  });
  assert.equal(plan.intentDigest, f.intent.intentDigest);
  assert.equal(plan.executionBinding, 'detached');
  assert.equal(plan.boundSourceAccount, undefined);
  assert.equal('baseXdr' in plan, false);
  assert.equal('transactionSource' in plan, false);
  const entries = authorizationEntriesFromPlan(plan);
  assert.equal(entries.length, 1);
  const info = inspectAuthEntry(entries[0]);
  assert.equal(info.address, f.authorizer.publicKey());
  assert.equal(info.signatureExpirationLedger, 460);
  assert.equal(info.signed, false);
});


test('planning rejects SOURCE_ACCOUNT authorization instead of binding Intent to planning source', async () => {
  const f = fixture();
  const sourceBound = materializeSorobanIntent({
    intent: f.intent,
    sourceAccount: f.source.publicKey(),
    sourceSequence: '7',
    fee: '100',
    lifetimeSeconds: 300,
    authorizationEntries: [new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(f.args),
        subInvocations: [],
      }),
    })],
    sorobanData: new SorobanDataBuilder().build(),
  });
  await assert.rejects(
    () => planSorobanIntent(f.intent, f.source.publicKey(), {
      accountLoader: async () => ({ accountId: f.source.publicKey(), sequence: '7' } as never),
      networkParametersLoader: async () => ({ baseFeeInStroops: 100 } as never),
      simulator: async () => ({ assembledXdr: sourceBound.toXDR(), latestLedger: 100 } as never),
    }),
    (cause: unknown) => cause instanceof Error && 'code' in cause && cause.code === 'source_account_auth_unsupported',
  );
});

test('planning rejects an invalid deployment planning source before simulation', async () => {
  const f = fixture();
  await assert.rejects(
    () => planSorobanIntent(f.intent, 'not-a-g-address'),
    /valid deployment Soroban planning source/i,
  );
});

const CONTRACT_ACCOUNT = 'CBUGCD3J6RCTJ5RVK7SGDV63JKV7E5YMULD5HAXQ7BGHNLB5DYVVZIEH';

async function withPlanningContractAdapter<T>(ownerAddress: string, run: () => Promise<T>): Promise<T> {
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

test('planning initializes configured C-account AUTH and discovers its owner', async () => {
  const source = Keypair.random();
  const owner = Keypair.random();
  await withPlanningContractAdapter(owner.publicKey(), async () => {
    const contract = new Contract('CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE');
    const args = new xdr.InvokeContractArgs({
      contractAddress: contract.address().toScAddress(),
      functionName: 'authorize',
      args: [nativeToScVal(CONTRACT_ACCOUNT), nativeToScVal(303)],
    });    const invocation = new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(args),
      subInvocations: [],
    });
    const auth = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(new xdr.SorobanAddressCredentials({
        address: new Address(CONTRACT_ACCOUNT).toScAddress(),
        nonce: xdr.Int64(88n),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      })),
      rootInvocation: invocation,
    });
    const intent = createSorobanIntent('testnet', xdr.HostFunction.hostFunctionTypeInvokeContract(args));
    const assembled = materializeSorobanIntent({
      intent,
      sourceAccount: source.publicKey(),
      sourceSequence: '7',
      fee: '100',
      lifetimeSeconds: 300,
      authorizationEntries: [auth],
      sorobanData: new SorobanDataBuilder().build(),
    });
    const result = await planSorobanIntentForStorage(intent, source.publicKey(), {
      accountLoader: async () => ({ accountId: source.publicKey(), sequence: '7' } as never),
      networkParametersLoader: async () => ({ baseFeeInStroops: 100 } as never),
      simulator: async () => ({ assembledXdr: assembled.toXDR(), latestLedger: 100 } as never),
    });    assert.deepEqual(result.discoverySignerKeys, [owner.publicKey()]);
    const entries = authorizationEntriesFromPlan(result.authorizationPlan);
    assert.equal(entries.length, 1);
    const info = inspectAuthEntry(entries[0]);
    assert.equal(info.address, CONTRACT_ACCOUNT);
    assert.equal(info.signatureExpirationLedger, 460);
    assert.equal(info.signed, false);
  });
});
