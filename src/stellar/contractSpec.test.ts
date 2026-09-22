import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair, scValToNative, xdr } from '@stellar/stellar-sdk/base';
import { Spec } from '@stellar/stellar-sdk/contract';
import {
  contractArgumentsToScVals,
  contractCallOperation,
  contractTypeLabel,
  describeContractAbi,
  describeContractSpec,
} from '../../packages/stellar-core/src/contractSpec.js';

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


function udtStruct(
  name: string,
  fields: Array<[string, xdr.ScSpecTypeDef]>,
  doc = '',
) {
  return xdr.ScSpecEntry.scSpecEntryUdtStructV0(new xdr.ScSpecUdtStructV0({
    name,
    doc,
    lib: '',
    fields: fields.map(([fieldName, type]) => new xdr.ScSpecUdtStructFieldV0({
      name: fieldName,
      doc: '',
      type,
    })),
  }));
}

function udt(name: string) {
  return xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name }));
}

function vec(elementType: xdr.ScSpecTypeDef) {
  return xdr.ScSpecTypeDef.scSpecTypeVec(new xdr.ScSpecTypeVec({ elementType }));
}

test('contract spec describes BytesN and optional Address inputs as guided types', () => {
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
    { name: 'maybe_admin', guided: true, types: ['Option<Address>'] },
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

test('guided Option<Address> encodes omitted value as None and address as Some', () => {
  const owner = Keypair.random().publicKey();
  const optionalAddress = xdr.ScSpecTypeDef.scSpecTypeOption(new xdr.ScSpecTypeOption({
    valueType: xdr.ScSpecTypeDef.scSpecTypeAddress(),
  }));
  const spec = specWith(fn('transfer', [
    input('name', xdr.ScSpecTypeDef.scSpecTypeString()),
    input('target', optionalAddress),
  ]));

  const noneArgs = contractArgumentsToScVals(spec, 'transfer', { name: 'eno' });
  assert.equal(noneArgs[1]?.type, 'scvVoid');
  assert.equal(scValToNative(noneArgs[1]!), null);

  const someArgs = contractArgumentsToScVals(spec, 'transfer', { name: 'eno', target: owner });
  assert.equal(someArgs[1]?.type, 'scvAddress');
  assert.equal(scValToNative(someArgs[1]!), owner);
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


test('Blend-style Vec<UDT> is typed JSON guided and encodes through the Stellar SDK', () => {
  const owner = Keypair.random().publicKey();
  const requestType = udt('Request');
  const spec = specWith(
    udtStruct('Request', [
      ['address', xdr.ScSpecTypeDef.scSpecTypeAddress()],
      ['amount', xdr.ScSpecTypeDef.scSpecTypeI128()],
      ['request_type', xdr.ScSpecTypeDef.scSpecTypeU32()],
    ]),
    fn('submit', [input('requests', vec(requestType))]),
  );

  const method = describeContractSpec(spec)[0]!;
  assert.equal(method.name, 'submit');
  assert.equal(method.guided, true);
  assert.deepEqual(method.inputs[0]?.composition, { mode: 'typed_json', guided: true });
  assert.equal(method.inputs[0]?.kind, 'json');
  const abi = describeContractAbi(spec);
  const abiSubmit = abi.functions.find((item) => item.name === 'submit');
  assert.equal(abi.schema, 'fresnica-soroban-abi-v1');
  assert.deepEqual(abiSubmit?.inputs[0]?.composition, { mode: 'typed_json', guided: true });
  assert.deepEqual(abiSubmit?.inputs[0]?.type, {
    kind: 'vec',
    element: { kind: 'udt', name: 'Request' },
  });
  assert.deepEqual(method.inputs[0]?.abiType, {
    kind: 'vec',
    element: { kind: 'udt', name: 'Request' },
  });

  const args = contractArgumentsToScVals(spec, 'submit', {
    requests: [{ address: owner, amount: '10000000', request_type: 0 }],
  });
  assert.equal(args.length, 1);
  assert.equal(args[0]?.type, 'scvVec');
  const decoded = scValToNative(args[0]!);
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].address, owner);
  assert.equal(decoded[0].amount, 10000000n);
  assert.equal(decoded[0].request_type, 0);
});

test('typed UDT validation rejects unknown struct fields before SDK encoding can discard them', () => {
  const owner = Keypair.random().publicKey();
  const requestType = udt('Request');
  const spec = specWith(
    udtStruct('Request', [
      ['address', xdr.ScSpecTypeDef.scSpecTypeAddress()],
      ['amount', xdr.ScSpecTypeDef.scSpecTypeI128()],
      ['request_type', xdr.ScSpecTypeDef.scSpecTypeU32()],
    ]),
    fn('submit', [input('requests', vec(requestType))]),
  );

  assert.throws(
    () => contractArgumentsToScVals(spec, 'submit', {
      requests: [{
        address: owner,
        amount: '1',
        request_type: 0,
        extra: 'must-not-be-ignored',
      }],
    }),
    /requests\[0\]\.extra is not declared by struct Request/,
  );
  assert.throws(
    () => contractArgumentsToScVals(spec, 'submit', {
      requests: [{ address: owner, amount: '1' }],
    }),
    /requests\[0\]\.request_type is required by struct Request/,
  );
});


test('typed JSON recursively composes Map, Tuple and UDT Union inputs', () => {
  const owner = Keypair.random().publicKey();
  const noneCase = xdr.ScSpecUdtUnionCaseV0.scSpecUdtUnionCaseVoidV0(
    new xdr.ScSpecUdtUnionCaseVoidV0({ name: 'None', doc: '' }),
  );
  const amountCase = xdr.ScSpecUdtUnionCaseV0.scSpecUdtUnionCaseTupleV0(
    new xdr.ScSpecUdtUnionCaseTupleV0({
      name: 'Amount',
      doc: '',
      type: [xdr.ScSpecTypeDef.scSpecTypeI128()],
    }),
  );
  const action = xdr.ScSpecEntry.scSpecEntryUdtUnionV0(new xdr.ScSpecUdtUnionV0({
    name: 'Action',
    doc: '',
    lib: '',
    cases: [noneCase, amountCase],
  }));
  const actionType = udt('Action');
  const mapType = xdr.ScSpecTypeDef.scSpecTypeMap(new xdr.ScSpecTypeMap({
    keyType: xdr.ScSpecTypeDef.scSpecTypeAddress(),
    valueType: xdr.ScSpecTypeDef.scSpecTypeI128(),
  }));
  const tupleType = xdr.ScSpecTypeDef.scSpecTypeTuple(new xdr.ScSpecTypeTuple({
    valueTypes: [xdr.ScSpecTypeDef.scSpecTypeU32(), actionType],
  }));
  const spec = specWith(
    action,
    fn('compose', [input('balances', mapType), input('instruction', tupleType)]),
  );

  const method = describeContractSpec(spec)[0]!;
  assert.equal(method.guided, true);
  assert.deepEqual(method.inputs.map((item) => item.composition.mode), ['typed_json', 'typed_json']);

  const args = contractArgumentsToScVals(spec, 'compose', {
    balances: { [owner]: '9' },
    instruction: [7, { Amount: '5' }],
  });
  assert.equal(args[0]?.type, 'scvMap');
  assert.equal(args[1]?.type, 'scvVec');
  const balances = scValToNative(args[0]!) as Record<string, bigint>;
  assert.equal(balances[owner], 9n);
  const instruction = scValToNative(args[1]!);
  assert.equal(instruction[0], 7);
  assert.deepEqual(instruction[1], ['Amount', 5n]);
});

test('open-ended Val remains explicitly unguided instead of guessing a JSON representation', () => {
  const spec = specWith(fn('execute', [input('value', xdr.ScSpecTypeDef.scSpecTypeVal())]));
  const method = describeContractSpec(spec)[0]!;
  assert.equal(method.guided, false);
  assert.deepEqual(method.inputs[0]?.composition, { mode: 'dynamic_scval_json', guided: false });
  assert.throws(
    () => contractArgumentsToScVals(spec, 'execute', { value: { u32: 7 } }),
    /open-ended Soroban Val/,
  );
});
