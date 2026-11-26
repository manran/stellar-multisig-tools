import {
  Address,
  Asset,
  Networks,
  xdr,
  buildInvocationTree,
  inspectAuthEntry,
  scValToNative,
  StrKey,
} from '@stellar/stellar-sdk/base';
import type {
  CreateInvocation,
  ExecuteInvocation,
  InvocationTree,
} from '@stellar/stellar-sdk/base';

import type { StellarNetwork } from './types.js';

type ScAddress = Parameters<typeof Address.fromScAddress>[0];
type ScVal = Parameters<typeof scValToNative>[0];
type AuthorizationEntry = Parameters<typeof inspectAuthEntry>[0];

interface InvokeContractArgsShape {
  contractAddress: ScAddress;
  functionName: { toString(): string };
  args: ScVal[];
}

interface HostFunctionShape {
  type: string;
  value?: unknown;
}

interface InvokeHostFunctionOperationShape {
  type: string;
  func?: HostFunctionShape;
  auth?: AuthorizationEntry[];
}

export interface SorobanContractCallInspection {
  contractAddress: string;
  functionName: string;
  argumentPreviews: string[];
}

export interface SorobanInvocationInspection {
  type: 'execute' | 'create';
  label: string;
  detail?: string;
  argumentPreviews: string[];
  children: SorobanInvocationInspection[];
}

export interface SorobanAuthSignerInspection {
  address: string;
  signed: boolean;
  signatureFormat: 'ed25519' | 'custom' | 'none';
  signatureCount: number | null;
}

export type SorobanAuthorizationKind = 'source-account' | 'g-account' | 'contract-account' | 'delegated' | 'unknown';

export type SorobanAuthorizationVerification = 'transaction-envelope' | 'stellar-ed25519' | 'contract-check-auth' | 'delegated-contract' | 'unknown';

export interface SorobanAuthorizationEntryInspection {
  index: number;
  credentialType: string;
  authorizer: string | null;
  nonce: string | null;
  signatureExpirationLedger: number | null;
  signed: boolean;
  sourceAccountAuthorization: boolean;
  authorizationKind: SorobanAuthorizationKind;
  verificationModel: SorobanAuthorizationVerification;
  signers: SorobanAuthSignerInspection[];
  invocation: SorobanInvocationInspection | null;
  inspectionError?: string;
}

export interface SorobanOperationInspection {
  hostFunctionType: string;
  contractCall: SorobanContractCallInspection | null;
  authorizationEntries: SorobanAuthorizationEntryInspection[];
}

const MAX_PREVIEW_LENGTH = 160;
const MAX_COLLECTION_ITEMS = 4;

function truncate(value: string): string {
  return value.length <= MAX_PREVIEW_LENGTH
    ? value
    : `${value.slice(0, MAX_PREVIEW_LENGTH - 1)}…`;
}

function bytesPreview(value: Uint8Array): string {
  const shown = value.slice(0, 24);
  const hex = Array.from(shown, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `0x${hex}${value.length > shown.length ? '…' : ''}`;
}

export function previewSorobanValue(value: unknown, depth = 0): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return truncate(JSON.stringify(value));
  if (typeof value === 'bigint' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Uint8Array) return bytesPreview(value);
  if (depth >= 3) return '…';

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_COLLECTION_ITEMS).map((item) => previewSorobanValue(item, depth + 1));
    return truncate(`[${items.join(', ')}${value.length > items.length ? ', …' : ''}]`);
  }

  if (value instanceof Map) {
    const entries = [...value.entries()].slice(0, MAX_COLLECTION_ITEMS).map(
      ([key, item]) => `${previewSorobanValue(key, depth + 1)} => ${previewSorobanValue(item, depth + 1)}`,
    );
    return truncate(`{${entries.join(', ')}${value.size > entries.length ? ', …' : ''}}`);
  }

  if (typeof value === 'object') {
    const candidate = value as { toString?: () => string };
    if (typeof candidate.toString === 'function') {
      const rendered = candidate.toString();
      if (rendered !== '[object Object]') return truncate(rendered);
    }
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_COLLECTION_ITEMS);
    return truncate(`{${entries.map(([key, item]) => `${key}: ${previewSorobanValue(item, depth + 1)}`).join(', ')}${Object.keys(value as Record<string, unknown>).length > entries.length ? ', …' : ''}}`);
  }

  return truncate(String(value));
}

