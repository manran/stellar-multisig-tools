import { createHash } from 'node:crypto';
import type { AgentActorProvenance } from '../src/stellar/agentAccessTypes.js';
import { FeeBumpTransaction, Networks, TransactionBuilder } from '@stellar/stellar-sdk/base';
import {
  loadAccount,
  loadTransactionByHash,
  submitTransactionXdr,
  TransactionSubmissionError,
} from '../src/stellar/horizon.js';
import type { StellarNetworkParameters, TransactionSubmissionResult } from '../src/stellar/horizon.js';
import { assessTransactionPreconditions } from '../src/stellar/transactionPreconditions.js';
import { analyzeEnvelopeSignatures } from '../src/stellar/signatureAnalysis.js';
import { mergeSignedTransactionXdr, transactionHashHex } from '../src/stellar/signatureMerge.js';
import { analyzeTransactionAuthorization } from '../src/stellar/transactionAuthorization.js';
import type {
  AccountLookupResult,
  TransactionAuthorizationStatus,
} from '../src/stellar/transactionAuthorization.js';
import { inspectTransactionXdr } from '../src/stellar/transactionXdr.js';
import {
  analyzeSorobanGAccountAuthorization,
  assertSorobanTransactionPreparedForFreeze,
} from '../src/stellar/sorobanAuthorization.js';
import { analyzeKnownSorobanContractAuthorization } from '../src/stellar/sorobanContractAdapter.js';
import { compareSorobanEffects, type SorobanEffectsSnapshot } from '../src/stellar/sorobanEffects.js';
import type { TransactionXdrInspection } from '../src/stellar/transactionXdr.js';
import type {
  SigningRequestSnapshot,
  SigningRequestStatusReason,
  SigningRequestSubmission,
} from '../src/stellar/requestTypes.js';
import type { StellarAccountSnapshot, StellarNetwork, StellarSigner } from '../src/stellar/types.js';
import { createSigningRequestId, isValidSigningRequestId } from './requestLocator.js';
import { requestDiscoverySignerKeys } from './requestDiscovery.js';
import type {
  SigningRequestStore,
  StoredAcceptedSignature,
  StoredSigningRequestReadFacts,
  StoredSignatureContribution,
  StoredSigningRequest,
  StoredSubmissionResult,
} from './requestStore.js';

const REQUEST_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_XDR_CHARS = 256 * 1024;

export class SigningRequestServiceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = 'SigningRequestServiceError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type AccountLoader = (
  accountId: string,
  network: StellarNetwork,
) => Promise<StellarAccountSnapshot>;

export type NetworkParametersLoader = (
  network: StellarNetwork,
) => Promise<StellarNetworkParameters>;

export type TransactionLoader = (
  hash: string,
  network: StellarNetwork,
) => Promise<TransactionSubmissionResult | null>;

export type TransactionSubmitter = (
  envelopeXdr: string,
  network: StellarNetwork,
) => Promise<TransactionSubmissionResult>;

export type SorobanExecutionVerificationResult =
  | { status: 'verified'; effects?: SorobanEffectsSnapshot }
  | { status: 'invalid'; detail: string }
  | { status: 'unavailable'; detail: string };

export type SorobanExecutionVerifier = (
  envelopeXdr: string,
  network: StellarNetwork,
) => Promise<SorobanExecutionVerificationResult>;

interface EnvelopeAnalysis {
  inspection: TransactionXdrInspection;
  accountLookups: AccountLookupResult[];
  authorization: TransactionAuthorizationStatus;
  unrecognizedSignatureIndexes: number[];
  sorobanEffects?: SorobanEffectsSnapshot;
}

interface RequestServiceOptions {
  now?: Date;
  accountLoader?: AccountLoader;
  networkParametersLoader?: NetworkParametersLoader;
  transactionLoader?: TransactionLoader;
  sorobanExecutionVerifier?: SorobanExecutionVerifier;
  capabilityHash?: string;
}

interface SubmitRequestOptions extends RequestServiceOptions {
  transactionSubmitter?: TransactionSubmitter;
  acceptedEffectsDigest?: string;
}

function normalizeXdr(xdr: string): string {
  const normalized = xdr.trim();
  if (!normalized) throw new SigningRequestServiceError('Transaction envelope XDR is required.', 400, 'invalid_xdr');
  if (normalized.length > MAX_XDR_CHARS) throw new SigningRequestServiceError('Transaction envelope XDR is too large.', 413, 'xdr_too_large');
  return normalized;
}

function validateNetwork(network: unknown): StellarNetwork {
  if (network === 'public' || network === 'testnet') return network;
  throw new SigningRequestServiceError('Network must be public or testnet.', 400, 'invalid_network');
}

function validateRequestId(id: string): string {
  if (!isValidSigningRequestId(id)) {
    throw new SigningRequestServiceError('Invalid signing request id.', 400, 'invalid_request_id');
  }
  return id;
}

function signerTypeForKey(key: string): string {
  if (key.startsWith('G')) return 'ed25519_public_key';
  if (key.startsWith('T')) return 'preauth_tx';
  if (key.startsWith('X')) return 'sha256_hash';
  if (key.startsWith('P')) return 'ed25519_signed_payload';
  return 'unknown';
}

