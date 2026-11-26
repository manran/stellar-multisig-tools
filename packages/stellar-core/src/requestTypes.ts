import type { ActivityRequestItem } from './activityTypes.js';
import type { AgentTaskProjection } from './agentTaskTypes.js';
import type { RequestExecution } from './integrationTypes.js';
import type { PrivateCommitmentRecord } from './privateCommitment.js';
import type { PrivateNoteRevision } from './privateNote.js';
import type { SourceAnalysis } from './transactionReviewAnalysis.js';
import type { SorobanEffectsDiff } from './sorobanEffects.js';
import type { StellarNetwork } from './types.js';
import type { ReusableTemplateRef } from './reusableTemplate.js';

export type SigningRequestStatus =
  | 'awaiting_signatures'
  | 'waiting_preconditions'
  | 'ready'
  | 'submitted'
  | 'expired'
  | 'stale'
  | 'blocked';

export type SigningRequestStatusReason =
  | 'signatures_required'
  | 'quorum_unreachable'
  | 'preconditions_not_met'
  | 'preconditions_unavailable'
  | 'authorization_complete'
  | 'ledger_confirmed'
  | 'request_expired'
  | 'transaction_expired'
  | 'sequence_stale'
  | 'stored_signature_unrecognized'
  | 'extra_signature_invalid'
  | 'preconditions_failed'
  | 'soroban_authorization_unavailable'
  | 'soroban_authorization_invalid'
  | 'soroban_authorization_expired'
  | 'soroban_execution_verification_unavailable'
  | 'soroban_execution_failed'
  | 'execution_failed'
  | 'execution_not_included';

export interface SigningRequestSubmission {
  transactionHash: string;
  ledger: number;
  submittedAt: string;
  /** Actual ledger envelope hash when a fee bump wrapped the Request transaction. */
  ledgerTransactionHash?: string;
}

export interface ClassicExecutionNonInclusionProof {
  oldestLedger: number;
  latestLedger: number;
  oldestLedgerClosedAt: string;
  latestLedgerClosedAt: string;
  validAfter: string;
  validUntil: string;
  checkedAt: string;
}

export type ClassicExecutionEvidence =
  | { outcome: 'unknown'; observed: false }
  | { outcome: 'not_included'; observed: false; nonInclusionProof: ClassicExecutionNonInclusionProof }
  | { outcome: 'successful'; observed: true; observation: SigningRequestSubmission & { successful: true } }
  | { outcome: 'failed'; observed: true; observation: SigningRequestSubmission & { successful: false } };

export type ClassicTerminalExecutionEvidence = Exclude<ClassicExecutionEvidence, { outcome: 'unknown' }>;

export type ClassicExecutionReconciliationResponse = ClassicExecutionEvidence & {
  operation: 'integration.request.execution.reconcile';
  version: 1;
  requestId: string;
  network: StellarNetwork;
  transactionHash: string;
  replayed: boolean;
};

export interface SorobanRequestOrigin {
  version: 1;
  intentId: string;
  authorizationPlanDigest: string;
  authorizationPlanRevision: number;
  executionPreparedAt: string;
  effectsDigest: string;
}

export interface SigningRequestSnapshot {
  id: string;
  network: StellarNetwork;
  transactionHash: string;
  baseXdr: string;
  mergedXdr: string;
  createdAt: string;
  expiresAt: string;
  creatorAddress?: string;
  /** Wallet that initiated this Template Proposal; not automatically a transaction signer. */
  proposerAddress?: string;
  contributionCount: number;
  signatureCount: number;
  status: SigningRequestStatus;
  statusReason: SigningRequestStatusReason;
  statusDetail?: string;
  declines?: Array<{ signerAddress: string; decidedAt: string }>;
  submission?: SigningRequestSubmission;
  executionOutcome?: ClassicExecutionEvidence;
  execution?: RequestExecution;
  sorobanOrigin?: SorobanRequestOrigin;
  template?: ReusableTemplateRef;
}

export interface SigningRequestAssignment {
  version: 1;
  signerAddress: string;
  assignedByAddress: string;
  assignedAt: string;
  viewedAt?: string;
}

export type SigningRequestNotificationEventType =
  | 'signature_requested'
  | 'signature_reminder';

export type SigningRequestNotificationDeliveryState =
  | 'queued'
  | 'provider_accepted'
  | 'delivered'
  | 'bounced'
  | 'failed';

export interface SigningRequestNotificationSummary {
  channel: 'email';
  eventType: SigningRequestNotificationEventType;
  automatic?: true;
  signerAddress: string;
  actorAddress: string;
  state: SigningRequestNotificationDeliveryState;
  createdAt: string;
  lastAttemptAt?: string;
  completedAt?: string;
  errorCode?: string;
}

export interface SigningRequestCoordination {
  declines?: Array<{ signerAddress: string; decidedAt: string }>;
  assignments: SigningRequestAssignment[];
  notifications: SigningRequestNotificationSummary[];
}

export interface SigningRequestAccess {
  shareable: boolean;
  activityBound?: boolean;
  viewerDecision?: 'declined';
  contributionGrantExpiresAt?: number;
}

export interface SigningRequestPrivateContext {
  privateNote?: PrivateNoteRevision;
  privateCommitment?: PrivateCommitmentRecord;
}

export interface SigningRequestHistoryProjection {
  activity: ActivityRequestItem;
  sourceAnalyses: SourceAnalysis[];
  policyBasis?: 'proposal_creation' | 'current' | 'unavailable';
}

export interface CreateSigningRequestResponse {
  request: SigningRequestSnapshot;
  capability?: string;
  access?: SigningRequestAccess;
  context?: SigningRequestPrivateContext;
  history?: SigningRequestHistoryProjection;
  coordination?: SigningRequestCoordination;
  task?: AgentTaskProjection;
}

export interface ContributeSigningRequestResponse {
  request: SigningRequestSnapshot;
  addedSignatureCount: number;
  duplicateSignatureCount: number;
  access?: { contributionGrantExpiresAt?: number };
  task?: AgentTaskProjection;
}

export interface SubmitSigningRequestResponse {
  request: SigningRequestSnapshot;
}

export interface RevisePrivateNoteResponse {
  privateNote: PrivateNoteRevision;
}

export interface SigningRequestApiError {
  error: string;
  code: string;
  network?: StellarNetwork;
  requestStatus?: SigningRequestStatus;
  details?: { effectsDiff?: SorobanEffectsDiff };
}


export type SigningRequestNotificationStatus =
  | 'queued'
  | 'already_queued'
  | 'no_contact_email'
  | 'enqueue_failed';

export interface AssignSigningRequestResponse {
  request: SigningRequestSnapshot;
  assignment: SigningRequestAssignment;
  created: boolean;
  coordination: SigningRequestCoordination;
  notification?: {
    channel: 'email';
    status: SigningRequestNotificationStatus;
  };
}

export interface RemindSigningRequestResponse {
  request: SigningRequestSnapshot;
  coordination: SigningRequestCoordination;
  notification: {
    channel: 'email';
    status: Exclude<SigningRequestNotificationStatus, 'already_queued'>;
  };
}
