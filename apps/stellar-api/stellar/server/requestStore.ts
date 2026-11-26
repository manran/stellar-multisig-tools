import type { ActivityCoordinationEvent, ActivityEvent, ActivityFactEvent } from '../../../../packages/stellar-core/src/activityTypes.js';
import type { AgentActorProvenance } from '../../../../packages/stellar-core/src/agentAccessTypes.js';
import type { MachineCallerProvenance } from '../../../../packages/stellar-core/src/coordinationActorTypes.js';
import type { RequestIntegrationContext } from '../../../../packages/stellar-core/src/integrationTypes.js';
import type { ExecutionPolicy } from '../../../../packages/stellar-core/src/executionPolicy.js';
import type { PrivateCommitmentRecord } from '../../../../packages/stellar-core/src/privateCommitment.js';
import type { PrivateNoteRevision } from '../../../../packages/stellar-core/src/privateNote.js';
import type { SorobanEffectsSnapshot } from '../../../../packages/stellar-core/src/sorobanEffects.js';
import type { ClassicTerminalExecutionEvidence, SorobanRequestOrigin } from '../../../../packages/stellar-core/src/requestTypes.js';
import type { StellarAccountSnapshot, StellarNetwork } from '../../../../packages/stellar-core/src/types.js';
import type { ReusableTemplateRef } from '../../../../packages/stellar-core/src/reusableTemplate.js';

export interface StoredSigningRequest {
  version: 1;
  id: string;
  network: StellarNetwork;
  baseXdr: string;
  transactionHash: string;
  createdAt: string;
  expiresAt: string;
  /** Verified signer Principal that created the Request, when one was available. */
  creatorAddress?: string;
  /** Verified wallet that initiated a delegated Template payment, never a signer identity. */
  proposerAddress?: string;
  /** Machine caller provenance when creation came through Agent or Service access. */
  creatorActor?: MachineCallerProvenance;
  /** External Integration ownership/execution context. Absent for ordinary signer-owned Requests. */
  integration?: RequestIntegrationContext;
  /** Canonical business-instruction digest when Request creation began from semantic input. */
  instructionDigest?: string;
  /** Final execution ownership. Kept separate from caller identity. */
  executionPolicy?: ExecutionPolicy;
  /** Candidate signer addresses captured from fresh policy at Request creation. Discovery only, never authorization evidence. */
  discoverySignerKeys?: string[];
  /** Signing policy observed when this proposal was frozen; receipt evidence only. */
  reviewSourceAccounts?: StellarAccountSnapshot[];
  /** SHA-256 of the private bearer token for a shared request link. */
  capabilityHash?: string;
  /** Immutable first off-chain note when private context is supplied at request creation. */
  initialPrivateNote?: PrivateNoteRevision;
  /** Server-private opening data for an on-chain MEMO_HASH commitment. */
  privateCommitment?: PrivateCommitmentRecord;
  /** Enforcing-simulation effects fixed when a Soroban Proposal is created. */
  sorobanEffectsBaseline?: SorobanEffectsSnapshot;
  /** Server-verified link to the exact Soroban Intent execution preparation that produced this transaction. */
  sorobanOrigin?: SorobanRequestOrigin;
  /** Immutable reusable-template version used to prepare this Proposal, when applicable. */
  templateRef?: ReusableTemplateRef;
}

export interface StoredAcceptedSignature {
  signatureIndex: number;
  signerKey: string;
  signatureHint: string;
  signatureDigest: string;
}

export interface StoredSignatureContribution {
  version: 1 | 2;
  digest: string;
  signedXdr: string;
  receivedAt: string;
  /** Canonical signer evidence captured when a new signature contribution is accepted. */
  acceptedSignatures?: StoredAcceptedSignature[];
  /** Delegated Agent that submitted this contribution. This does not claim the Agent generated the signature. */
  submittedBy?: AgentActorProvenance;
  provenance?: 'in_product_contribution' | 'legacy_reconciled';
}

