import {
  FeeBumpTransaction,
  Networks,
  Operation,
  TimeoutInfinite,
  TransactionBuilder,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk/base';
import {
  inspectSorobanAuthorizationEntry,
  previewSorobanValue,
} from './sorobanInspection.js';
import type { SorobanAuthorizationEntryInspection } from './sorobanInspection.js';
import { sorobanEffectsSnapshot, type SorobanEffectsSnapshot } from './sorobanEffects.js';
import type { TransactionXdrInspection } from './transactionXdr.js';
import { assembleTransaction } from '@stellar/stellar-sdk/rpc';
import type { StellarNetwork } from './types.js';

export const DEFAULT_STELLAR_RPC_PUBLIC_URL = 'https://rpc.lightsail.network/';
export const DEFAULT_STELLAR_RPC_TESTNET_URL = 'https://soroban-testnet.stellar.org/';

export interface StellarRpcEndpointOverrides {
  public?: string;
  testnet?: string;
}

export type SorobanSimulationErrorKind =
  | 'unsupported'
  | 'configuration'
  | 'unavailable'
  | 'invalid';

export class SorobanSimulationError extends Error {
  constructor(
    readonly kind: SorobanSimulationErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'SorobanSimulationError';
  }
}

export interface SorobanSimulationEligibility {
  supported: boolean;
  reason?: string;
}

export interface SorobanSimulationSummary {
  endpointUrl: string;
  network: StellarNetwork;
  transactionHash: string;
  latestLedger: number;
  minResourceFee: string | null;
  transactionDataXdr: string | null;
  returnValuePreview: string | null;
  authorizationEntries: SorobanAuthorizationEntryInspection[];
  effects: SorobanEffectsSnapshot;
  eventCount: number;
  stateChangeCount: number;
  restoreRequired: boolean;
  cpuInstructions: string | null;
  memoryBytes: string | null;
  assembledXdr: string | null;
}


interface SimulateTransactionResultShape {
  latestLedger?: unknown;
  minResourceFee?: unknown;
  transactionData?: unknown;
  events?: unknown;
  stateChanges?: unknown;
  restorePreamble?: unknown;
  cost?: {
    cpuInsns?: unknown;
    memBytes?: unknown;
  };
  results?: Array<{
    auth?: unknown;
    xdr?: unknown;
  }>;
  error?: unknown;
}

interface JsonRpcResponseShape {
  result?: SimulateTransactionResultShape;
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

function networkPassphrase(network: StellarNetwork): string {
  return network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function configuredEndpoint(network: StellarNetwork): string | undefined {
  return network === 'testnet'
    ? process.env.STELLAR_RPC_TESTNET_URL
    : process.env.STELLAR_RPC_PUBLIC_URL;
}

export function stellarRpcUrl(
  network: StellarNetwork,
  overrides: StellarRpcEndpointOverrides = {},
): string {
  const configured = network === 'testnet'
    ? overrides.testnet ?? configuredEndpoint(network)
    : overrides.public ?? configuredEndpoint(network);
  const trimmed = configured?.trim();
  if (trimmed) return trimmed;
  return network === 'testnet'
    ? DEFAULT_STELLAR_RPC_TESTNET_URL
    : DEFAULT_STELLAR_RPC_PUBLIC_URL;
}

function validateEndpoint(endpointUrl: string): string {
  try {
    const parsed = new URL(endpointUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('unsupported protocol');
    }
    return parsed.toString();
  } catch {
    throw new SorobanSimulationError(
      'configuration',
      'The configured Stellar RPC endpoint is not a valid HTTP(S) URL.',
    );
  }
}

async function requestSorobanSimulation({
  normalized,
  endpointUrl,
  fetchImpl,
  timeoutMs,
  authMode,
  requestId,
}: {
  normalized: string;
  endpointUrl: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  authMode: 'record' | 'enforce';
  requestId: string;
}): Promise<{ endpointUrl: string; result: SimulateTransactionResultShape & { latestLedger: number } }> {
  const resolvedEndpoint = validateEndpoint(endpointUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(resolvedEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: requestId,
        method: 'simulateTransaction',
        params: {
          transaction: normalized,
          xdrFormat: 'base64',
          authMode,
        },
      }),
      signal: controller.signal,
    });
  } catch (cause) {
    const timedOut = cause instanceof DOMException && cause.name === 'AbortError';
    throw new SorobanSimulationError(
      'unavailable',
      timedOut
        ? 'The Stellar RPC simulation timed out. The transaction has not been marked invalid.'
        : 'The Stellar RPC provider could not be reached. The transaction has not been marked invalid.',
    );
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new SorobanSimulationError(
      'unavailable',
      `The Stellar RPC provider returned HTTP ${response.status}. The transaction has not been marked invalid.`,
    );
  }
  let payload: JsonRpcResponseShape;
  try {
    payload = await response.json() as JsonRpcResponseShape;
  } catch {
    throw new SorobanSimulationError(
      'unavailable',
      'The Stellar RPC provider returned an unreadable response. The transaction has not been marked invalid.',
    );
  }
  if (payload.error) {
    const detail = typeof payload.error.message === 'string' ? ` ${payload.error.message}` : '';
    throw new SorobanSimulationError(
      'unavailable',
      `The Stellar RPC request failed before a simulation result was produced.${detail}`,
    );
  }
  const result = payload.result;
  if (!result || typeof result.latestLedger !== 'number') {
    throw new SorobanSimulationError(
      'unavailable',
      'The Stellar RPC provider did not return a complete simulation result.',
    );
  }
  if (typeof result.error === 'string' && result.error) {
    throw new SorobanSimulationError('invalid', result.error);
  }
  return { endpointUrl: resolvedEndpoint, result: result as SimulateTransactionResultShape & { latestLedger: number } };
}

