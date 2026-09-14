import assert from 'node:assert/strict';
import test from 'node:test';
import { Spec } from '@stellar/stellar-sdk/contract';
import { xdr } from '@stellar/stellar-sdk/base';
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