export interface StoredSubmissionResult {
  version: 1;
  transactionHash: string;
  ledger: number;
  submittedAt: string;
  ledgerTransactionHash?: string;
}

export function isExternalClassicRequest(request: StoredSigningRequest): boolean {
  // External Classic is an Integration-owned execution policy; Soroban Intent
  // execution has its own resource and reconciliation service.
  return request.executionPolicy?.mode === 'external';
}

export function successfulClassicEvidence(submission: StoredSubmissionResult): Extract<ClassicTerminalExecutionEvidence, { outcome: 'successful' }> {
  const { version: _version, ...receipt } = submission;
  return { outcome: 'successful', observed: true, observation: { ...receipt, successful: true } };
}

export interface StoredSigningRequestReadFacts {
  contributions: StoredSignatureContribution[];
  submission: StoredSubmissionResult | null;
  executionEvidence?: ClassicTerminalExecutionEvidence | null;
}

export interface StoredRequestParticipant {
  version: 1;
  address: string;
  joinedAt: string;
}

export interface StoredRequestAssignment {
  version: 1;
  signerAddress: string;
  assignedByAddress: string;
  assignedAt: string;
  viewedAt?: string;
}

export interface SigningRequestStore {
  createRequest(request: StoredSigningRequest): Promise<void>;
  getRequest(id: string): Promise<StoredSigningRequest | null>;
  listRequests?(): Promise<StoredSigningRequest[]>;
  listRequestsByProposer?(network: StellarNetwork, address: string): Promise<StoredSigningRequest[]>;
  /**
   * Discovery optimization only. Callers must still perform live authorization
   * checks before returning private Request data.
   */
  listRequestsByDiscoverySubjects?(
    network: StellarNetwork,
    sourceAccountIds: string[],
    directSignerKey: string,
  ): Promise<StoredSigningRequest[]>;
  /**
   * Activity/history candidate optimization only. Callers must still verify
   * the viewer's Activity or Treasury access before returning private data.
   */
  listRequestsByActivitySubjects?(
    network: StellarNetwork,
    sourceAccountIds: string[],
    actorAddress: string,
  ): Promise<StoredSigningRequest[]>;
  listContributions(id: string): Promise<StoredSignatureContribution[]>;
  putContribution(id: string, contribution: StoredSignatureContribution): Promise<void>;
  getSubmission(id: string, transactionHash: string): Promise<StoredSubmissionResult | null>;
  putSubmission(id: string, submission: StoredSubmissionResult): Promise<void>;
  getExecutionEvidence?(id: string): Promise<ClassicTerminalExecutionEvidence | null>;
  putExecutionEvidence?(id: string, evidence: ClassicTerminalExecutionEvidence): Promise<void>;
  getRequestParticipant?(id: string, address: string): Promise<StoredRequestParticipant | null>;
  listRequestParticipants?(id: string): Promise<StoredRequestParticipant[]>;
  putRequestParticipant?(id: string, participant: StoredRequestParticipant): Promise<void>;
  listRequestAssignments?(id: string): Promise<StoredRequestAssignment[]>;
  listRequestCoordinationEvents?(id: string): Promise<ActivityCoordinationEvent[]>;
  putRequestAssignment?(
    id: string,
    assignment: StoredRequestAssignment,
  ): Promise<{ assignment: StoredRequestAssignment; created: boolean }>;
  markRequestAssignmentViewed?(
    id: string,
    signerAddress: string,
    viewedAt: string,
  ): Promise<StoredRequestAssignment | null>;
  listActivityEvents?(id: string): Promise<ActivityEvent[]>;
  putActivityEvent?(id: string, event: ActivityFactEvent): Promise<void>;
  listPrivateNoteRevisions?(id: string): Promise<PrivateNoteRevision[]>;
  putPrivateNoteRevision?(id: string, revision: PrivateNoteRevision): Promise<void>;
}
