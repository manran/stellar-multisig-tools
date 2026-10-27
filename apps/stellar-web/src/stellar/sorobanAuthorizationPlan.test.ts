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
import {
  authorizationEntriesFromPlan,
  createSorobanAuthorizationPlan,
} from '../../../../packages/stellar-core/src/sorobanAuthorizationPlan.js';
import { emptySorobanEffectsSnapshot } from '../../../../packages/stellar-core/src/sorobanEffects.js';
import {
  createSorobanIntent,
  materializeSorobanIntent,
} from '../../../../packages/stellar-core/src/sorobanIntent.js';

function fixture() {
  const authorizer = Keypair.random();
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
  const detached = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(new xdr.SorobanAddressCredentials({
      address: new Address(authorizer.publicKey()).toScAddress(),
      nonce: xdr.Int64(42n),
      signatureExpirationLedger: 460,
      signature: xdr.ScVal.scvVoid(),
    })),
    rootInvocation: invocation,
  });
  const sourceBound = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: invocation,
  });
  return {
    intent: createSorobanIntent('testnet', xdr.HostFunction.hostFunctionTypeInvokeContract(args)),
    detached,
    sourceBound,
  };
}

function materialize(source: Keypair, sequence: string, intent: ReturnType<typeof createSorobanIntent>, auth: xdr.SorobanAuthorizationEntry[]) {
  return materializeSorobanIntent({
    intent,
    sourceAccount: source.publicKey(),
    sourceSequence: sequence,
    fee: '100',
    lifetimeSeconds: 3600,
    authorizationEntries: auth,
    sorobanData: new SorobanDataBuilder().build(),
  });
}

test('AuthorizationPlan discards transaction shell and is stable across planning sources', () => {
  const { intent, detached } = fixture();
  const first = createSorobanAuthorizationPlan(
    intent,
    materialize(Keypair.random(), '1', intent, [detached]).toXDR(),
    emptySorobanEffectsSnapshot(),
  );
  const second = createSorobanAuthorizationPlan(
    intent,
    materialize(Keypair.random(), '9', intent, [detached]).toXDR(),
    emptySorobanEffectsSnapshot(),
  );

  assert.equal(first.authorizationPlanDigest, second.authorizationPlanDigest);
  assert.equal(first.executionBinding, 'detached');
  assert.equal(first.intentDigest, intent.intentDigest);
  assert.equal('baseXdr' in first, false);
  assert.equal('transactionSource' in first, false);
  const execution = materializeSorobanIntent({
    intent,
    sourceAccount: Keypair.random().publicKey(),
    sourceSequence: '20',
    fee: '700',
    lifetimeSeconds: 3600,
    authorizationEntries: authorizationEntriesFromPlan(first),
    sorobanData: new SorobanDataBuilder().build(),
  });
  const operation = execution.operations[0];
  assert.equal(operation.type, 'invokeHostFunction');
  if (operation.type !== 'invokeHostFunction') return;
  assert.deepEqual(
    (operation.auth ?? []).map((entry) => entry.toXdr('base64')),
    first.authorizationEntriesXdr,
  );
});

test('AuthorizationPlan binds SOURCE_ACCOUNT authorization to the planning source', () => {
  const { intent, detached, sourceBound } = fixture();
  const sourceA = Keypair.random();
  const sourceB = Keypair.random();
  const first = createSorobanAuthorizationPlan(
    intent,
    materialize(sourceA, '1', intent, [sourceBound, detached]).toXDR(),
    emptySorobanEffectsSnapshot(),
  );
  const second = createSorobanAuthorizationPlan(
    intent,
    materialize(sourceB, '9', intent, [sourceBound, detached]).toXDR(),
    emptySorobanEffectsSnapshot(),
  );
  assert.equal(first.executionBinding, 'source_bound');
  assert.equal(first.boundSourceAccount, sourceA.publicKey());
  assert.equal(second.boundSourceAccount, sourceB.publicKey());
  assert.notEqual(first.authorizationPlanDigest, second.authorizationPlanDigest);
});
test('AuthorizationPlan rejects a transaction for a different Intent', () => {
  const first = fixture();
  const second = fixture();
  const prepared = materialize(Keypair.random(), '1', first.intent, [first.detached]).toXDR();
  assert.throws(
    () => createSorobanAuthorizationPlan(second.intent, prepared, emptySorobanEffectsSnapshot()),
    /does not match this Intent/,
  );
});

test('AuthorizationPlan identity binds the reviewed simulation effects digest', () => {
  const { intent, detached } = fixture();
  const prepared = materialize(Keypair.random(), '1', intent, [detached]).toXDR();
  const firstEffects = emptySorobanEffectsSnapshot();
  const secondEffects = { ...firstEffects, digest: 'f'.repeat(64) };
  const first = createSorobanAuthorizationPlan(intent, prepared, firstEffects);
  const second = createSorobanAuthorizationPlan(intent, prepared, secondEffects);
  assert.notEqual(first.authorizationPlanDigest, second.authorizationPlanDigest);
  assert.equal(first.effects.digest, firstEffects.digest);
  assert.equal(second.effects.digest, secondEffects.digest);
});
