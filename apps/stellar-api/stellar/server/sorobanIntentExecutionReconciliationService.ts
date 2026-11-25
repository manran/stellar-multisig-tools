import { FeeBumpTransaction, Networks, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { stellarRpcUrl } from '../../../../packages/stellar-core/src/sorobanRpc.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';
import type { ClassicExecutionNonInclusionProof } from '../../../../packages/stellar-core/src/requestTypes.js';
import {
  loadTransactionByHash,
  type TransactionSubmissionResult,
} from '../../../../packages/stellar-core/src/horizon.js';
import type {
  SorobanIntentStore,
  StoredSorobanIntentExecutionObservation,
  StoredSorobanIntentExecutionPreparation,
  SorobanExecutionNonInclusionProof,
} from './sorobanIntentStore.js';

export class SorobanIntentExecutionReconciliationServiceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly details?: unknown) {
    super(message);
    this.name = 'SorobanIntentExecutionReconciliationServiceError';
  }
}

type TransactionLoader = typeof loadTransactionByHash;

interface ReconciliationOptions {
  transactionLoader?: TransactionLoader;
  rpcProbe?: typeof probeSorobanExecution;
  now?: Date;
}

export interface SorobanIntentExecutionReconciliationResult {
  version: 1;
  intentId: string;
  network: 'public' | 'testnet';
  transactionHash: string;
  observed: boolean;
  replayed: boolean;
  observation?: StoredSorobanIntentExecutionObservation;
  nonInclusionProof?: SorobanExecutionNonInclusionProof;
  outcome: 'unknown' | 'not_included' | 'failed' | 'successful';
}
type RpcResult = Record<string, unknown>;
function rpcInteger(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d+$/.test(String(value))) return NaN;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : NaN;
}

type ExecutionCoverage =
  | { kind: 'prepared_ledger'; latestLedger: number; validUntil: string | null }
  | { kind: 'time_bounds'; validAfter: string | null; validUntil: string | null };

/** Both transaction types use the same RPC lookup and pre-lookup coverage check.
 * Classic envelopes may have existed before MST saw them: only their signed
 * lower time bound, not Request creation time, can establish coverage. */