function invocationInspection(tree: InvocationTree): SorobanInvocationInspection {
  if (tree.type === 'execute') {
    const args = tree.args as ExecuteInvocation;
    return {
      type: 'execute',
      label: `${args.function} · ${args.source}`,
      detail: args.source,
      argumentPreviews: args.args.map((value) => previewSorobanValue(value)),
      children: tree.invocations.map(invocationInspection),
    };
  }

  const args = tree.args as CreateInvocation;
  let label = 'Create contract';
  let detail: string | undefined;
  let constructorArgs: unknown[] = [];
  if (args.type === 'sac') {
    label = 'Create Stellar Asset Contract';
    detail = args.asset;
  } else if (args.type === 'wasm' && args.wasm) {
    label = 'Create WASM contract';
    detail = args.wasm.hash;
    constructorArgs = args.wasm.constructorArgs ?? [];
  } else if (args.type === 'external' && args.external) {
    label = 'Create external executable contract';
    detail = `${args.external.owner} · ${previewSorobanValue(args.external.tag)}`;
    constructorArgs = args.external.constructorArgs ?? [];
  }
  return {
    type: 'create',
    label,
    detail,
    argumentPreviews: constructorArgs.map((value) => previewSorobanValue(value)),
    children: tree.invocations.map(invocationInspection),
  };
}

function inspectContractCall(func: HostFunctionShape): SorobanContractCallInspection | null {
  if (func.type !== 'hostFunctionTypeInvokeContract' || !func.value) return null;
  const args = func.value as InvokeContractArgsShape;
  return {
    contractAddress: Address.fromScAddress(args.contractAddress).toString(),
    functionName: args.functionName.toString(),
    argumentPreviews: args.args.map((value) => previewSorobanValue(scValToNative(value))),
  };
}

export interface SorobanCallSummary extends SorobanContractCallInspection {
  nativeXlmTransfer?: { from: string; to: string; amount: string };
  argumentNames?: string[];
  interfaceBasis?: 'current_contract';
  tokenTransfer?: { from: string; to: string; rawAmount: string; amount: string; symbol: string; decimals: number; observedLedger: number; basis: 'contract_reported' };
}

// Derive the review summary from the exact stored HostFunction, never from
// user-provided labels or a guess based only on the function name.
export function inspectSorobanHostFunctionXdr(encoded: string, network: StellarNetwork): SorobanCallSummary | null {
  try {
    const func = xdr.HostFunction.fromXdr(encoded, 'base64');
    const call = inspectContractCall(func);
    if (!call) return null;
    if (call.contractAddress !== Asset.native().contractId(network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC)
      || call.functionName !== 'transfer' || func.type !== 'hostFunctionTypeInvokeContract') return call;
    const values = func.value.args.map(value => scValToNative(value));
    const [from, to, raw] = values;
    if (values.length !== 3 || typeof from !== 'string' || typeof to !== 'string'
      || typeof raw !== 'bigint' || raw < 0n) return call;
    const amount = (raw / 10000000n).toString() + '.' + (raw % 10000000n).toString().padStart(7, '0');
    return { ...call, nativeXlmTransfer: { from, to, amount: amount.replace(/0+$/, '').replace(/\.$/, '') } };
  } catch {
    return null;
  }
}

export function enrichSorobanCallSummary(
  encoded: string, network: StellarNetwork,
  methods: readonly { name: string; inputs: readonly { name: string; typeLabel: string }[]; outputs: readonly string[] }[],
  metadata?: { symbol: string; decimals: number; observedLedger: number },
): SorobanCallSummary | null {
  const call = inspectSorobanHostFunctionXdr(encoded, network);
  if (!call) return null;
  const method = methods.find(item => item.name === call.functionName && item.inputs.length === call.argumentPreviews.length);
  if (!method) return call;
  const summary: SorobanCallSummary = { ...call, argumentNames: method.inputs.map(item => item.name), interfaceBasis: 'current_contract' };
  if (call.nativeXlmTransfer || !metadata || method.name !== 'transfer'
    || method.inputs.length !== 3 || method.inputs[0].typeLabel !== 'Address'
    || !['Address', 'MuxedAddress'].includes(method.inputs[1].typeLabel)
    || method.inputs[2].typeLabel !== 'I128'
    || !Number.isSafeInteger(metadata.decimals) || metadata.decimals < 0 || metadata.decimals > 38
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,23}$/.test(metadata.symbol)
    || !Number.isSafeInteger(metadata.observedLedger) || metadata.observedLedger <= 0) return summary;
  const func = xdr.HostFunction.fromXdr(encoded, 'base64');
  if (func.type !== 'hostFunctionTypeInvokeContract') return summary;
  const args = func.value.args;
  if (args[0]?.type !== 'scvAddress' || args[1]?.type !== 'scvAddress' || args[2]?.type !== 'scvI128') return summary;
  const [from, to, raw] = args.map(value => scValToNative(value));
  if (typeof from !== 'string' || typeof to !== 'string' || typeof raw !== 'bigint' || raw < 0n) return summary;
  const scale = 10n ** BigInt(metadata.decimals);
  const amount = metadata.decimals === 0 ? raw.toString()
    : ((raw / scale).toString() + '.' + (raw % scale).toString().padStart(metadata.decimals, '0')).replace(/0+$/, '').replace(/\.$/, '');
  return { ...summary, tokenTransfer: { from, to, rawAmount: raw.toString(), amount, ...metadata, basis: 'contract_reported' } };
}

