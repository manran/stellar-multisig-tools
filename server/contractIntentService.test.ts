import assert from 'node:assert/strict';
import test from 'node:test';
import { Spec } from '@stellar/stellar-sdk/contract';
import { Keypair, xdr } from '@stellar/stellar-sdk/base';
import { describeContractSpec } from '../src/stellar/contractSpec.js';
import {
  buildContractIntent,
  ContractIntentServiceError,
} from './contractIntentService.js';

const CONTRACT_ID = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';

function loadedInterface() {
  const entry = xdr.ScSpecEntry.scSpecEntryFunctionV0(new xdr.ScSpecFunctionV0({
    name: 'reserve',
    inputs: [new xdr.ScSpecFunctionInputV0({
      name: 'wallet',
      type: xdr.ScSpecTypeDef.scSpecTypeString(),
      doc: 'Wallet label',
    })],
    outputs: [],
    doc: 'Reserve a wallet.',
  }));
  const spec = new Spec([entry]);
  return { spec, methods: describeContractSpec(spec) };
}
const dependencies = { interfaceLoader: async () => loadedInterface() };

function transferInterface() {
  const optionalAddress = xdr.ScSpecTypeDef.scSpecTypeOption(new xdr.ScSpecTypeOption({
    valueType: xdr.ScSpecTypeDef.scSpecTypeAddress(),
  }));
  const entry = xdr.ScSpecEntry.scSpecEntryFunctionV0(new xdr.ScSpecFunctionV0({
    name: 'transfer',
    inputs: [
      new xdr.ScSpecFunctionInputV0({ name: 'name', type: xdr.ScSpecTypeDef.scSpecTypeString(), doc: '' }),
      new xdr.ScSpecFunctionInputV0({ name: 'from', type: xdr.ScSpecTypeDef.scSpecTypeAddress(), doc: '' }),
      new xdr.ScSpecFunctionInputV0({ name: 'to', type: xdr.ScSpecTypeDef.scSpecTypeAddress(), doc: '' }),
      new xdr.ScSpecFunctionInputV0({ name: 'target', type: optionalAddress, doc: '' }),
    ],
    outputs: [],
    doc: 'Transfer a name.',
  }));
  const spec = new Spec([entry]);
  return { spec, methods: describeContractSpec(spec) };
}


function blendLikeInterface() {
  const request = xdr.ScSpecEntry.scSpecEntryUdtStructV0(new xdr.ScSpecUdtStructV0({
    name: 'Request', doc: '', lib: '',
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
    doc: '',
  }));
  const spec = new Spec([request, submit]);
  return { spec, methods: describeContractSpec(spec) };
}

test('builds a source-free Soroban Intent from guided contract inputs', async () => {
  const result = await buildContractIntent({
    network: 'testnet',
    contractId: CONTRACT_ID,
    method: 'reserve',
    arguments: { wallet: 'fresnica' },
  }, dependencies);

  assert.equal(result.operation, 'contract.intent.build');
  assert.equal(result.network, 'testnet');
  assert.equal(result.contractId, CONTRACT_ID);
  assert.equal(result.method, 'reserve');
  assert.equal(result.intent.network, 'testnet');
  assert.match(result.intent.intentDigest, /^[0-9a-f]{64}$/);
  assert.ok(result.intent.hostFunctionXdr.length > 0);
  assert.equal('transactionSource' in result, false);
  assert.equal('xdr' in result, false);
});

test('builds Integration-compatible transfer Intent with optional target omitted or supplied', async () => {
  const from = Keypair.random().publicKey();
  const to = Keypair.random().publicKey();
  const target = Keypair.random().publicKey();
  const transferDependencies = { interfaceLoader: async () => transferInterface() };

  const withoutTarget = await buildContractIntent({
    network: 'testnet', contractId: CONTRACT_ID, method: 'transfer',
    arguments: { name: 'eno', from, to },
  }, transferDependencies);
  const withTarget = await buildContractIntent({
    network: 'testnet', contractId: CONTRACT_ID, method: 'transfer',
    arguments: { name: 'eno', from, to, target },
  }, transferDependencies);

  assert.match(withoutTarget.intent.intentDigest, /^[0-9a-f]{64}$/);
  assert.match(withTarget.intent.intentDigest, /^[0-9a-f]{64}$/);
  assert.notEqual(withTarget.intent.intentDigest, withoutTarget.intent.intentDigest);
});

test('same semantic call produces the same Intent identity', async () => {
  const input = {
    network: 'testnet',
    contractId: CONTRACT_ID,
    method: 'reserve',
    arguments: { wallet: 'fresnica' },
  } as const;
  const first = await buildContractIntent(input, dependencies);
  const second = await buildContractIntent(input, dependencies);
  assert.equal(second.intent.intentDigest, first.intent.intentDigest);
  assert.equal(second.intent.hostFunctionXdr, first.intent.hostFunctionXdr);
});

test('rejects unknown methods and invalid typed arguments before creating Intent', async () => {
  await assert.rejects(
    () => buildContractIntent({
      network: 'testnet',
      contractId: CONTRACT_ID,
      method: 'missing',
      arguments: {},
    }, dependencies),
    (cause: unknown) => cause instanceof ContractIntentServiceError && cause.code === 'invalid_method',
  );
  await assert.rejects(
    () => buildContractIntent({
      network: 'testnet',
      contractId: CONTRACT_ID,
      method: 'reserve',
      arguments: { wallet: 12 },
    }, dependencies),
    (cause: unknown) => cause instanceof ContractIntentServiceError && cause.code === 'invalid_arguments',
  );
});


test('builds a source-free Intent from Blend-style typed JSON without prepared XDR', async () => {
  const owner = Keypair.random().publicKey();
  const result = await buildContractIntent({
    network: 'testnet',
    contractId: CONTRACT_ID,
    method: 'submit',
    arguments: { requests: [{ address: owner, amount: '10000000', request_type: 0 }] },
  }, { interfaceLoader: async () => blendLikeInterface() });

  const hostFunction = xdr.HostFunction.fromXDR(result.intent.hostFunctionXdr, 'base64');
  assert.equal(hostFunction.type, 'hostFunctionTypeInvokeContract');
  if (hostFunction.type !== 'hostFunctionTypeInvokeContract') return;
  assert.equal(hostFunction.value.args[0]?.type, 'scvVec');
  assert.equal('preparedXdr' in result, false);
});