async function loadPolicies(
  inspection: TransactionXdrInspection,
  network: StellarNetwork,
  accountLoader: AccountLoader,
): Promise<AccountLookupResult[]> {
  const accountIds = [...new Set(inspection.sourceRequirements.map((requirement) => requirement.accountId))];
  try {
    return await Promise.all(accountIds.map(async (accountId) => ({
      accountId,
      account: await accountLoader(accountId, network),
    })));
  } catch (cause) {
    throw new SigningRequestServiceError(
      cause instanceof Error ? `Unable to refresh signer policy: ${cause.message}` : 'Unable to refresh signer policy.',
      503,
      'policy_unavailable',
    );
  }
}

function recognizedSignatureIndexes(
  envelopeXdr: string,
  network: StellarNetwork,
  inspection: TransactionXdrInspection,
  accountLookups: AccountLookupResult[],
): Set<number> {
  const recognized = new Set<number>();
  for (const lookup of accountLookups) {
    if (!lookup.account) continue;
    const analysis = analyzeEnvelopeSignatures(envelopeXdr, network, lookup.account.signers, 'inner');
    for (const match of analysis.matchedSigners) {
      if (match.signatureIndex !== undefined) recognized.add(match.signatureIndex);
    }
  }

  if (inspection.extraSigners.length > 0) {
    const signers: StellarSigner[] = inspection.extraSigners.map((key) => ({
      key,
      type: signerTypeForKey(key),
      weight: 1,
    }));
    const analysis = analyzeEnvelopeSignatures(envelopeXdr, network, signers, 'inner');
    for (const match of analysis.matchedSigners) {
      if (match.signatureIndex !== undefined) recognized.add(match.signatureIndex);
    }
  }

  return recognized;
}

function inspectStoredEnvelope(
  envelopeXdr: string,
  network: StellarNetwork,
): TransactionXdrInspection {
  try {
    const inspection = inspectTransactionXdr(envelopeXdr, network);
    // The stored-request contract remains classic-envelope only until fee-bump
    // inner/outer signature state has a dedicated request model.
    transactionHashHex(envelopeXdr, network);
    return inspection;
  } catch (cause) {
    throw new SigningRequestServiceError(
      cause instanceof Error ? cause.message : 'Invalid transaction envelope XDR.',
      400,
      'invalid_xdr',
    );
  }
}

async function analyzeStoredEnvelope(
  envelopeXdr: string,
  network: StellarNetwork,
  accountLoader: AccountLoader,
  inspected?: TransactionXdrInspection,
): Promise<EnvelopeAnalysis> {
  const inspection = inspected ?? inspectStoredEnvelope(envelopeXdr, network);

  const accountLookups = await loadPolicies(inspection, network, accountLoader);
  const recognized = recognizedSignatureIndexes(envelopeXdr, network, inspection, accountLookups);
  const unrecognizedSignatureIndexes = Array.from(
    { length: inspection.innerSignatureCount },
    (_, index) => index,
  ).filter((index) => !recognized.has(index));
  const authorization = analyzeTransactionAuthorization(
    envelopeXdr,
    network,
    inspection,
    accountLookups,
  );

  return {
    inspection,
    accountLookups,
    authorization,
    unrecognizedSignatureIndexes,
  };
}

async function validateSorobanAuthorizationForFreeze(
  envelopeXdr: string,
  network: StellarNetwork,
  inspection: TransactionXdrInspection,
  accountLoader: AccountLoader,
  networkParametersLoader: NetworkParametersLoader | undefined,
): Promise<SorobanEffectsSnapshot | null> {
  if (!inspection.operations.some((operation) => operation.type === 'invokeHostFunction')) return null;
  try {
    assertSorobanTransactionPreparedForFreeze(envelopeXdr, network);
  } catch (cause) {
    throw new SigningRequestServiceError(
      cause instanceof Error ? cause.message : 'Soroban execution resources have not been assembled yet.',
      400,
      'soroban_authorization_not_prepared',
    );
  }
  if (!networkParametersLoader) {
    throw new SigningRequestServiceError(
      'Latest ledger state is required to verify Soroban authorization before Sign.',
      503,
      'soroban_authorization_unavailable',
    );
  }
  let parameters: StellarNetworkParameters;
  try {
    parameters = await networkParametersLoader(network);
  } catch (cause) {
    throw new SigningRequestServiceError(
      cause instanceof Error ? `Unable to verify Soroban authorization against the latest ledger: ${cause.message}` : 'Unable to verify Soroban authorization against the latest ledger.',
      503,
      'soroban_authorization_unavailable',
    );
  }
  let authorization;
  try {
    authorization = await analyzeSorobanGAccountAuthorization({
      envelopeXdr,
      network,
      currentLedger: parameters.ledgerSequence,
      accountLoader,
    });
  } catch (cause) {
    throw new SigningRequestServiceError(
      cause instanceof Error ? `Unable to refresh Soroban authorizer policy: ${cause.message}` : 'Unable to refresh Soroban authorizer policy.',
      503,
      'soroban_authorization_unavailable',
    );
  }
  if (!authorization.supported) {
    let contractAuthorization;
    try {
      contractAuthorization = analyzeKnownSorobanContractAuthorization({
        envelopeXdr,
        network,
        currentLedger: parameters.ledgerSequence,
      });
    } catch (cause) {
      throw new SigningRequestServiceError(
        cause instanceof Error ? `Unable to verify configured contract-account authorization: ${cause.message}` : 'Unable to verify configured contract-account authorization.',
        503,
        'soroban_authorization_unavailable',
      );
    }
    if (!contractAuthorization.supported) {
      throw new SigningRequestServiceError(
        contractAuthorization.reason ?? authorization.reason ?? 'This Soroban authorization shape is not supported yet.',
        400,
        'soroban_authorization_unsupported',
      );
    }
    if (contractAuthorization.expired) {
      throw new SigningRequestServiceError(
        'Contract-account Soroban authorization has already expired. Re-simulate and collect fresh authorization before starting Sign.',
        400,
        'soroban_authorization_expired',
      );
    }
    if (!contractAuthorization.ready) {
      throw new SigningRequestServiceError(
        'The configured contract-account credential is not yet present and enforce-ready.',
        400,
        'soroban_authorization_incomplete',
      );
    }
    return;
  }
  if (authorization.expired) {
    throw new SigningRequestServiceError(
      'Soroban authorization has already expired. Re-simulate and collect fresh authorization before starting Sign.',
      400,
      'soroban_authorization_expired',
    );
  }
  if (!authorization.ready) {
    throw new SigningRequestServiceError(
      'Detached G-account Soroban authorization does not yet satisfy the current account signing policy.',
      400,
      'soroban_authorization_incomplete',
    );
  }
}