/** Compact list label. Unknown contract amounts must not be represented as XLM. */
export function sorobanIntentCallTitle(encoded: string, network: StellarNetwork): string {
  const call = inspectSorobanHostFunctionXdr(encoded, network);
  if (call?.nativeXlmTransfer) return `Transfer ${call.nativeXlmTransfer.amount} XLM`;
  return call ? `Call ${call.functionName}` : 'Soroban Intent';
}

function authorizationClassification(info: ReturnType<typeof inspectAuthEntry>): {
  authorizationKind: SorobanAuthorizationKind;
  verificationModel: SorobanAuthorizationVerification;
} {
  if (info.credentialType === 'sourceAccount') {
    return { authorizationKind: 'source-account', verificationModel: 'transaction-envelope' };
  }
  if (info.credentialType === 'addressWithDelegates') {
    return { authorizationKind: 'delegated', verificationModel: 'delegated-contract' };
  }
  if (info.address && StrKey.isValidEd25519PublicKey(info.address)) {
    return { authorizationKind: 'g-account', verificationModel: 'stellar-ed25519' };
  }
  if (info.address && StrKey.isValidContract(info.address)) {
    return { authorizationKind: 'contract-account', verificationModel: 'contract-check-auth' };
  }
  return { authorizationKind: 'unknown', verificationModel: 'unknown' };
}

export function inspectSorobanAuthorizationEntry(
  entry: AuthorizationEntry,
  index = 0,
): SorobanAuthorizationEntryInspection {
  try {
    const info = inspectAuthEntry(entry);
    const classification = authorizationClassification(info);
    return {
      index,
      credentialType: info.credentialType,
      authorizer: info.address,
      nonce: info.nonce?.toString() ?? null,
      signatureExpirationLedger: info.signatureExpirationLedger,
      signed: info.signed,
      sourceAccountAuthorization: info.credentialType === 'sourceAccount',
      ...classification,
      signers: info.signers.map((signer) => ({
        address: signer.address,
        signed: signer.signed,
        signatureFormat: !signer.signed
          ? 'none'
          : signer.signatures === null
            ? 'custom'
            : 'ed25519',
        signatureCount: signer.signatures?.length ?? null,
      })),
      invocation: invocationInspection(buildInvocationTree(info.invocation)),
    };
  } catch (cause) {
    return {
      index,
      credentialType: 'unreadable',
      authorizer: null,
      nonce: null,
      signatureExpirationLedger: null,
      signed: false,
      sourceAccountAuthorization: false,
      authorizationKind: 'unknown',
      verificationModel: 'unknown',
      signers: [],
      invocation: null,
      inspectionError: cause instanceof Error ? cause.message : 'Authorization entry could not be inspected.',
    };
  }
}

export function inspectSorobanOperation(operationValue: unknown): SorobanOperationInspection | null {
  if (!operationValue || typeof operationValue !== 'object') return null;
  const operation = operationValue as InvokeHostFunctionOperationShape;
  if (operation.type !== 'invokeHostFunction' || !operation.func) return null;

  return {
    hostFunctionType: operation.func.type,
    contractCall: inspectContractCall(operation.func),
    authorizationEntries: (operation.auth ?? []).map((entry, index) => inspectSorobanAuthorizationEntry(entry, index)),
  };
}
