import type { ActivityEvent, ActivityFactEvent } from '../src/stellar/activityTypes.js';
import type { AgentActorProvenance } from '../src/stellar/agentAccessTypes.js';
import type { MachineCallerProvenance } from '../src/stellar/coordinationActorTypes.js';
import type { RequestIntegrationContext } from '../src/stellar/integrationTypes.js';
import type { ExecutionPolicy } from '../src/stellar/executionPolicy.js';
import type { PrivateCommitmentRecord } from '../src/stellar/privateCommitment.js';
import type { PrivateNoteRevision } from '../src/stellar/privateNote.js';
import type { SorobanEffectsSnapshot } from '../src/stellar/sorobanEffects.js';
import type { StellarNetwork } from '../src/stellar/types.js';

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
  /** SHA-256 of the private bearer token for a shared request link. */
  capabilityHash?: string;
  /** Immutable first off-chain note when private context is supplied at request creation. */
  initialPrivateNote?: PrivateNoteRevision;
  /** Server-private opening data for an on-chain MEMO_HASH commitment. */
  privateCommitment?: PrivateCommitmentRecord;
  /** Enforcing-simulation effects fixed when a Soroban Proposal is created. */
  sorobanEffectsBaseline?: SorobanEffectsSnapshot;
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
}

export interface StoredSigningRequestReadFacts {
  contributions: StoredSignatureContribution[];
  submission: StoredSubmissionResult | null;
}

export interface StoredRequestParticipant {
  version: 1;
  address: string;
  joinedAt: string;
}

export interface SigningRequestStore {
  createRequest(request: StoredSigningRequest): Promise<void>;
  getRequest(id: string): Promise<StoredSigningRequest | null>;
  listRequests?(): Promise<StoredSigningRequest[]>;
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
  getRequestParticipant?(id: string, address: string): Promise<StoredRequestParticipant | null>;
  listRequestParticipants?(id: string): Promise<StoredRequestParticipant[]>;
  putRequestParticipant?(id: string, participant: StoredRequestParticipant): Promise<void>;
  listActivityEvents?(id: string): Promise<ActivityEvent[]>;
  putActivityEvent?(id: string, event: ActivityFactEvent): Promise<void>;
  listPrivateNoteRevisions?(id: string): Promise<PrivateNoteRevision[]>;
  putPrivateNoteRevision?(id: string, revision: PrivateNoteRevision): Promise<void>;
}
