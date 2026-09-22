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
  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(args);
  const authorization = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(new xdr.SorobanAddressCredentials({
      address: new Address(authorizer.publicKey()).toScAddress(),
      nonce: xdr.Int64(42n),
      signatureExpirationLedger: 460,
      signature: xdr.ScVal.scvVoid(),
    })),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(args),
      subInvocations: [],
    }),
  });
  return { hostFunction, authorization };
}

test('Soroban Intent identity excludes execution context and private context', () => {
  const { hostFunction } = fixture();
  const intent = createSorobanIntent('testnet', hostFunction);
  const sameIntent = createSorobanIntent('testnet', hostFunction);
  const otherNetwork = createSorobanIntent('public', hostFunction);

  assert.equal(intent.intentDigest, sameIntent.intentDigest);
  assert.notEqual(intent.intentDigest, otherNetwork.intentDigest);
  assert.deepEqual(Object.keys(intent).sort(), [
    'hostFunctionXdr',
    'intentDigest',
    'network',
    'version',
  ]);

  const privateContextA = { privateNote: 'invoice 42', externalReference: 'A' };
  const privateContextB = { privateNote: 'changed note', externalReference: 'B' };
  assert.notDeepEqual(privateContextA, privateContextB);
  assert.equal(intent.intentDigest, sameIntent.intentDigest);
});

test('materialization late-binds source and preserves exact invocation/auth', () => {
  const { hostFunction, authorization } = fixture();
  const intent = createSorobanIntent('testnet', hostFunction);
  const sourceA = Keypair.random();
  const sourceB = Keypair.random();
  const sorobanData = new SorobanDataBuilder().build();

  const first = materializeSorobanIntent({
    intent,
    sourceAccount: sourceA.publicKey(),
    sourceSequence: '1',
    fee: '100',
    lifetimeSeconds: 3600,
    authorizationEntries: [authorization],
    sorobanData,
  });
  const second = materializeSorobanIntent({
    intent,
    sourceAccount: sourceB.publicKey(),
    sourceSequence: '9',
    fee: '700',
    lifetimeSeconds: 3600,
    authorizationEntries: [authorization],
    sorobanData,
  });

  assert.notEqual(first.source, second.source);
  assert.notEqual(first.sequence, second.sequence);
  assert.equal(first.operations.length, 1);
  assert.equal(second.operations.length, 1);
  const firstOperation = first.operations[0];
  const secondOperation = second.operations[0];
  assert.equal(firstOperation.type, 'invokeHostFunction');
  assert.equal(secondOperation.type, 'invokeHostFunction');
  if (firstOperation.type !== 'invokeHostFunction' || secondOperation.type !== 'invokeHostFunction') return;
  assert.equal(
    firstOperation.func.toXdr('base64'),
    secondOperation.func.toXdr('base64'),
  );
  assert.equal(
    firstOperation.func.toXdr('base64'),
    intent.hostFunctionXdr,
  );
  assert.deepEqual(
    (firstOperation.auth ?? []).map((entry) => entry.toXdr('base64')),
    (secondOperation.auth ?? []).map((entry) => entry.toXdr('base64')),
  );
  assert.deepEqual(
    (firstOperation.auth ?? []).map((entry) => entry.toXdr('base64')),
    [authorization.toXdr('base64')],
  );
});
