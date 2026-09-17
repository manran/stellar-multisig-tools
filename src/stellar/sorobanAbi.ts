import type { Spec } from '@stellar/stellar-sdk/contract';
import type { ScSpecTypeDef, ScVal } from '@stellar/stellar-sdk/xdr';

export const CONTRACT_ABI_SCHEMA = 'fresnica-soroban-abi-v1';

export type ContractInputCompositionMode =
  | 'typed_json'
  | 'dynamic_scval_json'
  | 'scval_xdr_success_only'
  | 'unsupported';

export interface ContractInputCompositionDescriptor {
  mode: ContractInputCompositionMode;
  guided: boolean;
}

export type ContractAbiTypeDescriptor =
  | { kind: 'primitive'; name: string }
  | { kind: 'option'; value: ContractAbiTypeDescriptor }
  | { kind: 'result'; ok: ContractAbiTypeDescriptor; error: ContractAbiTypeDescriptor }
  | { kind: 'vec'; element: ContractAbiTypeDescriptor }
  | { kind: 'map'; key: ContractAbiTypeDescriptor; value: ContractAbiTypeDescriptor }
  | { kind: 'tuple'; values: ContractAbiTypeDescriptor[] }
  | { kind: 'bytes_n'; length: number }
  | { kind: 'udt'; name: string };

export interface ContractAbiFieldDescriptor {
  name: string;
  doc: string;
  type: ContractAbiTypeDescriptor;
}

export interface ContractAbiUnionCaseDescriptor {
  name: string;
  doc: string;
  payload: { kind: 'void' } | { kind: 'tuple'; values: ContractAbiTypeDescriptor[] };
}

export interface ContractAbiEnumCaseDescriptor {
  name: string;
  doc: string;
  value: number;
}

export type ContractUserTypeDescriptor =
  | { kind: 'struct'; name: string; doc: string; lib: string; fields: ContractAbiFieldDescriptor[] }
  | { kind: 'union'; name: string; doc: string; lib: string; cases: ContractAbiUnionCaseDescriptor[] }
  | { kind: 'enum'; name: string; doc: string; lib: string; cases: ContractAbiEnumCaseDescriptor[] }
  | { kind: 'error_enum'; name: string; doc: string; lib: string; cases: ContractAbiEnumCaseDescriptor[] };

export interface ContractAbiFunctionInputDescriptor {
  name: string;
  doc: string;
  type: ContractAbiTypeDescriptor;
  example: string | null;
  composition: ContractInputCompositionDescriptor;
}

export interface ContractAbiFunctionOutputDescriptor {
  type: ContractAbiTypeDescriptor;
  example: string | null;
}

export interface ContractAbiFunctionDescriptor {
  name: string;
  doc: string;
  inputs: ContractAbiFunctionInputDescriptor[];
  outputs: ContractAbiFunctionOutputDescriptor[];
}

export interface ContractAbiDescriptor {
  schema: typeof CONTRACT_ABI_SCHEMA;
  functions: ContractAbiFunctionDescriptor[];
  types: ContractUserTypeDescriptor[];
}

export type GuidedContractInputKind =
  | 'address'
  | 'bool'
  | 'integer'
  | 'string'
  | 'symbol'
  | 'bytes'
  | 'bytesN'
  | 'json';

