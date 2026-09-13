import { Address, Networks, Operation, StrKey, xdr } from '@stellar/stellar-sdk/base';
import type { Spec } from '@stellar/stellar-sdk/contract';
import type { ScSpecTypeDef, ScVal } from '@stellar/stellar-sdk/xdr';
import { stellarRpcUrl } from './sorobanRpc.js';
import type { StellarNetwork } from './types.js';

export type GuidedContractInputKind =
  | 'address'
  | 'bool'
  | 'integer'
  | 'string'
  | 'symbol'
  | 'bytes'
  | 'bytesN';

export interface ContractInputDescriptor {
  name: string;
  doc: string;
  typeLabel: string;
  kind: GuidedContractInputKind | 'unsupported';
  bytesLength?: number;
  unsupportedReason?: string;
}

export interface ContractMethodDescriptor {
  name: string;
  doc: string;
  inputs: ContractInputDescriptor[];
  outputs: string[];
  guided: boolean;
}

export interface LoadedContractInterface {
  spec: Spec;
  methods: ContractMethodDescriptor[];
}

function networkPassphrase(network: StellarNetwork): string {
  return network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
}

export function isValidContractId(value: string): boolean {
  return StrKey.isValidContract(value.trim());
}

export function contractTypeLabel(type: ScSpecTypeDef): string {
  switch (type.type) {
    case 'scSpecTypeVal': return 'Val';
    case 'scSpecTypeBool': return 'Bool';
    case 'scSpecTypeVoid': return 'Void';
    case 'scSpecTypeError': return 'Error';
    case 'scSpecTypeU32': return 'U32';
    case 'scSpecTypeI32': return 'I32';
    case 'scSpecTypeU64': return 'U64';
    case 'scSpecTypeI64': return 'I64';
    case 'scSpecTypeTimepoint': return 'Timepoint';
    case 'scSpecTypeDuration': return 'Duration';
    case 'scSpecTypeU128': return 'U128';
    case 'scSpecTypeI128': return 'I128';
    case 'scSpecTypeU256': return 'U256';
    case 'scSpecTypeI256': return 'I256';
    case 'scSpecTypeBytes': return 'Bytes';
    case 'scSpecTypeString': return 'String';
    case 'scSpecTypeSymbol': return 'Symbol';
    case 'scSpecTypeAddress': return 'Address';
    case 'scSpecTypeMuxedAddress': return 'MuxedAddress';
    case 'scSpecTypeBytesN': return `BytesN<${type.value.n}>`;
    case 'scSpecTypeOption': return `Option<${contractTypeLabel(type.value.valueType)}>`;
    case 'scSpecTypeVec': return `Vec<${contractTypeLabel(type.value.elementType)}>`;
    case 'scSpecTypeMap': return `Map<${contractTypeLabel(type.value.keyType)}, ${contractTypeLabel(type.value.valueType)}>`;
    case 'scSpecTypeTuple': return `Tuple<${type.value.valueTypes.map(contractTypeLabel).join(', ')}>`;
    case 'scSpecTypeResult': return `Result<${contractTypeLabel(type.value.okType)}, ${contractTypeLabel(type.value.errorType)}>`;
    case 'scSpecTypeUdt': return type.value.name.toString();
  }
}

function guidedInput(type: ScSpecTypeDef): Pick<ContractInputDescriptor, 'kind' | 'bytesLength' | 'unsupportedReason'> {
  switch (type.type) {
    case 'scSpecTypeAddress':
    case 'scSpecTypeMuxedAddress':
      return { kind: 'address' };
    case 'scSpecTypeBool':
      return { kind: 'bool' };
    case 'scSpecTypeU32':
    case 'scSpecTypeI32':
    case 'scSpecTypeU64':
    case 'scSpecTypeI64':
    case 'scSpecTypeTimepoint':
    case 'scSpecTypeDuration':
    case 'scSpecTypeU128':
    case 'scSpecTypeI128':
    case 'scSpecTypeU256':
    case 'scSpecTypeI256':
      return { kind: 'integer' };
    case 'scSpecTypeString':
      return { kind: 'string' };
    case 'scSpecTypeSymbol':
      return { kind: 'symbol' };
    case 'scSpecTypeBytes':
      return { kind: 'bytes' };
    case 'scSpecTypeBytesN':
      return { kind: 'bytesN', bytesLength: type.value.n };
    default:
      return {
        kind: 'unsupported',
        unsupportedReason: `${contractTypeLabel(type)} is visible from the contract spec but is not yet available in the guided composer. Import exact XDR for this method instead.`,
      };
  }
}