export async function probeTransactionExecution(
  transactionHash: string,
  network: StellarNetwork,
  coverage: ExecutionCoverage,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<{ receipt?: TransactionSubmissionResult; proof?: SorobanExecutionNonInclusionProof; oldestLedgerClosedAt?: string }> {
  const rpc = async (method: string, params = {}): Promise<RpcResult> => {
    const response = await fetchImpl(stellarRpcUrl(network), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Stellar RPC unavailable.');
    const body = await response.json() as { result?: RpcResult; error?: unknown };
    if (body.error || !body.result || typeof body.result !== 'object') throw new Error('Invalid Stellar RPC response.');
    return body.result;
  };
  // Establish an ingested ledger beyond the time bound BEFORE checking the
  // hash. The range reported after a lookup alone can race with ingestion.
  const health = await rpc('getHealth');
  const result = await rpc('getTransaction', { hash: transactionHash, xdrFormat: 'base64' });
  if (result.status === 'SUCCESS' || result.status === 'FAILED') {
    if (typeof result.envelopeXdr !== 'string') throw new Error('Missing transaction envelope.');
    const tx = TransactionBuilder.fromXdr(result.envelopeXdr, network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC);
    const actual = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;
    const hash = Buffer.from(actual.hash()).toString('hex');
    if (hash !== transactionHash || !Number.isSafeInteger(result.ledger) || Number(result.ledger) <= 0) {
      throw new Error('Inconsistent Stellar RPC execution result.');
    }
    const timestamp = rpcInteger(result.createdAt);
    return { receipt: { hash, ledger: Number(result.ledger), successful: result.status === 'SUCCESS',
      ...(tx instanceof FeeBumpTransaction ? { ledgerTransactionHash: Buffer.from(tx.hash()).toString('hex') } : {}),
      ...(Number.isFinite(timestamp) ? { createdAt: new Date(timestamp * 1000).toISOString() } : {}) } };
  }
  if (result.status !== 'NOT_FOUND') throw new Error('Unknown Stellar RPC transaction status.');
  const oldest = rpcInteger(result.oldestLedger);
  const latest = rpcInteger(result.latestLedger);
  const priorOldest = rpcInteger(health.oldestLedger);
  const prior = rpcInteger(health.latestLedger);
  const priorClose = rpcInteger(health.latestLedgerCloseTime);
  const close = rpcInteger(result.latestLedgerCloseTime);
  const end = coverage.validUntil ? Date.parse(coverage.validUntil) : NaN;
  if (health.status !== 'healthy' || ![oldest, latest, priorOldest, prior, priorClose, close, end].every(Number.isFinite)
    || oldest > latest || priorOldest > prior
    || priorClose * 1000 <= end || latest < prior || close < priorClose) return {};
  let oldestLedgerClosedAt: string | undefined;
  if (coverage.kind === 'prepared_ledger') {
    if (!Number.isSafeInteger(coverage.latestLedger) || coverage.latestLedger <= 0
      || oldest > coverage.latestLedger || priorOldest > coverage.latestLedger || prior <= coverage.latestLedger) return {};
  } else {
    const start = coverage.validAfter ? Date.parse(coverage.validAfter) : NaN;
    const oldestClose = rpcInteger(result.oldestLedgerCloseTime);
    const priorOldestClose = rpcInteger(health.oldestLedgerCloseTime);
    // Strictly before the signed lower time bound, on both reads. An older
    // envelope with minTime=0 or pruned history cannot prove non-inclusion.
    if (![start, oldestClose, priorOldestClose].every(Number.isFinite) || start > end
      || oldestClose * 1000 >= start || priorOldestClose * 1000 >= start
      || oldestClose > close || priorOldestClose > priorClose) return {};
    oldestLedgerClosedAt = new Date(oldestClose * 1000).toISOString();
  }
  return { proof: {
    oldestLedger: oldest, latestLedger: latest,
    latestLedgerClosedAt: new Date(close * 1000).toISOString(), checkedAt: now.toISOString(),
  }, ...(oldestLedgerClosedAt ? { oldestLedgerClosedAt } : {}) };
}

export async function probeSorobanExecution(
  preparation: StoredSorobanIntentExecutionPreparation,
  network: StellarNetwork,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<{ receipt?: TransactionSubmissionResult; proof?: SorobanExecutionNonInclusionProof }> {
  return probeTransactionExecution(preparation.transactionHash, network, {
    kind: 'prepared_ledger', latestLedger: preparation.latestLedger, validUntil: preparation.validUntil,
  }, fetchImpl, now);
}

export async function probeClassicExecution(
  transactionHash: string,
  network: StellarNetwork,
  validAfter: string | null,
  validUntil: string | null,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<{ receipt?: TransactionSubmissionResult; proof?: ClassicExecutionNonInclusionProof }> {
  const result = await probeTransactionExecution(transactionHash, network, { kind: 'time_bounds', validAfter, validUntil }, fetchImpl, now);
  return { ...(result.receipt ? { receipt: result.receipt } : {}),
    ...(result.proof && result.oldestLedgerClosedAt && validAfter && validUntil
      ? { proof: { ...result.proof, oldestLedgerClosedAt: result.oldestLedgerClosedAt, validAfter, validUntil } } : {}) };
}

function normalizeTransactionHash(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new SorobanIntentExecutionReconciliationServiceError(
      'A valid prepared transaction hash is required.',
      400,
      'invalid_execution_transaction_hash',
    );
  }
  return normalized;
}

function verifiedObservation(
  result: TransactionSubmissionResult,
  preparation: Awaited<ReturnType<NonNullable<SorobanIntentStore['listExecutionPreparations']>>>[number],
  observedAt: string,
): StoredSorobanIntentExecutionObservation {
  return {
    version: 1,
    transactionHash: preparation.transactionHash,
    authorizationPlanDigest: preparation.authorizationPlanDigest,
    authorizationPlanRevision: preparation.authorizationPlanRevision,
    executionSource: preparation.executionSource,
    ledger: result.ledger,
    successful: result.successful,
    observedAt,
    ...(result.createdAt ? { networkCreatedAt: result.createdAt } : {}),
  };
}
export async function reconcileSorobanIntentExecution(
  store: SorobanIntentStore,
  id: string,
  transactionHash: string,
  options: ReconciliationOptions = {},
): Promise<SorobanIntentExecutionReconciliationResult> {
  const normalizedHash = normalizeTransactionHash(transactionHash);
  const stored = await store.getIntent(id);
  if (!stored) {
    throw new SorobanIntentExecutionReconciliationServiceError(
      'Soroban Intent not found.',
      404,
      'intent_not_found',
    );
  }
  if (!store.listExecutionPreparations || !store.getExecutionObservation || !store.putExecutionObservation) {
    throw new SorobanIntentExecutionReconciliationServiceError(
      'Soroban execution-result storage is unavailable.',
      503,
      'intent_execution_reconciliation_unavailable',
    );
  }

  const preparations = await store.listExecutionPreparations(id);
  const matches = preparations.filter((item) => item.transactionHash.toLowerCase() === normalizedHash);
  const preparation = [...matches].sort((a, b) => a.latestLedger - b.latestLedger)[0];
  if (!preparation) {
    throw new SorobanIntentExecutionReconciliationServiceError(
      'This transaction hash is not a persisted execution preparation for this Soroban Intent.',
      404,
      'intent_execution_preparation_not_found',
    );
  }
  const existing = await store.getExecutionObservation(id, normalizedHash);
  if (existing) {
    return {
      version: 1,
      intentId: stored.id,
      network: stored.network,
      transactionHash: normalizedHash,
      observed: true,
      replayed: true,
      observation: existing,
      outcome: existing.successful ? 'successful' : 'failed',
    };
  }

  if (matches.every((item) => item.nonInclusionProof)) {
    return { version: 1, intentId: stored.id, network: stored.network, transactionHash: normalizedHash,
      observed: false, replayed: true, outcome: 'not_included', nonInclusionProof: preparation.nonInclusionProof };
  }

  let networkResult: TransactionSubmissionResult | null;
  let proof: SorobanExecutionNonInclusionProof | undefined;
  try {
    networkResult = await (options.transactionLoader ?? loadTransactionByHash)(normalizedHash, stored.network, AbortSignal.timeout(15000));
    // A fee bump may have a different outer hash. Verify the inner envelope
    // against the prepared hash; do not mistake an outer-hash receipt for absence.
    if ((!networkResult || networkResult.hash.toLowerCase() !== normalizedHash) && (options.rpcProbe || !options.transactionLoader)) {
      const probe = await (options.rpcProbe ?? probeSorobanExecution)(preparation, stored.network, fetch, options.now);
      if (probe.receipt) networkResult = probe.receipt;
      if (!networkResult) proof = probe.proof;
    }
  } catch (cause) {
    throw new SorobanIntentExecutionReconciliationServiceError(
      cause instanceof Error
        ? `Unable to verify this prepared transaction on Stellar: ${cause.message}`
        : 'Unable to verify this prepared transaction on Stellar.',
      503,
      'intent_execution_reconciliation_unavailable',
    );
  }

  if (!networkResult) {
    if (proof && store.recordExecutionNonInclusion) {
      await store.recordExecutionNonInclusion(id, normalizedHash, proof);
      // A concurrent positive receipt wins over non-inclusion.
      const observed = await store.getExecutionObservation(id, normalizedHash);
      if (observed) return { version: 1, intentId: stored.id, network: stored.network, transactionHash: normalizedHash, observed: true, replayed: true, observation: observed, outcome: observed.successful ? 'successful' : 'failed' };
      return { version: 1, intentId: stored.id, network: stored.network, transactionHash: normalizedHash, observed: false, replayed: false, outcome: 'not_included', nonInclusionProof: proof };
    }
    return {
      version: 1,
      intentId: stored.id,
      network: stored.network,
      transactionHash: normalizedHash,
      observed: false,
      replayed: false,
      outcome: 'unknown',
    };
  }
  if (networkResult.hash.toLowerCase() !== normalizedHash || typeof networkResult.successful !== 'boolean' || !Number.isSafeInteger(networkResult.ledger) || networkResult.ledger <= 0) {
    throw new SorobanIntentExecutionReconciliationServiceError(
      'Stellar returned an inconsistent transaction result for this prepared hash.',
      503,
      'intent_execution_reconciliation_unavailable',
    );
  }

  const observation = verifiedObservation(
    networkResult,
    preparation,
    (options.now ?? new Date()).toISOString(),
  );
  await store.putExecutionObservation(id, observation);
  return {
    version: 1,
    intentId: stored.id,
    network: stored.network,
    transactionHash: normalizedHash,
    observed: true,
    replayed: false,
    observation,
    outcome: observation.successful ? 'successful' : 'failed',
  };
}