export function sorobanSimulationEligibility(
  inspection: TransactionXdrInspection,
): SorobanSimulationEligibility {
  if (inspection.envelopeType === 'fee_bump') {
    return {
      supported: false,
      reason: 'RPC simulation is not enabled for fee-bump envelopes in this read-only milestone.',
    };
  }
  if (
    inspection.operations.length !== 1
    || inspection.operations[0]?.type !== 'invokeHostFunction'
  ) {
    return {
      supported: false,
      reason: 'RPC simulation currently requires exactly one InvokeHostFunction operation.',
    };
  }
  return { supported: true };
}

function decodeAuthorizationEntries(result: SimulateTransactionResultShape) {
  const results = Array.isArray(result.results) ? result.results : [];
  const encoded = results.flatMap((item) =>
    item && typeof item === 'object' && Array.isArray(item.auth)
      ? item.auth.filter((value): value is string => typeof value === 'string')
      : [],
  );
  try {
    return encoded.map((value) => xdr.SorobanAuthorizationEntry.fromXdr(value, 'base64'));
  } catch {
    throw new SorobanSimulationError(
      'unavailable',
      'The RPC provider returned authorization data that could not be decoded.',
    );
  }
}

function simulationEffects(result: SimulateTransactionResultShape): SorobanEffectsSnapshot {
  try {
    return sorobanEffectsSnapshot(result.stateChanges, result.events);
  } catch {
    throw new SorobanSimulationError(
      'unavailable',
      'The Stellar RPC provider returned simulation effects that could not be decoded. The transaction has not been marked invalid.',
    );
  }
}

function returnValuePreview(result: SimulateTransactionResultShape): string | null {
  const encoded = result.results?.[0]?.xdr;
  if (typeof encoded !== 'string' || !encoded) return null;
  try {
    return previewSorobanValue(scValToNative(xdr.ScVal.fromXdr(encoded, 'base64')));
  } catch {
    return 'Return value could not be decoded.';
  }
}

function cleanAssemblyBase(
  parsed: Exclude<ReturnType<typeof TransactionBuilder.fromXdr>, FeeBumpTransaction>,
  network: StellarNetwork,
) {
  const operation = parsed.operations[0];
  if (!operation || operation.type !== 'invokeHostFunction') {
    throw new SorobanSimulationError(
      'unsupported',
      'RPC assembly currently requires exactly one InvokeHostFunction operation.',
    );
  }
  const envelope = parsed.toEnvelope();
  const oldResourceFee = envelope.type === 'envelopeTypeTx' && envelope.value.tx.ext.type === 'sorobanData'
    ? envelope.value.tx.ext.value.resourceFee
    : 0n;
  const totalFee = BigInt(parsed.fee);
  const classicFee = totalFee - oldResourceFee;
  if (classicFee < 0n) {
    throw new SorobanSimulationError(
      'unsupported',
      'The imported Soroban transaction fee is smaller than its embedded resource fee.',
    );
  }
  const builder = TransactionBuilder.cloneFrom(parsed, {
    networkPassphrase: networkPassphrase(network),
    fee: classicFee.toString(),
  });
  builder.clearOperations();
  builder.addOperation(Operation.invokeHostFunction({
    source: operation.source,
    func: operation.func,
    auth: [],
  }));
  if (!parsed.timeBounds) builder.setTimeout(TimeoutInfinite);
  return builder.build();
}