export function describeContractSpec(spec: Spec): ContractMethodDescriptor[] {
  return spec.funcs()
    .filter((func) => !func.name.toString().startsWith('__'))
    .map((func) => {
      const inputs = func.inputs.map((input): ContractInputDescriptor => ({
        name: input.name.toString(),
        doc: input.doc.toString(),
        typeLabel: contractTypeLabel(input.type),
        ...guidedInput(input.type),
      }));
      return {
        name: func.name.toString(),
        doc: func.doc.toString(),
        inputs,
        outputs: func.outputs.map(contractTypeLabel),
        guided: inputs.every((input) => input.kind !== 'unsupported'),
      };
    });
}

export async function loadContractInterface(
  contractId: string,
  network: StellarNetwork,
): Promise<LoadedContractInterface> {
  const normalized = contractId.trim();
  if (!isValidContractId(normalized)) throw new Error('Enter a valid Stellar C... contract address.');
  const { Client } = await import('@stellar/stellar-sdk/contract');
  const client = await Client.from({
    contractId: normalized,
    rpcUrl: stellarRpcUrl(network),
    networkPassphrase: networkPassphrase(network),
  });
  return { spec: client.spec, methods: describeContractSpec(client.spec) };
}

function parseHexBytes(value: string, exactLength?: number): Uint8Array {
  const normalized = value.trim().replace(/^0x/i, '');
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(normalized)) {
    throw new Error('Bytes must be hexadecimal with two characters per byte.');
  }
  const bytes = Uint8Array.from(normalized.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? []);
  if (exactLength !== undefined && bytes.length !== exactLength) {
    throw new Error(`Expected exactly ${exactLength} bytes (${exactLength * 2} hex characters).`);
  }
  return bytes;
}

function parseGuidedValue(type: ScSpecTypeDef, rawValue: string): unknown {
  const value = rawValue.trim();
  switch (type.type) {
    case 'scSpecTypeAddress':
    case 'scSpecTypeMuxedAddress':
      if (!value) throw new Error('Address is required.');
      return value;
    case 'scSpecTypeBool':
      if (value === 'true') return true;
      if (value === 'false') return false;
      throw new Error('Choose true or false.');
    case 'scSpecTypeU32':
    case 'scSpecTypeI32':
    case 'scSpecTypeU64':
    case 'scSpecTypeI64':
    case 'scSpecTypeTimepoint':
    case 'scSpecTypeDuration':
    case 'scSpecTypeU128':
    case 'scSpecTypeI128':
    case 'scSpecTypeU256':
    case 'scSpecTypeI256':
      if (!/^-?\d+$/.test(value)) throw new Error('Enter an integer in base 10.');
      return BigInt(value);
    case 'scSpecTypeString':
    case 'scSpecTypeSymbol':
      return rawValue;
    case 'scSpecTypeBytes':
      return parseHexBytes(rawValue);
    case 'scSpecTypeBytesN':
      return parseHexBytes(rawValue, type.value.n);
    default:
      throw new Error(`${contractTypeLabel(type)} is not supported by the guided composer yet.`);
  }
}

export function contractArgumentsToScVals(
  spec: Spec,
  methodName: string,
  rawValues: Record<string, string>,
): ScVal[] {
  const func = spec.getFunc(methodName);
  const args: Record<string, unknown> = {};
  for (const input of func.inputs) {
    const name = input.name.toString();
    try {
      args[name] = parseGuidedValue(input.type, rawValues[name] ?? '');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Invalid value.';
      throw new Error(`${name} (${contractTypeLabel(input.type)}): ${message}`);
    }
  }
  return spec.funcArgsToScVals(methodName, args);
}

export function contractCallOperation(
  contractId: string,
  methodName: string,
  args: ScVal[],
) {
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: Address.fromString(contractId.trim()).toScAddress(),
    functionName: methodName,
    args,
  });
  return Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs),
    auth: [],
  });
}
