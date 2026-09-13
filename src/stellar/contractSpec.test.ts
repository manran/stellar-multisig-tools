import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair, scValToNative, xdr } from '@stellar/stellar-sdk/base';
import { Spec } from '@stellar/stellar-sdk/contract';
import {
  contractArgumentsToScVals,
  contractCallOperation,
  contractTypeLabel,
  describeContractSpec,
} from './contractSpec.js';

const CONTRACT_ID = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';

function input(name: string, type: xdr.ScSpecTypeDef, doc = '') {
  return new xdr.ScSpecFunctionInputV0({ name, type, doc });
}

function fn(
  name: string,
  inputs: xdr.ScSpecFunctionInputV0[],
  outputs: xdr.ScSpecTypeDef[] = [],
  doc = '',
) {
  return xdr.ScSpecEntry.scSpecEntryFunctionV0(new xdr.ScSpecFunctionV0({
    name,
    inputs,
    outputs,
    doc,
  }));
}

function specWith(...functions: xdr.ScSpecEntry[]) {
  return new Spec(functions);
}

test('contract spec describes BytesN exactly and keeps unsupported complex inputs visible', () => {
  const bytes32 = xdr.ScSpecTypeDef.scSpecTypeBytesN(new xdr.ScSpecTypeBytesN({ n: 32 }));
  const optionalAddress = xdr.ScSpecTypeDef.scSpecTypeOption(new xdr.ScSpecTypeOption({
    valueType: xdr.ScSpecTypeDef.scSpecTypeAddress(),
  }));
  const spec = specWith(
    fn('__constructor', [], [], 'deployment only'),
    fn('__check_auth', [input('signature_payload', bytes32)], [], 'protocol hook'),
    fn('update', [input('new_wasm_hash', bytes32, 'New Wasm hash')], [], 'Upgrade implementation'),
    fn('maybe_admin', [input('admin', optionalAddress)]),
  );

  assert.equal(contractTypeLabel(bytes32), 'BytesN<32>');
  assert.equal(contractTypeLabel(optionalAddress), 'Option<Address>');
  assert.deepEqual(describeContractSpec(spec).map((method) => ({
    name: method.name,
    guided: method.guided,
    types: method.inputs.map((item) => item.typeLabel),
  })), [
    { name: 'update', guided: true, types: ['BytesN<32>'] },
    { name: 'maybe_admin', guided: false, types: ['Option<Address>'] },
  ]);
});

test('guided arguments encode against the exact contract spec instead of guessing ScVal types', () => {
  const owner = Keypair.random().publicKey();
  const bytes32 = xdr.ScSpecTypeDef.scSpecTypeBytesN(new xdr.ScSpecTypeBytesN({ n: 32 }));
  const spec = specWith(fn('update', [
    input('new_wasm_hash', bytes32),
    input('admin', xdr.ScSpecTypeDef.scSpecTypeAddress()),
    input('epoch', xdr.ScSpecTypeDef.scSpecTypeU64()),
    input('enabled', xdr.ScSpecTypeDef.scSpecTypeBool()),
  ]));
  const hashHex = 'ab'.repeat(32);

  const args = contractArgumentsToScVals(spec, 'update', {
    new_wasm_hash: `0x${hashHex}`,
    admin: owner,
    epoch: '42',
    enabled: 'true',
  });

  assert.equal(args.length, 4);
  assert.equal(args[0]?.type, 'scvBytes');
  assert.equal(Buffer.from(scValToNative(args[0]!)).toString('hex'), hashHex);
  assert.equal(args[1]?.type, 'scvAddress');
  assert.equal(scValToNative(args[2]!), 42n);
  assert.equal(scValToNative(args[3]!), true);
});

test('BytesN validation fails before a malformed contract transaction can reach Review', () => {
  const bytes32 = xdr.ScSpecTypeDef.scSpecTypeBytesN(new xdr.ScSpecTypeBytesN({ n: 32 }));
  const spec = specWith(fn('update', [input('new_wasm_hash', bytes32)]));
  assert.throws(
    () => contractArgumentsToScVals(spec, 'update', { new_wasm_hash: 'abcd' }),
    /new_wasm_hash \(BytesN<32>\): Expected exactly 32 bytes/,
  );
});

test('guided contract call produces a normal InvokeHostFunction operation for the existing Review flow', () => {
  const spec = specWith(fn('pause', []));
  const args = contractArgumentsToScVals(spec, 'pause', {});
  const operation = contractCallOperation(CONTRACT_ID, 'pause', args);
  assert.equal(operation.body.type, 'invokeHostFunction');
  assert.equal(operation.body.value.hostFunction.type, 'hostFunctionTypeInvokeContract');
  assert.equal(operation.body.value.hostFunction.value.functionName.toString(), 'pause');
});