export interface ContractInputDescriptor {
  name: string;
  doc: string;
  typeLabel: string;
  abiType: ContractAbiTypeDescriptor;
  composition: ContractInputCompositionDescriptor;
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

function primitiveAbiName(type: ScSpecTypeDef): string {
  switch (type.type) {
    case 'scSpecTypeVal': return 'val';
    case 'scSpecTypeBool': return 'bool';
    case 'scSpecTypeVoid': return 'void';
    case 'scSpecTypeError': return 'error';
    case 'scSpecTypeU32': return 'u32';
    case 'scSpecTypeI32': return 'i32';
    case 'scSpecTypeU64': return 'u64';
    case 'scSpecTypeI64': return 'i64';
    case 'scSpecTypeTimepoint': return 'timepoint';
    case 'scSpecTypeDuration': return 'duration';
    case 'scSpecTypeU128': return 'u128';
    case 'scSpecTypeI128': return 'i128';
    case 'scSpecTypeU256': return 'u256';
    case 'scSpecTypeI256': return 'i256';
    case 'scSpecTypeBytes': return 'bytes';
    case 'scSpecTypeString': return 'string';
    case 'scSpecTypeSymbol': return 'symbol';
    case 'scSpecTypeAddress': return 'address';
    case 'scSpecTypeMuxedAddress': return 'muxed_address';
    default: throw new Error(`${contractTypeLabel(type)} is not a primitive ABI type.`);
  }
}

export function contractAbiType(type: ScSpecTypeDef): ContractAbiTypeDescriptor {
  switch (type.type) {
    case 'scSpecTypeOption': return { kind: 'option', value: contractAbiType(type.value.valueType) };
    case 'scSpecTypeResult': return {
      kind: 'result',
      ok: contractAbiType(type.value.okType),
      error: contractAbiType(type.value.errorType),
    };
    case 'scSpecTypeVec': return { kind: 'vec', element: contractAbiType(type.value.elementType) };
    case 'scSpecTypeMap': return {
      kind: 'map',
      key: contractAbiType(type.value.keyType),
      value: contractAbiType(type.value.valueType),
    };
    case 'scSpecTypeTuple': return { kind: 'tuple', values: type.value.valueTypes.map(contractAbiType) };
    case 'scSpecTypeBytesN': return { kind: 'bytes_n', length: type.value.n };
    case 'scSpecTypeUdt': return { kind: 'udt', name: type.value.name.toString() };
    default: return { kind: 'primitive', name: primitiveAbiName(type) };
  }
}

function enumCases(value: { cases: Array<{ name: { toString(): string }; doc: { toString(): string }; value: number }> }): ContractAbiEnumCaseDescriptor[] {
  return value.cases.map((item) => ({
    name: item.name.toString(),
    doc: item.doc.toString(),
    value: item.value,
  }));
}

function userTypeDescriptor(entry: Spec['entries'][number]): ContractUserTypeDescriptor | null {
  switch (entry.type) {
    case 'scSpecEntryUdtStructV0': return {
      kind: 'struct',
      name: entry.value.name.toString(),
      doc: entry.value.doc.toString(),
      lib: entry.value.lib.toString(),
      fields: entry.value.fields.map((field) => ({
        name: field.name.toString(),
        doc: field.doc.toString(),
        type: contractAbiType(field.type),
      })),
    };
    case 'scSpecEntryUdtUnionV0': return {
      kind: 'union',
      name: entry.value.name.toString(),
      doc: entry.value.doc.toString(),
      lib: entry.value.lib.toString(),
      cases: entry.value.cases.map((item) => item.type === 'scSpecUdtUnionCaseVoidV0'
        ? {
            name: item.value.name.toString(),
            doc: item.value.doc.toString(),
            payload: { kind: 'void' as const },
          }
        : {
            name: item.value.name.toString(),
            doc: item.value.doc.toString(),
            payload: { kind: 'tuple' as const, values: item.value.type.map(contractAbiType) },
          }),
    };
    case 'scSpecEntryUdtEnumV0': return {
      kind: 'enum',
      name: entry.value.name.toString(),
      doc: entry.value.doc.toString(),
      lib: entry.value.lib.toString(),
      cases: enumCases(entry.value),
    };
    case 'scSpecEntryUdtErrorEnumV0': return {
      kind: 'error_enum',
      name: entry.value.name.toString(),
      doc: entry.value.doc.toString(),
      lib: entry.value.lib.toString(),
      cases: enumCases(entry.value),
    };
    default: return null;
  }
}

export function describeContractAbi(spec: Spec): ContractAbiDescriptor {
  return {
    schema: CONTRACT_ABI_SCHEMA,
    functions: spec.funcs().map((func) => ({
      name: func.name.toString(),
      doc: func.doc.toString(),
      inputs: func.inputs.map((input) => {
        const mode = compositionMode(spec, input.type);
        return {
          name: input.name.toString(),
          doc: input.doc.toString(),
          type: contractAbiType(input.type),
          example: null,
          composition: { mode, guided: mode === 'typed_json' },
        };
      }),
      outputs: func.outputs.map((output) => ({
        type: contractAbiType(output),
        example: null,
      })),
    })),
    types: spec.entries.map(userTypeDescriptor).filter((item): item is ContractUserTypeDescriptor => item !== null),
  };
}

function mergeComposition(
  left: ContractInputCompositionMode,
  right: ContractInputCompositionMode,
): ContractInputCompositionMode {
  const rank: Record<ContractInputCompositionMode, number> = {
    typed_json: 0,
    dynamic_scval_json: 1,
    scval_xdr_success_only: 2,
    unsupported: 3,
  };
  return rank[left] >= rank[right] ? left : right;
}

function canonicalStructShape(fields: Array<{ name: { toString(): string } }>): 'tuple' | 'named' | null {
  const names = fields.map((field) => field.name.toString());
  if (names.length === 0) return 'named';
  const numeric = names.map((name) => /^\d+$/.test(name));
  if (numeric.some(Boolean)) {
    if (!numeric.every(Boolean)) return null;
    return names.every((name, index) => name === String(index)) ? 'tuple' : null;
  }
  for (let index = 1; index < names.length; index += 1) {
    if (names[index - 1]! >= names[index]!) return null;
  }
  return 'named';
}

function compositionMode(
  spec: Spec,
  type: ScSpecTypeDef,
  visiting = new Set<string>(),
): ContractInputCompositionMode {
  switch (type.type) {
    case 'scSpecTypeVal': return 'dynamic_scval_json';
    case 'scSpecTypeError': return 'unsupported';
    case 'scSpecTypeResult':
      return compositionMode(spec, type.value.okType, visiting) === 'unsupported'
        ? 'unsupported'
        : 'scval_xdr_success_only';
    case 'scSpecTypeOption': return compositionMode(spec, type.value.valueType, visiting);
    case 'scSpecTypeVec': return compositionMode(spec, type.value.elementType, visiting);
    case 'scSpecTypeMap': return mergeComposition(
      compositionMode(spec, type.value.keyType, visiting),
      compositionMode(spec, type.value.valueType, visiting),
    );
    case 'scSpecTypeTuple': return type.value.valueTypes.reduce<ContractInputCompositionMode>(
      (mode, value) => mergeComposition(mode, compositionMode(spec, value, visiting)),
      'typed_json',
    );
    case 'scSpecTypeUdt': {
      const name = type.value.name.toString();
      if (visiting.has(name)) return 'typed_json';
      const next = new Set(visiting);
      next.add(name);
      let entry;
      try {
        entry = spec.findEntry(name);
      } catch {
        return 'unsupported';
      }
      switch (entry.type) {
        case 'scSpecEntryUdtStructV0':
          if (!canonicalStructShape(entry.value.fields)) return 'unsupported';
          return entry.value.fields.reduce(
            (mode: ContractInputCompositionMode, field: (typeof entry.value.fields)[number]) => mergeComposition(mode, compositionMode(spec, field.type, next)),
            'typed_json',
          );
        case 'scSpecEntryUdtUnionV0':
          return entry.value.cases.reduce((mode: ContractInputCompositionMode, item: (typeof entry.value.cases)[number]) => {
            if (item.type === 'scSpecUdtUnionCaseVoidV0') return mode;
            return item.value.type.reduce(
              (caseMode: ContractInputCompositionMode, value: ScSpecTypeDef) => mergeComposition(caseMode, compositionMode(spec, value, next)),
              mode,
            );
          }, 'typed_json');
        case 'scSpecEntryUdtEnumV0': return 'typed_json';
        case 'scSpecEntryUdtErrorEnumV0': return 'unsupported';
        default: return 'unsupported';
      }
    }
    default: return 'typed_json';
  }
}

function inputKind(type: ScSpecTypeDef, mode: ContractInputCompositionMode): Pick<ContractInputDescriptor, 'kind' | 'bytesLength' | 'unsupportedReason'> {
  if (mode !== 'typed_json') {
    const reason = mode === 'dynamic_scval_json'
      ? `${contractTypeLabel(type)} contains open-ended Soroban Val data and is not available in typed guided input.`
      : mode === 'scval_xdr_success_only'
        ? `${contractTypeLabel(type)} has no stable complete-domain typed JSON input; use an exact reviewed ScVal/XDR path.`
        : `${contractTypeLabel(type)} cannot be safely composed from typed JSON.`;
    return { kind: 'unsupported', unsupportedReason: reason };
  }
  if (type.type === 'scSpecTypeOption') return inputKind(type.value.valueType, mode);
  switch (type.type) {
    case 'scSpecTypeAddress':
    case 'scSpecTypeMuxedAddress': return { kind: 'address' };
    case 'scSpecTypeBool': return { kind: 'bool' };
    case 'scSpecTypeU32':
    case 'scSpecTypeI32':
    case 'scSpecTypeU64':
    case 'scSpecTypeI64':
    case 'scSpecTypeTimepoint':
    case 'scSpecTypeDuration':
    case 'scSpecTypeU128':
    case 'scSpecTypeI128':
    case 'scSpecTypeU256':
    case 'scSpecTypeI256': return { kind: 'integer' };
    case 'scSpecTypeString': return { kind: 'string' };
    case 'scSpecTypeSymbol': return { kind: 'symbol' };
    case 'scSpecTypeBytes': return { kind: 'bytes' };
    case 'scSpecTypeBytesN': return { kind: 'bytesN', bytesLength: type.value.n };
    default: return { kind: 'json' };
  }
}

export function describeContractSpec(spec: Spec): ContractMethodDescriptor[] {
  return spec.funcs()
    .filter((func) => !func.name.toString().startsWith('__'))
    .map((func) => {
      const inputs = func.inputs.map((input): ContractInputDescriptor => {
        const mode = compositionMode(spec, input.type);
        return {
          name: input.name.toString(),
          doc: input.doc.toString(),
          typeLabel: contractTypeLabel(input.type),
          abiType: contractAbiType(input.type),
          composition: { mode, guided: mode === 'typed_json' },
          ...inputKind(input.type, mode),
        };
      });
      return {
        name: func.name.toString(),
        doc: func.doc.toString(),
        inputs,
        outputs: func.outputs.map(contractTypeLabel),
        guided: inputs.every((input) => input.composition.guided),
      };
    });
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function structuredValue(value: unknown, path: string): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) throw new Error(`${path} requires JSON.`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${path} requires valid JSON.`);
  }
}

function integerValue(value: unknown, path: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${path} must be a safe base-10 integer or a decimal string.`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return BigInt(value.trim());
  throw new Error(`${path} must be an integer in base 10.`);
}

function mapKeyInput(key: string, type: ScSpecTypeDef): unknown {
  switch (type.type) {
    case 'scSpecTypeString':
    case 'scSpecTypeSymbol':
    case 'scSpecTypeAddress':
    case 'scSpecTypeMuxedAddress': return key;
    case 'scSpecTypeBool': return key === 'true' ? true : key === 'false' ? false : key;
    case 'scSpecTypeU32':
    case 'scSpecTypeI32':
    case 'scSpecTypeU64':
    case 'scSpecTypeI64':
    case 'scSpecTypeTimepoint':
    case 'scSpecTypeDuration':
    case 'scSpecTypeU128':
    case 'scSpecTypeI128':
    case 'scSpecTypeU256':
    case 'scSpecTypeI256': return key;
    default:
      try {
        return JSON.parse(key) as unknown;
      } catch {
        return key;
      }
  }
}

function normalizeUdtValue(spec: Spec, typeName: string, rawValue: unknown, path: string): unknown {
  const entry = spec.findEntry(typeName);
  const value = typeof rawValue === 'string' && /^[\[{\"]/.test(rawValue.trim())
    ? structuredValue(rawValue, path)
    : rawValue;

  switch (entry.type) {
    case 'scSpecEntryUdtStructV0': {
      const shape = canonicalStructShape(entry.value.fields);
      if (!shape) throw new Error(`${path} uses a noncanonical struct shape that is not safe for guided composition.`);
      if (shape === 'tuple') {
        const tuple = structuredValue(value, path);
        if (!Array.isArray(tuple)) throw new Error(`${path} must be a JSON array.`);
        if (tuple.length !== entry.value.fields.length) {
          throw new Error(`${path} requires ${entry.value.fields.length} values but ${tuple.length} were provided.`);
        }
        return entry.value.fields.map((field, index) => normalizeTypedValue(
          spec,
          field.type,
          tuple[index],
          `${path}[${index}]`,
        ));
      }
      if (!isPlainObject(value)) throw new Error(`${path} must be a JSON object.`);
      const fields = new Map(entry.value.fields.map((field) => [field.name.toString(), field]));
      for (const key of Object.keys(value)) {
        if (!fields.has(key)) throw new Error(`${path}.${key} is not declared by struct ${typeName}.`);
      }
      const result: Record<string, unknown> = {};
      for (const field of entry.value.fields) {
        const name = field.name.toString();
        if (!Object.prototype.hasOwnProperty.call(value, name)) {
          throw new Error(`${path}.${name} is required by struct ${typeName}.`);
        }
        result[name] = normalizeTypedValue(spec, field.type, value[name], `${path}.${name}`);
      }
      return result;
    }
    case 'scSpecEntryUdtUnionV0': {
      let tag = '';
      let payload: unknown;
      let nativeShape = false;
      if (typeof value === 'string') {
        tag = value;
      } else if (isPlainObject(value) && typeof value.tag === 'string') {
        tag = value.tag;
        payload = value.values;
        nativeShape = true;
        for (const key of Object.keys(value)) {
          if (key !== 'tag' && key !== 'values') throw new Error(`${path}.${key} is not valid union input.`);
        }
      } else if (isPlainObject(value) && Object.keys(value).length === 1) {
        tag = Object.keys(value)[0]!;
        payload = value[tag];
      } else {
        throw new Error(`${path} must identify exactly one union case.`);
      }
      const unionCase = entry.value.cases.find((item) => item.value.name.toString() === tag);
      if (!unionCase) throw new Error(`${path} uses unknown union case ${JSON.stringify(tag)} for ${typeName}.`);
      if (unionCase.type === 'scSpecUdtUnionCaseVoidV0') {
        if (nativeShape && payload !== undefined) throw new Error(`${path} case ${tag} does not accept values.`);
        if (!nativeShape && isPlainObject(value)) throw new Error(`${path} case ${tag} is a void case and must be supplied as the case name.`);
        return { tag };
      }
      const types = unionCase.value.type;
      const supplied = nativeShape
        ? payload
        : types.length === 1
          ? [payload]
          : payload;
      if (!Array.isArray(supplied)) throw new Error(`${path} case ${tag} requires ${types.length} value(s).`);
      if (supplied.length !== types.length) {
        throw new Error(`${path} case ${tag} requires ${types.length} values but ${supplied.length} were provided.`);
      }
      return {
        tag,
        values: types.map((item, index) => normalizeTypedValue(spec, item, supplied[index], `${path}.${tag}[${index}]`)),
      };
    }
    case 'scSpecEntryUdtEnumV0': {
      const numeric = integerValue(value, path);
      if (numeric < 0n || numeric > 4294967295n) throw new Error(`${path} is outside the u32 enum range.`);
      const asNumber = Number(numeric);
      if (!entry.value.cases.some((item) => item.value === asNumber)) {
        throw new Error(`${path} uses unknown enum value ${asNumber} for ${typeName}.`);
      }
      return asNumber;
    }
    case 'scSpecEntryUdtErrorEnumV0':
      throw new Error(`${path} is an error enum and is not available as ordinary guided input.`);
    default:
      throw new Error(`${path} references ${typeName}, which is not a value UDT.`);
  }
}

function normalizeTypedValue(spec: Spec, type: ScSpecTypeDef, rawValue: unknown, path: string): unknown {
  switch (type.type) {
    case 'scSpecTypeAddress':
    case 'scSpecTypeMuxedAddress': {
      if (typeof rawValue !== 'string' || !rawValue.trim()) throw new Error(`${path} requires an address.`);
      return rawValue.trim();
    }
    case 'scSpecTypeBool':
      if (rawValue === true || rawValue === false) return rawValue;
      if (rawValue === 'true') return true;
      if (rawValue === 'false') return false;
      throw new Error(`${path} must be true or false.`);
    case 'scSpecTypeU32':
    case 'scSpecTypeI32':
    case 'scSpecTypeU64':
    case 'scSpecTypeI64':
    case 'scSpecTypeTimepoint':
    case 'scSpecTypeDuration':
    case 'scSpecTypeU128':
    case 'scSpecTypeI128':
    case 'scSpecTypeU256':
    case 'scSpecTypeI256': return integerValue(rawValue, path);
    case 'scSpecTypeString':
    case 'scSpecTypeSymbol':
      if (typeof rawValue !== 'string') throw new Error(`${path} must be text.`);
      return rawValue;
    case 'scSpecTypeBytes':
      if (typeof rawValue !== 'string') throw new Error(`${path} must be hexadecimal bytes.`);
      return parseHexBytes(rawValue);
    case 'scSpecTypeBytesN':
      if (typeof rawValue !== 'string') throw new Error(`${path} must be hexadecimal bytes.`);
      return parseHexBytes(rawValue, type.value.n);
    case 'scSpecTypeVoid':
      if (rawValue !== null) throw new Error(`${path} must be null.`);
      return null;
    case 'scSpecTypeOption':
      if (rawValue === null || rawValue === undefined || rawValue === '') return null;
      return normalizeTypedValue(spec, type.value.valueType, rawValue, path);
    case 'scSpecTypeVec': {
      const value = structuredValue(rawValue, path);
      if (!Array.isArray(value)) throw new Error(`${path} must be a JSON array.`);
      return value.map((item, index) => normalizeTypedValue(spec, type.value.elementType, item, `${path}[${index}]`));
    }
    case 'scSpecTypeMap': {
      const value = structuredValue(rawValue, path);
      const pairs: unknown[][] = Array.isArray(value)
        ? value.map((item, index) => {
            if (!Array.isArray(item) || item.length !== 2) throw new Error(`${path}[${index}] must be a [key, value] pair.`);
            return item;
          })
        : isPlainObject(value)
          ? Object.entries(value).map(([key, item]) => [mapKeyInput(key, type.value.keyType), item])
          : (() => { throw new Error(`${path} must be a JSON object or an array of [key, value] pairs.`); })();
      return pairs.map(([key, item], index) => [
        normalizeTypedValue(spec, type.value.keyType, key, `${path}[${index}].key`),
        normalizeTypedValue(spec, type.value.valueType, item, `${path}[${index}].value`),
      ]);
    }
    case 'scSpecTypeTuple': {
      const value = structuredValue(rawValue, path);
      if (!Array.isArray(value)) throw new Error(`${path} must be a JSON array.`);
      if (value.length !== type.value.valueTypes.length) {
        throw new Error(`${path} requires ${type.value.valueTypes.length} values but ${value.length} were provided.`);
      }
      return type.value.valueTypes.map((item, index) => normalizeTypedValue(spec, item, value[index], `${path}[${index}]`));
    }
    case 'scSpecTypeUdt': return normalizeUdtValue(spec, type.value.name.toString(), rawValue, path);
    case 'scSpecTypeVal':
      throw new Error(`${path} contains open-ended Soroban Val data and requires an explicit ScVal representation.`);
    case 'scSpecTypeResult':
      throw new Error(`${path} is a Result value and has no stable complete-domain typed JSON representation.`);
    case 'scSpecTypeError':
      throw new Error(`${path} is runtime error metadata and is not ordinary guided input.`);
  }
}

export function contractArgumentsToScVals(
  spec: Spec,
  methodName: string,
  rawValues: Record<string, unknown>,
): ScVal[] {
  const func = spec.getFunc(methodName);
  const expected = new Set(func.inputs.map((input) => input.name.toString()));
  for (const name of Object.keys(rawValues)) {
    if (!expected.has(name)) throw new Error(`Unknown contract argument ${name}.`);
  }

  const args: Record<string, unknown> = {};
  for (const input of func.inputs) {
    const name = input.name.toString();
    const supplied = Object.prototype.hasOwnProperty.call(rawValues, name);
    if (!supplied && input.type.type !== 'scSpecTypeOption') {
      throw new Error(`${name} (${contractTypeLabel(input.type)}): value is required.`);
    }
    const mode = compositionMode(spec, input.type);
    if (mode !== 'typed_json') {
      throw new Error(`${name} (${contractTypeLabel(input.type)}): ${inputKind(input.type, mode).unsupportedReason}`);
    }
    try {
      args[name] = normalizeTypedValue(spec, input.type, supplied ? rawValues[name] : null, name);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Invalid value.';
      throw new Error(`${name} (${contractTypeLabel(input.type)}): ${message}`);
    }
  }
  return spec.funcArgsToScVals(methodName, args);
}
