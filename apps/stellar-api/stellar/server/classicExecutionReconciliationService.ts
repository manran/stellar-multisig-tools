import { loadTransactionByHash, type TransactionSubmissionResult } from '../../../../packages/stellar-core/src/horizon.js';
import { inspectTransactionXdr } from '../../../../packages/stellar-core/src/transactionXdr.js';
import type { ClassicExecutionEvidence, ClassicExecutionReconciliationResponse, ClassicTerminalExecutionEvidence } from '../../../../packages/stellar-core/src/requestTypes.js';
import { isExternalClassicRequest, successfulClassicEvidence, type SigningRequestStore, type StoredSigningRequest } from './requestStore.js';
import { probeClassicExecution } from './sorobanIntentExecutionReconciliationService.js';
import { SigningRequestServiceError } from './requestService.js';

function finiteTime(value: string | undefined): string | null {
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || !Number.isFinite(new Date(seconds * 1000).getTime())) return null;
  return new Date(seconds * 1000).toISOString();
}

export async function reconcileClassicExecution(
  store: SigningRequestStore,
  request: StoredSigningRequest,
  options: {
    now?: Date;
    transactionLoader?: typeof loadTransactionByHash;
    rpcProbe?: typeof probeClassicExecution;
  } = {},
): Promise<ClassicExecutionReconciliationResponse> {
  if (!isExternalClassicRequest(request)) {
    throw new SigningRequestServiceError('This operation requires an externally executed Classic Request.', 409, 'external_classic_request_required');
  }
  const base = { operation: 'integration.request.execution.reconcile' as const, version: 1 as const,
    requestId: request.id, network: request.network, transactionHash: request.transactionHash };
  const now = options.now ?? new Date();
  const existing = async (): Promise<ClassicTerminalExecutionEvidence | null> => {
    const evidence = await store.getExecutionEvidence?.(request.id);
    const submission = await store.getSubmission(request.id, request.transactionHash);
    return submission ? successfulClassicEvidence(submission) : evidence ?? null;
  };
  const previous = await existing();
  if (previous) return { ...base, ...previous, replayed: true };
  if (!store.putExecutionEvidence || !store.getExecutionEvidence) {
    throw new SigningRequestServiceError('Classic execution evidence storage is unavailable.', 503, 'execution_reconciliation_unavailable');
  }

  const inspection = inspectTransactionXdr(request.baseXdr, request.network);
  const validAfter = finiteTime(inspection.timeBounds?.minTime);
  const validUntil = finiteTime(inspection.timeBounds?.maxTime);
  let receipt: TransactionSubmissionResult | null = null;
  let proof: Awaited<ReturnType<typeof probeClassicExecution>>['proof'];
  // Either source can supply positive evidence. Absence requires the RPC
  // coverage proof, never a Horizon 404 or local expiry alone.
  try {
    receipt = await (options.transactionLoader ?? loadTransactionByHash)(request.transactionHash, request.network, AbortSignal.timeout(15000));
    if (receipt && (receipt.hash !== request.transactionHash || !Number.isSafeInteger(receipt.ledger) || receipt.ledger <= 0 || typeof receipt.successful !== 'boolean')) {
      throw new Error('Inconsistent Horizon receipt.');
    }
  } catch {
    receipt = null;
  }
  if (!receipt) {
    try {
      const result = await (options.rpcProbe ?? probeClassicExecution)(request.transactionHash, request.network, validAfter, validUntil, fetch, now);
      receipt = result.receipt ?? null;
      proof = result.proof;
    } catch {
      // An unavailable lookup leaves the outcome unknown, not failed.
    }
  }
  let evidence: ClassicExecutionEvidence = { outcome: 'unknown', observed: false };
  if (receipt && receipt.hash === request.transactionHash && Number.isSafeInteger(receipt.ledger) && receipt.ledger > 0 && typeof receipt.successful === 'boolean') {
    const observation = { transactionHash: request.transactionHash, ledger: receipt.ledger,
      submittedAt: receipt.createdAt ?? now.toISOString(),
      ...(receipt.ledgerTransactionHash ? { ledgerTransactionHash: receipt.ledgerTransactionHash } : {}) };
    evidence = receipt.successful
      ? { outcome: 'successful', observed: true, observation: { ...observation, successful: true } }
      : { outcome: 'failed', observed: true, observation: { ...observation, successful: false } };
    if (evidence.outcome === 'successful') {
      // Preserve the existing canonical receipt, Activity, and webhook path.
      await store.putSubmission(request.id, { version: 1, ...observation });
    }
  } else if (!receipt && proof && validAfter && validUntil
    && proof.validAfter === validAfter && proof.validUntil === validUntil
    && Date.parse(proof.oldestLedgerClosedAt) < Date.parse(validAfter)
    && Date.parse(proof.latestLedgerClosedAt) > Date.parse(validUntil)) {
    evidence = { outcome: 'not_included', observed: false, nonInclusionProof: proof };
  }

  if (evidence.outcome === 'failed' || evidence.outcome === 'not_included') await store.putExecutionEvidence(request.id, evidence);
  // A concurrent verified positive receipt takes precedence.
  const canonical = await existing();
  return { ...base, ...(canonical ?? evidence), replayed: false };
}
