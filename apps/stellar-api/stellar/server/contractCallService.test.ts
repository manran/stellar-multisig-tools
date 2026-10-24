import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair, Networks, TransactionBuilder, xdr } from '@stellar/stellar-sdk/base';
import { Spec } from '@stellar/stellar-sdk/contract';
import {
  buildContractCall,
  ContractCallServiceError,
  inspectContractInterface,
} from './contractCallService.js';
import { describeContractSpec } from '../../../../packages/stellar-core/src/contractSpec.js';

const SOURCE = Keypair.random().publicKey();
const CONTRACT_ID = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';

function loadedInterface() {
  const entry = xdr.ScSpecEntry.scSpecEntryFunctionV0(new xdr.ScSpecFunctionV0({
    name: 'reserve',
    inputs: [
      new xdr.ScSpecFunctionInputV0({
        name: 'wallet',
        type: xdr.ScSpecTypeDef.scSpecTypeString(),
        doc: 'Wallet label',
      }),
    ],
    outputs: [],
    doc: 'Reserve a wallet.',
  }));
  const spec = new Spec([entry]);
  return { spec, methods: describeContractSpec(spec) };
}

function blendLikeInterface() {
  const request = xdr.ScSpecEntry.scSpecEntryUdtStructV0(new xdr.ScSpecUdtStructV0({
    name: 'Request',
    doc: 'A pool request.',
    lib: '',
    fields: [
      new xdr.ScSpecUdtStructFieldV0({ name: 'address', doc: '', type: xdr.ScSpecTypeDef.scSpecTypeAddress() }),
      new xdr.ScSpecUdtStructFieldV0({ name: 'amount', doc: '', type: xdr.ScSpecTypeDef.scSpecTypeI128() }),
      new xdr.ScSpecUdtStructFieldV0({ name: 'request_type', doc: '', type: xdr.ScSpecTypeDef.scSpecTypeU32() }),
    ],
  }));
  const requestType = xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name: 'Request' }));
  const requests = xdr.ScSpecTypeDef.scSpecTypeVec(new xdr.ScSpecTypeVec({ elementType: requestType }));
  const submit = xdr.ScSpecEntry.scSpecEntryFunctionV0(new xdr.ScSpecFunctionV0({
    name: 'submit',
    inputs: [new xdr.ScSpecFunctionInputV0({ name: 'requests', type: requests, doc: '' })],
    outputs: [],
    doc: 'Submit requests.',
  }));
  const spec = new Spec([request, submit]);
  return { spec, methods: describeContractSpec(spec) };
}

const dependencies = {
  interfaceLoader: async () => loadedInterface(),
  accountLoader: async () => ({ accountId: SOURCE, sequence: '123' }),
  networkParametersLoader: async () => ({ baseFeeInStroops: 100 }),
};

test('inspects a contract interface through the headless operation', async () => {
  const result = await inspectContractInterface(CONTRACT_ID, 'testnet', dependencies);
  assert.equal(result.operation, 'contract.interface.inspect');
  assert.equal(result.methods[0]?.name, 'reserve');
  assert.equal(result.methods[0]?.inputs[0]?.typeLabel, 'String');
  assert.equal(result.abi.schema, 'fresnica-soroban-abi-v1');
});

test('builds an unsigned contract call from machine-safe inputs', async () => {
  const result = await buildContractCall({
    network: 'testnet',
    transactionSource: SOURCE,
    contractId: CONTRACT_ID,
    method: 'reserve',
    arguments: { wallet: 'fresnica' },
    lifetimeSeconds: 3600,
  }, dependencies);

  const transaction = TransactionBuilder.fromXdr(result.xdr, Networks.TESTNET);
  assert.equal(result.operation, 'contract.call.build');
  assert.equal(result.sourceSequence, '123');
  assert.ok('source' in transaction);
  if (!('source' in transaction)) return;
  assert.equal(transaction.source, SOURCE);
  assert.equal(transaction.operations[0]?.type, 'invokeHostFunction');
  assert.ok(Date.parse(result.validUntil) > Date.now());
});

test('rejects unknown methods and invalid typed arguments before producing XDR', async () => {
  await assert.rejects(
    () => buildContractCall({
      network: 'testnet',
      transactionSource: SOURCE,
      contractId: CONTRACT_ID,
      method: 'missing',
      arguments: {},
      lifetimeSeconds: 3600,
    }, dependencies),
    (cause: unknown) => cause instanceof ContractCallServiceError && cause.code === 'invalid_method',
  );
  await assert.rejects(
    () => buildContractCall({
      network: 'testnet',
      transactionSource: SOURCE,
      contractId: CONTRACT_ID,
      method: 'reserve',
      arguments: { wallet: 12 },
      lifetimeSeconds: 3600,
    }, dependencies),
    (cause: unknown) => cause instanceof ContractCallServiceError && cause.code === 'invalid_arguments',
  );
});


test('builds a Blend-style typed JSON Vec<UDT> call and rejects shape drift', async () => {
  const owner = Keypair.random().publicKey();
  const complexDependencies = {
    ...dependencies,
    interfaceLoader: async () => blendLikeInterface(),
  };
  const result = await buildContractCall({
    network: 'testnet',
    transactionSource: SOURCE,
    contractId: CONTRACT_ID,
    method: 'submit',
    arguments: { requests: [{ address: owner, amount: '10000000', request_type: 0 }] },
    lifetimeSeconds: 3600,
  }, complexDependencies);
  const transaction = TransactionBuilder.fromXdr(result.xdr, Networks.TESTNET);
  assert.equal(transaction.operations[0]?.type, 'invokeHostFunction');
  if (transaction.operations[0]?.type !== 'invokeHostFunction') return;
  assert.equal(transaction.operations[0].func.type, 'hostFunctionTypeInvokeContract');
  if (transaction.operations[0].func.type !== 'hostFunctionTypeInvokeContract') return;
  assert.equal(transaction.operations[0].func.value.args[0]?.type, 'scvVec');

  await assert.rejects(
    () => buildContractCall({
      network: 'testnet',
      transactionSource: SOURCE,
      contractId: CONTRACT_ID,
      method: 'submit',
      arguments: { requests: [{ address: owner, amount: '1', request_type: 0, extra: 7 }] },
      lifetimeSeconds: 3600,
    }, complexDependencies),
    (cause: unknown) => cause instanceof ContractCallServiceError
      && cause.code === 'invalid_arguments'
      && /extra is not declared by struct Request/.test(cause.message),
  );
});
