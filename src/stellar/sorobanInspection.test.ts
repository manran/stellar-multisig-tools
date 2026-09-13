import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Account,
  Contract,
  Keypair,
  Networks,
  Operation,
  TimeoutInfinite,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk/base';
import { inspectSorobanAuthorizationEntry, previewSorobanValue } from './sorobanInspection.js';
import { inspectTransactionXdr } from './transactionXdr.js';

const CONTRACT_ID = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';

function contractCallTransaction() {
  const source = Keypair.random();
  const contract = new Contract(CONTRACT_ID);
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: contract.address().toScAddress(),
    functionName: 'approve_invoice',
    args: [nativeToScVal('invoice-42'), nativeToScVal(Uint8Array.from([0xca, 0xfe]))],
  });
  const rootInvocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invokeArgs),
    subInvocations: [],
  });
  const sourceAuthorization = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation,
  });
  const transaction = new TransactionBuilder(new Account(source.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs),
      auth: [sourceAuthorization],
    }))
    .setTimeout(TimeoutInfinite)
    .build();
  return { source, transaction };
}


function contractAccountAuthorizationEntry(signature: xdr.ScVal = xdr.ScVal.scvVoid()) {
  const contract = new Contract(CONTRACT_ID);
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: contract.address().toScAddress(),
    functionName: 'approve_invoice',
    args: [nativeToScVal('invoice-42')],
  });
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new xdr.SorobanAddressCredentials({
        address: contract.address().toScAddress(),
        nonce: xdr.Int64(99n),
        signatureExpirationLedger: 500,
        signature,
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invokeArgs),
      subInvocations: [],
    }),
  });
}

test('inspects a Soroban contract call and keeps auth-entry evidence separate from envelope auth', () => {
  const { transaction } = contractCallTransaction();
  const inspection = inspectTransactionXdr(transaction.toXdr(), 'testnet');
  const operation = inspection.operations[0];

  assert.equal(operation.type, 'invokeHostFunction');
  assert.equal(operation.title, 'Call Soroban contract');
  assert.equal(operation.soroban?.hostFunctionType, 'hostFunctionTypeInvokeContract');
  assert.equal(operation.soroban?.contractCall?.contractAddress, CONTRACT_ID);
  assert.equal(operation.soroban?.contractCall?.functionName, 'approve_invoice');
  assert.deepEqual(operation.soroban?.contractCall?.argumentPreviews, ['"invoice-42"', '0xcafe']);
  assert.equal(operation.fields.find((field) => field.label === 'Contract')?.value, CONTRACT_ID);
  assert.equal(operation.fields.find((field) => field.label === 'Soroban authorization entries')?.value, '1');

  const auth = operation.soroban?.authorizationEntries[0];
  assert.equal(auth?.credentialType, 'sourceAccount');
  assert.equal(auth?.sourceAccountAuthorization, true);
  assert.equal(auth?.authorizer, null);
  assert.equal(auth?.invocation?.type, 'execute');
  assert.match(auth?.invocation?.label ?? '', /^approve_invoice · C/);
  assert.deepEqual(auth?.invocation?.argumentPreviews, ['"invoice-42"', '0xcafe']);
});

test('Soroban argument previews are deterministic and bounded', () => {
  assert.equal(previewSorobanValue(123n), '123');
  assert.equal(previewSorobanValue(Uint8Array.from([0xde, 0xad, 0xbe, 0xef])), '0xdeadbeef');
  assert.ok(previewSorobanValue('x'.repeat(400)).length <= 160);
  assert.match(previewSorobanValue([1, 2, 3, 4, 5]), /^\[1, 2, 3, 4, …\]$/);
});

test('classifies unsigned C-account authorization as contract-enforced read-only evidence', () => {
  const auth = inspectSorobanAuthorizationEntry(contractAccountAuthorizationEntry());
  assert.equal(auth.authorizer, CONTRACT_ID);
  assert.equal(auth.authorizationKind, 'contract-account');
  assert.equal(auth.verificationModel, 'contract-check-auth');
  assert.equal(auth.signed, false);
  assert.equal(auth.signers[0]?.address, CONTRACT_ID);
  assert.equal(auth.signers[0]?.signatureFormat, 'none');
});

test('keeps arbitrary C-account credential payload distinct from locally verified Ed25519 evidence', () => {
  const customPayload = nativeToScVal(Uint8Array.from([0xca, 0xfe, 0xba, 0xbe]));
  const auth = inspectSorobanAuthorizationEntry(contractAccountAuthorizationEntry(customPayload));
  assert.equal(auth.authorizationKind, 'contract-account');
  assert.equal(auth.verificationModel, 'contract-check-auth');
  assert.equal(auth.signed, true);
  assert.equal(auth.signers[0]?.signatureFormat, 'custom');
  assert.equal(auth.signers[0]?.signatureCount, null);
});