async function verifySorobanExecutionForBoundary(
  envelopeXdr: string,
  network: StellarNetwork,
  inspection: TransactionXdrInspection,
  verifier: SorobanExecutionVerifier | undefined,
): Promise<SorobanEffectsSnapshot | null> {
  if (!inspection.operations.some((operation) => operation.type === 'invokeHostFunction')) return null;
  if (!verifier) {
    throw new SigningRequestServiceError(
      'Soroban execution verification is temporarily unavailable. The Proposal was not frozen.',
      503,
      'soroban_execution_verification_unavailable',
    );
  }
  let result: SorobanExecutionVerificationResult;
  try {
    result = await verifier(envelopeXdr, network);
  } catch (cause) {
    throw new SigningRequestServiceError(
      cause instanceof Error ? `Unable to verify Soroban execution: ${cause.message}` : 'Unable to verify Soroban execution.',
      503,
      'soroban_execution_verification_unavailable',
    );
  }
  if (result.status === 'unavailable') {
    throw new SigningRequestServiceError(
      result.detail,
      503,
      'soroban_execution_verification_unavailable',
    );
  }
  if (result.status === 'invalid') {
    throw new SigningRequestServiceError(
      result.detail,
      400,
      'soroban_execution_failed',
    );
  }
  return result.effects ?? null;
}

async function validateStoredEnvelope(
  envelopeXdr: string,
  network: StellarNetwork,
  accountLoader: AccountLoader,
  networkParametersLoader?: NetworkParametersLoader,
  sorobanExecutionVerifier?: SorobanExecutionVerifier,
  requireSorobanExecutionVerification = false,
): Promise<EnvelopeAnalysis> {
  const inspection = inspectStoredEnvelope(envelopeXdr, network);
  await validateSorobanAuthorizationForFreeze(
    envelopeXdr,
    network,
    inspection,
    accountLoader,
    networkParametersLoader,
  );
  let sorobanEffects: SorobanEffectsSnapshot | null = null;
  if (requireSorobanExecutionVerification) {
    sorobanEffects = await verifySorobanExecutionForBoundary(
      envelopeXdr,
      network,
      inspection,
      sorobanExecutionVerifier,
    );
  }
  const analysis = await analyzeStoredEnvelope(envelopeXdr, network, accountLoader, inspection);
  if (analysis.unrecognizedSignatureIndexes.length > 0) {
    throw new SigningRequestServiceError(
      `Signature ${analysis.unrecognizedSignatureIndexes.map((index) => `#${index + 1}`).join(', ')} does not match any current source-account or required extra signer.`,
      400,
      'unrecognized_signature',
    );
  }

  if (analysis.authorization.innerOutcome === 'bad_auth_extra') {
    throw new SigningRequestServiceError(
      'This signature set would be rejected by Stellar Core with txBAD_AUTH_EXTRA.',
      400,
      'bad_auth_extra',
    );
  }
  return sorobanEffects ? { ...analysis, sorobanEffects } : analysis;
}


function passphrase(network: StellarNetwork): string {
  return network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
}

function hex(value: Uint8Array): string {
  return Buffer.from(value).toString('hex');
}

