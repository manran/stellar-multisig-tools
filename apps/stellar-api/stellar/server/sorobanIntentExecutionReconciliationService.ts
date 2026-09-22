import {
  loadTransactionByHash,
  type TransactionSubmissionResult,
} from '../../../../packages/stellar-core/src/horizon.js';
import type {
  SorobanIntentStore,
  StoredSorobanIntentExecutionObservation,
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
  const preparation = preparations.find((item) => item.transactionHash.toLowerCase() === normalizedHash);
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
    };
  }

  let networkResult: TransactionSubmissionResult | null;
  try {
    networkResult = await (options.transactionLoader ?? loadTransactionByHash)(normalizedHash, stored.network);
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
    return {
      version: 1,
      intentId: stored.id,
      network: stored.network,
      transactionHash: normalizedHash,
      observed: false,
      replayed: false,
    };
  }
  if (networkResult.hash.toLowerCase() !== normalizedHash || !Number.isSafeInteger(networkResult.ledger) || networkResult.ledger <= 0) {
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
  };
}