function preserveImportedPreconditions(
  original: Exclude<ReturnType<typeof TransactionBuilder.fromXdr>, FeeBumpTransaction>,
  assembled: Exclude<ReturnType<typeof TransactionBuilder.fromXdr>, FeeBumpTransaction>,
): string {
  const originalEnvelope = original.toEnvelope();
  const assembledEnvelope = assembled.toEnvelope();
  if (originalEnvelope.type !== 'envelopeTypeTx' || assembledEnvelope.type !== 'envelopeTypeTx') {
    throw new SorobanSimulationError('unsupported', 'Soroban assembly requires a v1 transaction envelope.');
  }
  const source = originalEnvelope.value.tx;
  const result = assembledEnvelope.value.tx;
  const transaction = new xdr.Transaction({
    sourceAccount: source.sourceAccount,
    fee: result.fee,
    seqNum: source.seqNum,
    cond: source.cond,
    memo: source.memo,
    operations: result.operations,
    ext: result.ext,
  });
  return xdr.TransactionEnvelope.envelopeTypeTx(
    new xdr.TransactionV1Envelope({ tx: transaction, signatures: [] }),
  ).toXdr('base64');
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function assertPreparedResourcesCoverSimulation(
  parsed: Exclude<ReturnType<typeof TransactionBuilder.fromXdr>, FeeBumpTransaction>,
  result: SimulateTransactionResultShape,
): void {
  const envelope = parsed.toEnvelope();
  if (envelope.type !== 'envelopeTypeTx' || envelope.value.tx.ext.type !== 'sorobanData') {
    throw new SorobanSimulationError('invalid', 'The frozen transaction is missing Soroban resource limits.');
  }
  if (typeof result.transactionData !== 'string' || !result.transactionData) {
    throw new SorobanSimulationError('unavailable', 'The enforcing simulation did not return Soroban resource requirements.');
  }

  let required: xdr.SorobanTransactionData;
  try {
    required = xdr.SorobanTransactionData.fromXdr(result.transactionData, 'base64');
  } catch {
    throw new SorobanSimulationError('unavailable', 'The enforcing simulation returned unreadable Soroban resource requirements.');
  }
  const declared = envelope.value.tx.ext.value;
  const deficits: string[] = [];
  if (required.resources.instructions > declared.resources.instructions) deficits.push('CPU instructions');
  if (required.resources.diskReadBytes > declared.resources.diskReadBytes) deficits.push('disk reads');
  if (required.resources.writeBytes > declared.resources.writeBytes) deficits.push('ledger writes');

  const declaredReadOnly = new Set(declared.resources.footprint.readOnly.map((key) => key.toXdr('base64')));
  const declaredReadWrite = new Set(declared.resources.footprint.readWrite.map((key) => key.toXdr('base64')));
  const missingRead = required.resources.footprint.readOnly.some((key) => {
    const encoded = key.toXdr('base64');
    return !declaredReadOnly.has(encoded) && !declaredReadWrite.has(encoded);
  });
  const missingWrite = required.resources.footprint.readWrite.some((key) => !declaredReadWrite.has(key.toXdr('base64')));
  if (missingRead || missingWrite) deficits.push('ledger footprint');

  const minResourceFee = stringOrNull(result.minResourceFee);
  if (minResourceFee !== null) {
    try {
      if (BigInt(minResourceFee) > declared.resourceFee) deficits.push('resource fee');
    } catch {
      throw new SorobanSimulationError('unavailable', 'The enforcing simulation returned an invalid minimum resource fee.');
    }
  }
  if (deficits.length > 0) {
    throw new SorobanSimulationError(
      'invalid',
      `The frozen Soroban resource budget is stale (${deficits.join(', ')}). Create a fresh Proposal before submitting.`,
    );
  }
}

export async function simulateSorobanTransaction({
  envelopeXdr,
  network,
  endpointUrl = stellarRpcUrl(network),
  fetchImpl = fetch,
  timeoutMs = 15_000,
}: {
  envelopeXdr: string;
  network: StellarNetwork;
  endpointUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<SorobanSimulationSummary> {
  const normalized = envelopeXdr.trim();
  if (!normalized) {
    throw new SorobanSimulationError('unsupported', 'No transaction XDR is available to simulate.');
  }

  let parsed: ReturnType<typeof TransactionBuilder.fromXdr>;
  try {
    parsed = TransactionBuilder.fromXdr(normalized, networkPassphrase(network));
  } catch {
    throw new SorobanSimulationError('unsupported', 'The reviewed XDR could not be parsed for this network.');
  }
  if (parsed instanceof FeeBumpTransaction) {
    throw new SorobanSimulationError(
      'unsupported',
      'RPC simulation is not enabled for fee-bump envelopes in this read-only milestone.',
    );
  }
  if (parsed.operations.length !== 1 || parsed.operations[0]?.type !== 'invokeHostFunction') {
    throw new SorobanSimulationError(
      'unsupported',
      'RPC simulation currently requires exactly one InvokeHostFunction operation.',
    );
  }

  // Recording mode must discover the complete current authorization topology.
  // Existing imported AUTH entries are evidence to preserve later, not an input
  // footprint for RPC recording; Stellar RPC rejects record mode with auth set.
  const recordingXdr = cleanAssemblyBase(parsed, network).toXDR();
  const simulation = await requestSorobanSimulation({
    normalized: recordingXdr,
    endpointUrl,
    fetchImpl,
    timeoutMs,
    authMode: 'record',
    requestId: 'multisigtools-soroban-review',
  });
  const resolvedEndpoint = simulation.endpointUrl;
  const result = simulation.result;

  const authorizationEntries = decodeAuthorizationEntries(result)
    .map(inspectSorobanAuthorizationEntry);
  const effects = simulationEffects(result);
  let assembledXdr: string | null = null;
  if (parsed.signatures.length === 0 && !result.restorePreamble) {
    try {
      // Assembly consumes only execution inputs. Diagnostic events/state changes
      // are deliberately excluded so malformed review-only metadata cannot alter
      // the transaction that will later be frozen for signing.
      const assemblyResult = {
        latestLedger: result.latestLedger,
        minResourceFee: result.minResourceFee,
        transactionData: result.transactionData,
        results: result.results,
      };
      // Existing draft auth cannot define the new preparation topology: the SDK
      // intentionally preserves any existing auth array over simulation auth.
      // Start assembly from the same transaction body with auth cleared so the
      // current simulation result is the complete authorization requirement set.
      const assemblyBase = cleanAssemblyBase(parsed, network);
      const assembled = assembleTransaction(
        assemblyBase,
        assemblyResult as Parameters<typeof assembleTransaction>[1],
      ).build();
      assembledXdr = preserveImportedPreconditions(parsed, assembled);
    } catch {
      // Review facts may still be useful even when the provider response cannot
      // be assembled safely. Leave preparation disabled instead of turning a
      // readable simulation into transaction-invalid evidence.
      assembledXdr = null;
    }
  }

  return {
    endpointUrl: resolvedEndpoint,
    network,
    transactionHash: bytesToHex(parsed.hash()),
    latestLedger: result.latestLedger,
    minResourceFee: stringOrNull(result.minResourceFee),
    transactionDataXdr: stringOrNull(result.transactionData),
    returnValuePreview: returnValuePreview(result),
    authorizationEntries,
    effects,
    eventCount: countArray(result.events),
    stateChangeCount: countArray(result.stateChanges),
    restoreRequired: Boolean(result.restorePreamble),
    cpuInstructions: stringOrNull(result.cost?.cpuInsns),
    memoryBytes: stringOrNull(result.cost?.memBytes),
    assembledXdr,
  };
}

export async function prepareEnforcedSorobanTransaction({
  envelopeXdr,
  network,
  endpointUrl = stellarRpcUrl(network),
  fetchImpl = fetch,
  timeoutMs = 15_000,
}: {
  envelopeXdr: string;
  network: StellarNetwork;
  endpointUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<{ endpointUrl: string; latestLedger: number; assembledXdr: string; effects: SorobanEffectsSnapshot }> {
  const normalized = envelopeXdr.trim();
  if (!normalized) {
    throw new SorobanSimulationError('unsupported', 'No transaction XDR is available to enforce and prepare.');
  }
  let parsed: ReturnType<typeof TransactionBuilder.fromXdr>;
  try {
    parsed = TransactionBuilder.fromXdr(normalized, networkPassphrase(network));
  } catch {
    throw new SorobanSimulationError('unsupported', 'The staged XDR could not be parsed for this network.');
  }
  if (parsed instanceof FeeBumpTransaction
    || parsed.operations.length !== 1
    || parsed.operations[0]?.type !== 'invokeHostFunction') {
    throw new SorobanSimulationError(
      'unsupported',
      'Enforced Soroban preparation requires one non-fee-bump InvokeHostFunction transaction.',
    );
  }
  if (parsed.signatures.length > 0) {
    throw new SorobanSimulationError(
      'unsupported',
      'Enforced Soroban preparation must finish before transaction-envelope signatures are collected.',
    );
  }
  const existingAuth = parsed.operations[0].auth ?? [];
  if (existingAuth.length === 0) {
    throw new SorobanSimulationError(
      'unsupported',
      'Enforced Soroban preparation requires finalized authorization entries.',
    );
  }
  const simulation = await requestSorobanSimulation({
    normalized,
    endpointUrl,
    fetchImpl,
    timeoutMs,
    authMode: 'enforce',
    requestId: 'multisigtools-soroban-enforce-prepare',
  });
  if (simulation.result.restorePreamble) {
    throw new SorobanSimulationError(
      'unsupported',
      'Enforced Soroban preparation requires a restore transaction before this authorization can be frozen.',
    );
  }
  const effects = simulationEffects(simulation.result);
  const assemblyResult = {
    latestLedger: simulation.result.latestLedger,
    minResourceFee: simulation.result.minResourceFee,
    transactionData: simulation.result.transactionData,
    results: simulation.result.results,
  };
  let assembledXdr: string;
  try {
    const builder = assembleTransaction(
      parsed,
      assemblyResult as Parameters<typeof assembleTransaction>[1],
    );
    if (!parsed.timeBounds) builder.setTimeout(TimeoutInfinite);
    const assembled = builder.build();
    assembledXdr = preserveImportedPreconditions(parsed, assembled);
  } catch {
    throw new SorobanSimulationError(
      'unavailable',
      'The enforcing simulation succeeded but its resource data could not be assembled safely.',
    );
  }
  const prepared = TransactionBuilder.fromXdr(assembledXdr, networkPassphrase(network));
  if (prepared instanceof FeeBumpTransaction || prepared.operations[0]?.type !== 'invokeHostFunction') {
    throw new SorobanSimulationError('unavailable', 'Enforced Soroban preparation produced an unexpected transaction shape.');
  }
  const preparedAuth = prepared.operations[0].auth ?? [];
  const existingAuthXdr = existingAuth.map((entry) => entry.toXdr('base64'));
  const preparedAuthXdr = preparedAuth.map((entry) => entry.toXdr('base64'));
  if (existingAuthXdr.length !== preparedAuthXdr.length
    || existingAuthXdr.some((value, index) => value !== preparedAuthXdr[index])) {
    throw new SorobanSimulationError(
      'unavailable',
      'Enforced Soroban preparation changed finalized authorization entries.',
    );
  }
  return {
    endpointUrl: simulation.endpointUrl,
    latestLedger: simulation.result.latestLedger,
    assembledXdr,
    effects,
  };
}

export async function enforcePreparedSorobanTransaction({
  envelopeXdr,
  network,
  endpointUrl = stellarRpcUrl(network),
  fetchImpl = fetch,
  timeoutMs = 15_000,
}: {
  envelopeXdr: string;
  network: StellarNetwork;
  endpointUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<{ endpointUrl: string; latestLedger: number; effects: SorobanEffectsSnapshot }> {
  const normalized = envelopeXdr.trim();
  if (!normalized) {
    throw new SorobanSimulationError('unsupported', 'No transaction XDR is available to verify.');
  }
  let parsed: ReturnType<typeof TransactionBuilder.fromXdr>;
  try {
    parsed = TransactionBuilder.fromXdr(normalized, networkPassphrase(network));
  } catch {
    throw new SorobanSimulationError('unsupported', 'The frozen XDR could not be parsed for this network.');
  }
  if (parsed instanceof FeeBumpTransaction
    || parsed.operations.length !== 1
    || parsed.operations[0]?.type !== 'invokeHostFunction') {
    throw new SorobanSimulationError(
      'unsupported',
      'Soroban execution verification currently requires one non-fee-bump InvokeHostFunction transaction.',
    );
  }
  const simulation = await requestSorobanSimulation({
    normalized,
    endpointUrl,
    fetchImpl,
    timeoutMs,
    authMode: 'enforce',
    requestId: 'multisigtools-soroban-freeze-verify',
  });
  assertPreparedResourcesCoverSimulation(parsed, simulation.result);
  const effects = sorobanEffectsSnapshot(simulation.result.stateChanges, simulation.result.events);
  return {
    endpointUrl: simulation.endpointUrl,
    latestLedger: simulation.result.latestLedger,
    effects,
  };
}
