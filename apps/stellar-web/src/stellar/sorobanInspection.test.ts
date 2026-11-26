import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Account,
  Asset,
  Address,
  Contract,
  StrKey,
  Keypair,
  Networks,
  Operation,
  TimeoutInfinite,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk/base';
import { inspectSorobanHostFunctionXdr, enrichSorobanCallSummary, sorobanIntentCallTitle, inspectSorobanAuthorizationEntry, previewSorobanValue } from '../../../../packages/stellar-core/src/sorobanInspection.js';
import { inspectTransactionXdr } from '../../../../packages/stellar-core/src/transactionXdr.js';

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

test('Protocol 30 transaction review preserves the full W destination in the call and authorization tree', () => {
  const source = Keypair.random();
  const recipient = Address.muxedContract(Buffer.concat([StrKey.decodeContract(CONTRACT_ID), Buffer.alloc(8, 255)])).toString();
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: new Contract(CONTRACT_ID).address().toScAddress(),
    functionName: 'transfer',
    args: [Address.fromString(source.publicKey()).toScVal(), Address.fromString(recipient).toScVal(), nativeToScVal(100n, { type: 'i128' })],
  });
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invokeArgs),
    subInvocations: [],
  });
  const authorization = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: invocation,
  });
  const tx = new TransactionBuilder(new Account(source.publicKey(), '1'), {
    fee: '100', networkPassphrase: Networks.TESTNET,
  }).addOperation(Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs),
    auth: [authorization],
  })).setTimeout(TimeoutInfinite).build();
  const inspection = inspectTransactionXdr(tx.toXdr(), 'testnet');
  const soroban = inspection.operations[0].soroban;
  assert.equal(soroban?.contractCall?.argumentPreviews[1], JSON.stringify(recipient));
  assert.equal(soroban?.authorizationEntries[0]?.invocation?.argumentPreviews[1], JSON.stringify(recipient));
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

test('review summary formats native XLM exactly and never guesses other token units', () => {
  const from = Keypair.random().publicKey();
  const to = Keypair.random().publicKey();
  const make = (contractId: string) => xdr.HostFunction.hostFunctionTypeInvokeContract(new xdr.InvokeContractArgs({
    contractAddress: new Contract(contractId).address().toScAddress(),
    functionName: 'transfer',
    args: [Address.fromString(from).toScVal(), Address.fromString(to).toScVal(), nativeToScVal(5000000n, { type: 'i128' })],
  })).toXdr('base64');
  const native = make(Asset.native().contractId(Networks.TESTNET));
  assert.deepEqual(inspectSorobanHostFunctionXdr(native, 'testnet')?.nativeXlmTransfer, { from, to, amount: '0.5' });
  assert.equal(inspectSorobanHostFunctionXdr(native, 'public')?.nativeXlmTransfer, undefined);
  assert.equal(inspectSorobanHostFunctionXdr(make(CONTRACT_ID), 'testnet')?.nativeXlmTransfer, undefined);
  assert.equal(sorobanIntentCallTitle(native, 'testnet'), 'Transfer 0.5 XLM');
  assert.equal(sorobanIntentCallTitle(make(CONTRACT_ID), 'testnet'), 'Call transfer');
  assert.equal(sorobanIntentCallTitle('invalid', 'testnet'), 'Soroban Intent');
});

test('contract-reported token metadata preserves exact raw amount and does not guess precision', () => {
  const from = Keypair.random().publicKey();
  const to = Keypair.random().publicKey();
  const encoded = xdr.HostFunction.hostFunctionTypeInvokeContract(new xdr.InvokeContractArgs({
    contractAddress: new Contract(CONTRACT_ID).address().toScAddress(),
    functionName: 'transfer',
    args: [Address.fromString(from).toScVal(), Address.fromString(to).toScVal(), nativeToScVal(123456789012345678901n, { type: 'i128' })],
  })).toXdr('base64');
  const methods = [{ name: 'transfer', inputs: [{ name: 'from', typeLabel: 'Address' }, { name: 'to', typeLabel: 'Address' }, { name: 'amount', typeLabel: 'I128' }], outputs: [] }];
  const reported = { symbol: 'TOKEN', decimals: 6, observedLedger: 123 };
  const result = enrichSorobanCallSummary(encoded, 'testnet', methods, reported);
  assert.deepEqual(result?.tokenTransfer, { from, to, rawAmount: '123456789012345678901', amount: '123456789012345.678901', ...reported, basis: 'contract_reported' });
  assert.deepEqual(result?.argumentNames, ['from', 'to', 'amount']);
  assert.equal(enrichSorobanCallSummary(encoded, 'testnet', methods)?.tokenTransfer, undefined);
  assert.equal(enrichSorobanCallSummary(encoded, 'testnet', methods, { ...reported, decimals: 255 })?.tokenTransfer, undefined);
  assert.equal(enrichSorobanCallSummary(encoded, 'testnet', methods, { ...reported, symbol: 'bad symbol' })?.tokenTransfer, undefined);
});