function acceptedSignatureEvidence(
  envelopeXdr: string,
  network: StellarNetwork,
  analysis: EnvelopeAnalysis,
  firstAddedIndex: number,
): StoredAcceptedSignature[] {
  const signers = new Map<string, StellarSigner>();
  for (const lookup of analysis.accountLookups) {
    for (const signer of lookup.account?.signers ?? []) signers.set(signer.key, signer);
  }
  for (const key of analysis.inspection.extraSigners) {
    if (!signers.has(key)) signers.set(key, { key, type: signerTypeForKey(key), weight: 1 });
  }

  const matches = analyzeEnvelopeSignatures(envelopeXdr, network, [...signers.values()], 'inner').matchedSigners;
  const signerByIndex = new Map<number, string>();
  for (const match of matches) {
    if (match.automatic || match.signatureIndex === undefined || match.signatureIndex < firstAddedIndex) continue;
    const existing = signerByIndex.get(match.signatureIndex);
    if (!existing || existing === match.signerKey) signerByIndex.set(match.signatureIndex, match.signerKey);
  }

  const parsed = TransactionBuilder.fromXdr(envelopeXdr, passphrase(network));
  const transaction = parsed instanceof FeeBumpTransaction ? parsed.innerTransaction : parsed;
  const evidence: StoredAcceptedSignature[] = [];
  for (let signatureIndex = firstAddedIndex; signatureIndex < transaction.signatures.length; signatureIndex += 1) {
    const signerKey = signerByIndex.get(signatureIndex);
    if (!signerKey) continue;
    const signature = transaction.signatures[signatureIndex];
    const bytes = signature.signature.toBytes();
    evidence.push({
      signatureIndex,
      signerKey,
      signatureHint: hex(signature.hint.toBytes()),
      signatureDigest: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  return evidence;
}

function expiryForInspection(inspection: TransactionXdrInspection, now: Date): Date {
  const defaultExpiry = now.getTime() + REQUEST_TTL_MS;
  const maxTime = inspection.timeBounds?.maxTime;
  if (!maxTime || maxTime === '0') return new Date(defaultExpiry);

  const transactionExpiry = Number(maxTime) * 1000;
  if (!Number.isFinite(transactionExpiry)) return new Date(defaultExpiry);
  if (transactionExpiry <= now.getTime()) {
    throw new SigningRequestServiceError('The transaction time bounds have already expired.', 400, 'transaction_expired');
  }
  return new Date(Math.min(defaultExpiry, transactionExpiry));
}

function contributionDigest(signedXdr: string): string {
  return createHash('sha256').update(signedXdr).digest('hex');
}

function requestExpired(request: StoredSigningRequest, now: Date): boolean {
  return new Date(request.expiresAt).getTime() <= now.getTime();
}

async function loadRequestRecord(
  store: SigningRequestStore,
  idValue: string,
): Promise<StoredSigningRequest> {
  const id = validateRequestId(idValue);
  const request = await store.getRequest(id);
  if (!request) throw new SigningRequestServiceError('Signing request not found.', 404, 'request_not_found');
  return request;
}

function mergeContributions(
  request: StoredSigningRequest,
  contributions: StoredSignatureContribution[],
): { mergedXdr: string; contributionCount: number; signatureCount: number } {
  let mergedXdr = request.baseXdr;
  let contributionCount = 0;

  const ordered = [...contributions].sort((a, b) =>
    a.receivedAt.localeCompare(b.receivedAt) || a.digest.localeCompare(b.digest),
  );
  for (const contribution of ordered) {
    const merge = mergeSignedTransactionXdr(mergedXdr, contribution.signedXdr, request.network);
    if (merge.addedSignatureCount === 0) continue;
    mergedXdr = merge.mergedXdr;
    contributionCount += 1;
  }

  const inspection = inspectTransactionXdr(mergedXdr, request.network);
  return {
    mergedXdr,
    contributionCount,
    signatureCount: inspection.innerSignatureCount,
  };
}

function submissionSnapshot(submission: StoredSubmissionResult): SigningRequestSubmission {
  return {
    transactionHash: submission.transactionHash,
    ledger: submission.ledger,
    submittedAt: submission.submittedAt,
  };
}

function confirmedSubmission(
  result: TransactionSubmissionResult,
  fallbackTime: Date,
): StoredSubmissionResult {
  return {
    version: 1,
    transactionHash: result.hash,
    ledger: result.ledger,
    submittedAt: result.createdAt ?? fallbackTime.toISOString(),
  };
}

function needsLedgerContext(inspection: TransactionXdrInspection): boolean {
  return inspection.operations.some((operation) => operation.type === 'invokeHostFunction')
    || inspection.timeBounds !== undefined
    || inspection.ledgerBounds !== undefined
    || (inspection.minAccountSequenceAge !== undefined && inspection.minAccountSequenceAge !== '0')
    || (inspection.minAccountSequenceLedgerGap ?? 0) > 0;
}

async function loadLedgerContext(
  inspection: TransactionXdrInspection,
  network: StellarNetwork,
  networkParametersLoader: NetworkParametersLoader | undefined,
): Promise<StellarNetworkParameters | null> {
  if (!needsLedgerContext(inspection) || !networkParametersLoader) return null;
  try {
    return await networkParametersLoader(network);
  } catch {
    // A missing ledger snapshot keeps the request active but not submittable.
    // The shared evaluator will block submission without hiding the request.
    return null;
  }
}

async function transactionLifecycle(
  analysis: EnvelopeAnalysis,
  now: Date,
  networkParameters: StellarNetworkParameters | null,
  networkContextExpected: boolean,
): Promise<{
  status: 'stale' | 'blocked' | 'expired' | 'waiting_preconditions';
  reason: SigningRequestStatusReason;
  detail: string;
} | null> {
  const source = analysis.accountLookups.find(
    (lookup) => lookup.accountId === analysis.inspection.transactionSourceAccount,
  )?.account ?? null;
  if (needsLedgerContext(analysis.inspection) && networkContextExpected && !networkParameters) {
    return {
      status: 'waiting_preconditions',
      reason: 'preconditions_unavailable',
      detail: 'Latest ledger state is temporarily unavailable; execution conditions cannot be confirmed yet.',
    };
  }
  const assessment = assessTransactionPreconditions(
    analysis.inspection,
    source,
    { networkParameters, now },
  );
  if (assessment.readyForSubmit) return null;

  const issue = assessment.checks.find((check) => check.status === 'fail')
    ?? assessment.checks.find((check) => check.status === 'wait')
    ?? assessment.checks.find((check) => check.status === 'unknown');
  const detail = issue?.detail ?? 'Transaction preconditions could not be evaluated.';

  if (assessment.status === 'stale') {
    return { status: 'stale', reason: 'sequence_stale', detail: 'The source account has already moved past this transaction. Create a fresh transaction to continue.' };
  }
  if (assessment.status === 'expired') {
    return { status: 'expired', reason: 'transaction_expired', detail: 'This transaction is past its valid signing window. Create a fresh transaction to continue.' };
  }
  if (assessment.status === 'not_yet_valid') {
    return { status: 'waiting_preconditions', reason: 'preconditions_not_met', detail: 'This transaction is not valid yet. It will become executable after its configured conditions are reached.' };
  }
  if (assessment.status === 'unknown') {
    return { status: 'waiting_preconditions', reason: 'preconditions_unavailable', detail: 'The latest execution conditions could not be confirmed yet.' };
  }
  return { status: 'blocked', reason: 'preconditions_failed', detail };
}

async function sorobanAuthorizationLifecycle(
  envelopeXdr: string,
  network: StellarNetwork,
  inspection: TransactionXdrInspection,
  accountLoader: AccountLoader,
  networkParameters: StellarNetworkParameters | null,
  networkContextExpected: boolean,
): Promise<{
  status: 'blocked' | 'waiting_preconditions';
  reason: SigningRequestStatusReason;
  detail: string;
} | null> {
  if (!inspection.operations.some((operation) => operation.type === 'invokeHostFunction')) return null;
  try {
    assertSorobanTransactionPreparedForFreeze(envelopeXdr, network);
  } catch (cause) {
    return {
      status: 'blocked',
      reason: 'soroban_authorization_invalid',
      detail: cause instanceof Error ? cause.message : 'Soroban execution resources are not frozen correctly.',
    };
  }
  if (networkContextExpected && !networkParameters) {
    return {
      status: 'waiting_preconditions',
      reason: 'soroban_authorization_unavailable',
      detail: 'Latest ledger state is temporarily unavailable; Soroban authorization validity cannot be confirmed yet.',
    };
  }
  if (!networkParameters) {
    return {
      status: 'waiting_preconditions',
      reason: 'soroban_authorization_unavailable',
      detail: 'Latest ledger state is required to verify Soroban authorization validity.',
    };
  }
  let authorization;
  try {
    authorization = await analyzeSorobanGAccountAuthorization({
      envelopeXdr,
      network,
      currentLedger: networkParameters.ledgerSequence,
      accountLoader,
    });
  } catch {
    return {
      status: 'waiting_preconditions',
      reason: 'soroban_authorization_unavailable',
      detail: 'Current Soroban authorizer policy could not be refreshed. No authorization state was assumed.',
    };
  }
  if (!authorization.supported) {
    let contractAuthorization;
    try {
      contractAuthorization = analyzeKnownSorobanContractAuthorization({
        envelopeXdr,
        network,
        currentLedger: networkParameters.ledgerSequence,
      });
    } catch {
      return {
        status: 'waiting_preconditions',
        reason: 'soroban_authorization_unavailable',
        detail: 'Configured contract-account authorization could not be revalidated. No authorization state was assumed.',
      };
    }
    if (!contractAuthorization.supported) {
      return {
        status: 'blocked',
        reason: 'soroban_authorization_invalid',
        detail: contractAuthorization.reason ?? authorization.reason ?? 'The frozen Soroban authorization shape is no longer supported.',
      };
    }
    if (contractAuthorization.expired) {
      return {
        status: 'blocked',
        reason: 'soroban_authorization_expired',
        detail: 'Contract-account Soroban authorization expired after this Proposal was frozen. Create a fresh Proposal and collect authorization again.',
      };
    }
    if (!contractAuthorization.ready) {
      return {
        status: 'blocked',
        reason: 'soroban_authorization_invalid',
        detail: 'The frozen contract-account credential is no longer recognized as complete. Create a fresh Proposal.',
      };
    }
    return null;
  }
  if (authorization.expired) {
    return {
      status: 'blocked',
      reason: 'soroban_authorization_expired',
      detail: 'Soroban authorization expired after this Proposal was frozen. Create a fresh Proposal and collect authorization again.',
    };
  }
  if (!authorization.ready) {
    return {
      status: 'blocked',
      reason: 'soroban_authorization_invalid',
      detail: 'The frozen Soroban authorization no longer satisfies the current G-account signing policy. Create a fresh Proposal.',
    };
  }
  return null;
}

async function buildSnapshot(
  request: StoredSigningRequest,
  contributions: StoredSignatureContribution[],
  submission: StoredSubmissionResult | null,
  now: Date,
  accountLoader: AccountLoader,
  networkParametersLoader: NetworkParametersLoader | undefined,
): Promise<SigningRequestSnapshot> {
  const merged = mergeContributions(request, contributions);
  const base = {
    id: request.id,
    network: request.network,
    transactionHash: request.transactionHash,
    baseXdr: request.baseXdr,
    mergedXdr: merged.mergedXdr,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    contributionCount: merged.contributionCount,
    signatureCount: merged.signatureCount,
    ...(request.executionPolicy?.mode === 'external'
      ? { execution: {
          mode: 'external' as const,
          executor: {
            type: 'service' as const,
            id: request.integration.serviceId,
            ...(request.integration.serviceLabel ? { label: request.integration.serviceLabel } : {}),
          },
        } }
      : {}),
  };

  if (submission) {
    return {
      ...base,
      status: 'submitted',
      statusReason: 'ledger_confirmed',
      statusDetail: `Accepted by Stellar in ledger ${submission.ledger}.`,
      submission: submissionSnapshot(submission),
    };
  }

  if (requestExpired(request, now)) {
    return {
      ...base,
      status: 'expired',
      statusReason: 'request_expired',
      statusDetail: 'This signing request has expired and no longer accepts signatures or submission.',
    };
  }

  const analysis = await analyzeStoredEnvelope(merged.mergedXdr, request.network, accountLoader);
  if (analysis.unrecognizedSignatureIndexes.length > 0) {
    return {
      ...base,
      status: 'blocked',
      statusReason: 'stored_signature_unrecognized',
      statusDetail: `Stored signature ${analysis.unrecognizedSignatureIndexes.map((index) => `#${index + 1}`).join(', ')} no longer matches the current signer policy.`,
    };
  }

  if (analysis.authorization.innerOutcome === 'bad_auth_extra') {
    return {
      ...base,
      status: 'blocked',
      statusReason: 'extra_signature_invalid',
      statusDetail: 'The current signature set would now fail with txBAD_AUTH_EXTRA under the latest signer policy.',
    };
  }

  const networkParameters = await loadLedgerContext(
    analysis.inspection,
    request.network,
    networkParametersLoader,
  );
  const sorobanLifecycle = await sorobanAuthorizationLifecycle(
    merged.mergedXdr,
    request.network,
    analysis.inspection,
    accountLoader,
    networkParameters,
    Boolean(networkParametersLoader),
  );
  if (sorobanLifecycle) {
    return {
      ...base,
      status: sorobanLifecycle.status,
      statusReason: sorobanLifecycle.reason,
      statusDetail: sorobanLifecycle.detail,
    };
  }

  const lifecycle = await transactionLifecycle(
    analysis,
    now,
    networkParameters,
    Boolean(networkParametersLoader),
  );
  if (lifecycle && lifecycle.status !== 'waiting_preconditions') {
    return { ...base, status: lifecycle.status, statusReason: lifecycle.reason, statusDetail: lifecycle.detail };
  }

  if (analysis.authorization.coreAuthorizationValid) {
    if (lifecycle?.status === 'waiting_preconditions') {
      return {
        ...base,
        status: 'waiting_preconditions',
        statusReason: lifecycle.reason,
        statusDetail: lifecycle.detail,
      };
    }
    return {
      ...base,
      status: 'ready',
      statusReason: 'authorization_complete',
      statusDetail: 'Current signatures satisfy Stellar Core authorization and transaction precondition checks.',
    };
  }

  return {
    ...base,
    status: 'awaiting_signatures',
    statusReason: 'signatures_required',
    statusDetail: 'Waiting for additional valid signatures.',
  };
}

export async function createSigningRequest(
  store: SigningRequestStore,
  input: { network: unknown; xdr: string },
  options: RequestServiceOptions & { idFactory?: () => string } = {},
): Promise<SigningRequestSnapshot> {
  const network = validateNetwork(input.network);
  const baseXdr = normalizeXdr(input.xdr);
  const accountLoader = options.accountLoader ?? loadAccount;
  const networkParametersLoader = options.networkParametersLoader;
  const analysis = await validateStoredEnvelope(
    baseXdr,
    network,
    accountLoader,
    networkParametersLoader,
    options.sorobanExecutionVerifier,
    true,
  );
  const inspection = analysis.inspection;
  const discoverySignerKeys = requestDiscoverySignerKeys(
    analysis.accountLookups.map((lookup) => lookup.account),
    inspection.extraSigners,
  );
  const now = options.now ?? new Date();
  const id = options.idFactory?.() ?? createSigningRequestId();
  validateRequestId(id);
  const request: StoredSigningRequest = {
    version: 1,
    id,
    network,
    baseXdr,
    transactionHash: transactionHashHex(baseXdr, network),
    createdAt: now.toISOString(),
    expiresAt: expiryForInspection(inspection, now).toISOString(),
    discoverySignerKeys,
    capabilityHash: options.capabilityHash,
    ...(analysis.sorobanEffects ? { sorobanEffectsBaseline: analysis.sorobanEffects } : {}),
  };

  await store.createRequest(request);
  return buildSnapshot(request, [], null, now, accountLoader, networkParametersLoader);
}

export async function getSigningRequest(
  store: SigningRequestStore,
  idValue: string,
  options: RequestServiceOptions = {},
): Promise<SigningRequestSnapshot> {
  const request = await loadRequestRecord(store, idValue);
  return getSigningRequestForStoredRequest(store, request, options);
}

export async function getSigningRequestForStoredRequest(
  store: SigningRequestStore,
  request: StoredSigningRequest,
  options: RequestServiceOptions = {},
  readFacts?: StoredSigningRequestReadFacts,
): Promise<SigningRequestSnapshot> {
  const now = options.now ?? new Date();
  const facts = readFacts ?? await loadSigningRequestReadFacts(store, request);
  const { contributions, submission } = facts;
  const accountLoader = options.accountLoader ?? loadAccount;
  const networkParametersLoader = options.networkParametersLoader;
  const snapshot = await buildSnapshot(
    request,
    contributions,
    submission,
    now,
    accountLoader,
    networkParametersLoader,
  );
  if (submission || !['stale', 'expired', 'blocked'].includes(snapshot.status)) return snapshot;

  let confirmed: TransactionSubmissionResult | null;
  try {
    confirmed = await lookupConfirmedTransaction(
      request,
      options.transactionLoader ?? loadTransactionByHash,
    );
  } catch (cause) {
    if (cause instanceof SigningRequestServiceError && cause.code === 'transaction_lookup_unavailable') {
      return snapshot;
    }
    throw cause;
  }
  if (!confirmed) return snapshot;

  const persisted = await persistConfirmedSubmission(store, request, confirmed, now);
  return buildSnapshot(
    request,
    contributions,
    persisted,
    now,
    accountLoader,
    networkParametersLoader,
  );
}

export async function loadSigningRequestReadFacts(
  store: SigningRequestStore,
  request: StoredSigningRequest,
): Promise<StoredSigningRequestReadFacts> {
  const [contributions, submission] = await Promise.all([
    store.listContributions(request.id),
    store.getSubmission(request.id, request.transactionHash),
  ]);
  return { contributions, submission };
}

export async function contributeSigningRequest(
  store: SigningRequestStore,
  idValue: string,
  signedXdrValue: string,
  options: RequestServiceOptions & { expectedSignerAddress?: string; contributionActor?: AgentActorProvenance } = {},
): Promise<{ request: SigningRequestSnapshot; addedSignatureCount: number; duplicateSignatureCount: number; contributionDigest?: string; acceptedSignerAddresses: string[] }> {
  const request = await loadRequestRecord(store, idValue);
  const now = options.now ?? new Date();
  if (requestExpired(request, now)) {
    throw new SigningRequestServiceError('This signing request has expired.', 410, 'request_expired');
  }
  const submission = await store.getSubmission(request.id, request.transactionHash);
  if (submission) {
    throw new SigningRequestServiceError('This signing request has already been submitted.', 409, 'request_submitted');
  }

  const contributions = await store.listContributions(request.id);
  const current = mergeContributions(request, contributions);
  const signedXdr = normalizeXdr(signedXdrValue);
  let merge;
  try {
    merge = mergeSignedTransactionXdr(current.mergedXdr, signedXdr, request.network);
  } catch (cause) {
    throw new SigningRequestServiceError(
      cause instanceof Error ? cause.message : 'Unable to merge this signed transaction.',
      400,
      'invalid_contribution',
    );
  }

  const accountLoader = options.accountLoader ?? loadAccount;
  const networkParametersLoader = options.networkParametersLoader;
  if (merge.addedSignatureCount === 0) {
    return {
      request: await buildSnapshot(
        request,
        contributions,
        null,
        now,
        accountLoader,
        networkParametersLoader,
      ),
      addedSignatureCount: 0,
      duplicateSignatureCount: merge.duplicateSignatureCount,
      acceptedSignerAddresses: [],
    };
  }

  const analysis = await validateStoredEnvelope(merge.mergedXdr, request.network, accountLoader, networkParametersLoader);
  const acceptedSignatures = acceptedSignatureEvidence(
    merge.mergedXdr,
    request.network,
    analysis,
    merge.existingSignatureCount,
  );
  if (acceptedSignatures.length !== merge.addedSignatureCount) {
    throw new SigningRequestServiceError('Unable to attribute every newly accepted signature.', 400, 'unattributed_signature');
  }
  if (options.expectedSignerAddress && acceptedSignatures.some((item) => item.signerKey !== options.expectedSignerAddress)) {
    throw new SigningRequestServiceError(
      'This Agent credential may contribute only signatures attributable to its Signer Principal.',
      403,
      'agent_signature_principal_mismatch',
    );
  }
  const digest = contributionDigest(signedXdr);
  const contribution: StoredSignatureContribution = {
    version: 2,
    digest,
    signedXdr,
    receivedAt: now.toISOString(),
    acceptedSignatures,
    ...(options.contributionActor ? { submittedBy: options.contributionActor } : {}),
    provenance: 'in_product_contribution',
  };
  await store.putContribution(request.id, contribution);

  return {
    request: await getSigningRequest(store, request.id, {
      now,
      accountLoader,
      networkParametersLoader,
      transactionLoader: options.transactionLoader,
    }),
    addedSignatureCount: merge.addedSignatureCount,
    duplicateSignatureCount: merge.duplicateSignatureCount,
    contributionDigest: digest,
    acceptedSignerAddresses: [...new Set(acceptedSignatures.map((item) => item.signerKey).filter((key) => key.startsWith('G')))],
  };
}

async function persistConfirmedSubmission(
  store: SigningRequestStore,
  request: StoredSigningRequest,
  result: TransactionSubmissionResult,
  now: Date,
): Promise<StoredSubmissionResult> {
  if (!result.successful || result.hash !== request.transactionHash) {
    throw new SigningRequestServiceError(
      'Horizon returned an unexpected transaction result.',
      502,
      'unexpected_submission_result',
    );
  }
  const submission = confirmedSubmission(result, now);
  await store.putSubmission(request.id, submission);
  return submission;
}

async function lookupConfirmedTransaction(
  request: StoredSigningRequest,
  loader: TransactionLoader,
): Promise<TransactionSubmissionResult | null> {
  try {
    const result = await loader(request.transactionHash, request.network);
    return result?.successful ? result : null;
  } catch (cause) {
    throw new SigningRequestServiceError(
      cause instanceof Error ? `Unable to check whether this transaction is already on-chain: ${cause.message}` : 'Unable to check whether this transaction is already on-chain.',
      503,
      'transaction_lookup_unavailable',
    );
  }
}

export async function submitSigningRequest(
  store: SigningRequestStore,
  idValue: string,
  options: SubmitRequestOptions = {},
): Promise<SigningRequestSnapshot> {
  const request = await loadRequestRecord(store, idValue);
  const now = options.now ?? new Date();
  const accountLoader = options.accountLoader ?? loadAccount;
  const networkParametersLoader = options.networkParametersLoader;
  const transactionLoader = options.transactionLoader ?? loadTransactionByHash;
  const transactionSubmitter = options.transactionSubmitter ?? submitTransactionXdr;

  const [contributions, storedSubmission] = await Promise.all([
    store.listContributions(request.id),
    store.getSubmission(request.id, request.transactionHash),
  ]);
  if (storedSubmission) {
    return buildSnapshot(
      request,
      contributions,
      storedSubmission,
      now,
      accountLoader,
      networkParametersLoader,
    );
  }

  const alreadyConfirmed = await lookupConfirmedTransaction(request, transactionLoader);
  if (alreadyConfirmed) {
    const submission = await persistConfirmedSubmission(store, request, alreadyConfirmed, now);
    return buildSnapshot(
      request,
      contributions,
      submission,
      now,
      accountLoader,
      networkParametersLoader,
    );
  }

  if (requestExpired(request, now)) {
    throw new SigningRequestServiceError('This signing request has expired.', 410, 'request_expired');
  }

  const current = await buildSnapshot(
    request,
    contributions,
    null,
    now,
    accountLoader,
    networkParametersLoader,
  );
  if (current.status !== 'ready') {
    if (current.status === 'stale') {
      throw new SigningRequestServiceError(current.statusDetail ?? 'This transaction sequence is stale.', 409, 'transaction_stale');
    }
    if (current.status === 'expired') {
      throw new SigningRequestServiceError(current.statusDetail ?? 'This transaction has expired.', 410, 'transaction_expired');
    }
    if (current.status === 'waiting_preconditions') {
      throw new SigningRequestServiceError(current.statusDetail ?? 'Transaction preconditions are not yet satisfied.', 409, 'preconditions_not_met');
    }
    if (current.status === 'blocked') {
      throw new SigningRequestServiceError(current.statusDetail ?? 'This signing request is blocked.', 409, 'request_blocked');
    }
    throw new SigningRequestServiceError(
      'This signing request does not yet have enough valid authorization to submit.',
      409,
      'authorization_incomplete',
    );
  }

  const currentSorobanEffects = await verifySorobanExecutionForBoundary(
    current.mergedXdr,
    request.network,
    inspectStoredEnvelope(current.mergedXdr, request.network),
    options.sorobanExecutionVerifier,
  );
  if (request.sorobanEffectsBaseline) {
    if (!currentSorobanEffects) {
      throw new SigningRequestServiceError(
        'Soroban effects verification did not return the baseline needed for safe submission.',
        503,
        'soroban_effects_verification_unavailable',
      );
    }
    const effectsDiff = compareSorobanEffects(request.sorobanEffectsBaseline, currentSorobanEffects);
    if (effectsDiff.requiresReauthorization) {
      throw new SigningRequestServiceError(
        'Soroban execution effects changed structurally after this Proposal was created. Return to the original Intent, refresh authorization, and create a fresh Proposal.',
        409,
        'soroban_effects_reauthorization_required',
        { effectsDiff },
      );
    }
    if (effectsDiff.requiresExplicitReview
      && options.acceptedEffectsDigest?.trim() !== currentSorobanEffects.digest) {
      throw new SigningRequestServiceError(
        'Soroban numeric execution effects changed materially after this Proposal was created. Review the percentage differences and explicitly accept the current effects before submission.',
        409,
        'soroban_effects_review_required',
        { effectsDiff },
      );
    }
  }

  try {
    const result = await transactionSubmitter(current.mergedXdr, request.network);
    const submission = await persistConfirmedSubmission(store, request, result, now);
    return buildSnapshot(
      request,
      contributions,
      submission,
      now,
      accountLoader,
      networkParametersLoader,
    );
  } catch (cause) {
    if (cause instanceof SigningRequestServiceError) throw cause;
    if (cause instanceof TransactionSubmissionError) {
      if (cause.outcomeUnknown || cause.transactionCode === 'tx_bad_seq') {
        const confirmed = await lookupConfirmedTransaction(request, transactionLoader);
        if (confirmed) {
          const submission = await persistConfirmedSubmission(store, request, confirmed, now);
          return buildSnapshot(
            request,
            contributions,
            submission,
            now,
            accountLoader,
            networkParametersLoader,
          );
        }
      }
      throw new SigningRequestServiceError(
        cause.message,
        cause.outcomeUnknown ? 504 : (cause.httpStatus ?? 400),
        cause.outcomeUnknown ? 'submission_outcome_unknown' : 'submission_failed',
      );
    }
    throw new SigningRequestServiceError(
      cause instanceof Error ? `Unable to submit transaction: ${cause.message}` : 'Unable to submit transaction.',
      502,
      'submission_failed',
    );
  }
}
