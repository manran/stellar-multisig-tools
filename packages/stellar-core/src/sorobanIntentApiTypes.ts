import type { SorobanCallSummary } from './sorobanInspection.js';
import type { AgentTaskProjection } from './agentTaskTypes.js';
import type { SorobanGAccountAuthorizerStatus } from './sorobanAuthorization.js';
import type { SorobanAuthorizationPlan } from './sorobanAuthorizationPlan.js';
import type { SorobanIntent } from './sorobanIntent.js';
import type { SorobanEffectsDiff, SorobanEffectsSnapshot } from './sorobanEffects.js';
import type { MachineCallerProvenance } from './coordinationActorTypes.js';
import type { SorobanIntentIntegrationContext } from './integrationTypes.js';
import type { SorobanExecutionPolicy, SorobanExecutorBinding } from './executionPolicy.js';
import type { PrivateNoteRevision } from './privateNote.js';
import type { StellarNetwork } from './types.js';

export interface StoredSorobanIntentSnapshot {
  version: 1;
  id: string;
  network: StellarNetwork;
  intent: SorobanIntent;
  authorizationPlan: SorobanAuthorizationPlan;
  authorizationPlanRevision?: number;
  authorizationPlanHistory?: Array<{
    revision: number;
    authorizationPlan: SorobanAuthorizationPlan;
    supersededAt: string;
  }>;
  createdAt: string;
  creatorAddress?: string;
  creatorActor?: MachineCallerProvenance;
  integration?: SorobanIntentIntegrationContext;
  executionPolicy?: SorobanExecutionPolicy;
  cancellation?: SorobanIntentCancellation;
  privateContext?: {
    externalReference?: string;
    initialPrivateNote?: PrivateNoteRevision;
  };
}

export interface SorobanIntentCancellation {
  version: 1;
  cancelledAt: string;
  authorizationPlanDigest: string;
  authorizationPlanRevision: number;
  cancelledByAddress?: string;
  cancelledBy?: MachineCallerProvenance;
}

export type SorobanIntentEvidenceEventType =
  | 'intent_created'
  | 'intent_cancelled'
  | 'authorization_added'
  | 'authorization_plan_revised'
  | 'execution_prepared'
  | 'execution_not_included'
  | 'execution_confirmed'
  | 'execution_failed';

export interface SorobanExecutionNonInclusionProof {
  oldestLedger: number;
  latestLedger: number;
  latestLedgerClosedAt: string;
  checkedAt: string;
}

export interface SorobanIntentEvidenceEvent {
  version: 1;
  eventId: string;
  type: SorobanIntentEvidenceEventType;
  occurredAt: string;
  actorAddress?: string;
  actor?: MachineCallerProvenance;
  authorizationPlanDigest: string;
  authorizationPlanRevision: number;
  previousAuthorizationPlanDigest?: string;
  entryIndex?: number;
  contributionDigest?: string;
  executionSource?: string;
  transactionSequence?: string;
  transactionHash?: string;
  effectsDigest?: string;
  effectsAccepted?: boolean;
  resumable?: true;
  validUntil?: string | null;
  latestLedger?: number;
  nonInclusionProof?: SorobanExecutionNonInclusionProof;
  ledger?: number;
  successful?: boolean;
  observedAt?: string;
}


export interface SorobanIntentAuthorizationSnapshot {
  id: string;
  network: StellarNetwork;
  intentDigest: string;
  authorizationPlanDigest: string;
  executionBinding: 'detached';
  status: 'awaiting_authorization' | 'authorization_ready' | 'expired' | 'blocked' | 'cancelled' | 'completed';
  statusDetail?: string;
  authorizationEntriesXdr: string[];
  contributionCount: number;
  authorizers: SorobanGAccountAuthorizerStatus[];
}


export type IntegrationJobState =
  | 'waiting_for_authorization'
  | 'ready'
  | 'executing'
  | 'execution_unknown'
  | 'completed'
  | 'expired'
  | 'failed'
  | 'cancelled';

export type IntegrationJobNextAction =
  | 'prepare_execution'
  | 'submit_execution'
  | 'reconcile_execution'
  | 'refresh_execution'
  | 'resume_execution'
  | 'replan'
  | 'cancel';

export interface IntegrationSorobanJobProjection {
  version: 1;
  id: string;
  kind: 'soroban_contract';
  network: StellarNetwork;
  state: IntegrationJobState;
  nextActions: IntegrationJobNextAction[];
  actionCalls: Partial<Record<IntegrationJobNextAction,
    { operationId: string; bodyDefaults: { action: string; transactionHash?: string }; requiredInputs?: string[]; reviewRequired?: true }
    | { transport: 'external_stellar_submission'; transactionHash: string }>>;
  reviewUrl: string;
  waitingFor?: string[];
  expiresAtLedger?: number;
  externalReference?: string;
  reason?: 'authorization_blocked' | 'execution_failed' | 'execution_unavailable' | 'execution_outcome_unknown';
  unresolvedTransactionHashes?: string[];
  execution?: {
    owner: 'external_service' | 'multisigtools';
    executor: string;
    transactionHash: string;
    preparedAt: string;
    validUntil: string | null;
  };
  result?: {
    transactionHash: string;
    ledger: number;
    successful: boolean;
  };
}

export type SorobanIntentViewerAction = 'sign' | 'route_execution' | 'waiting' | 'waiting_execution' | 'execution_failed' | 'reconcile_execution' | 'attention' | 'cancelled';

export interface InboxSorobanIntentSnapshot {
  id: string;
  callTitle?: string;
  network: StellarNetwork;
  createdAt: string;
  creatorAddress?: string;
  creatorActor?: MachineCallerProvenance;
  status: SorobanIntentAuthorizationSnapshot['status'];
  statusDetail?: string;
  contributionCount: number;
  authorizers: SorobanGAccountAuthorizerStatus[];
  viewerAction: SorobanIntentViewerAction;
  unresolvedTransactionHashes?: string[];
}

export interface SorobanIntentResponse {
  callSummary?: SorobanCallSummary;
  operation: 'contract.intent.create' | 'contract.intent.inspect';
  version: 1;
  replayed?: boolean;
  intent: StoredSorobanIntentSnapshot;
  authorization: SorobanIntentAuthorizationSnapshot;
  challenges?: Array<{ entryIndex: number; authorizer: string; preimageXdr: string; expiresAtLedger: number }>;
  evidence?: SorobanIntentEvidenceEvent[];
  job?: IntegrationSorobanJobProjection;
  task?: AgentTaskProjection;
}

export interface SorobanIntentContributionResponse {
  operation: 'contract.intent.contribute';
  version: 1;
  added: boolean;
  authorization: SorobanIntentAuthorizationSnapshot;
  task?: AgentTaskProjection;
}

export interface SorobanIntentExecutionObservation {
  version: 1;
  transactionHash: string;
  authorizationPlanDigest: string;
  authorizationPlanRevision: number;
  executionSource: string;
  ledger: number;
  successful: boolean;
  observedAt: string;
  networkCreatedAt?: string;
}

export interface SorobanIntentExecutionReconciliationResponse {
  operation: 'contract.intent.execution.reconcile';
  version: 1;
  transactionHash: string;
  observed: boolean;
  replayed: boolean;
  observation?: SorobanIntentExecutionObservation;
  outcome: 'unknown' | 'not_included' | 'failed' | 'successful';
  nonInclusionProof?: SorobanExecutionNonInclusionProof;
  /** Evidence is available; current job/task was not refreshed. Inspect separately. */
  projectionNotRefreshed?: true;
  job?: IntegrationSorobanJobProjection;
  task?: AgentTaskProjection;
}

export interface SorobanIntentExecutionResponse {
  operation: 'contract.intent.execution.prepare' | 'contract.intent.execution.resume';
  version: 1;
  execution: {
    version: 1;
    intentId: string;
    network: StellarNetwork;
    intentDigest: string;
    authorizationPlanDigest: string;
    authorizationPlanRevision: number;
    executor?: SorobanExecutorBinding;
    executionSource: string;
    transactionSequence: string;
    transactionHash: string;
    validUntil: string | null;
    latestLedger: number;
    effectsDiff: SorobanEffectsDiff;
    effects: SorobanEffectsSnapshot;
    effectsAccepted: boolean;
    preparedAt: string;
    xdr: string;
  };
  job?: IntegrationSorobanJobProjection;
  task?: AgentTaskProjection;
}

export interface SorobanIntentCancelResponse {
  operation: 'contract.intent.cancel';
  version: 1;
  replayed: boolean;
  intent: StoredSorobanIntentSnapshot;
  authorization: SorobanIntentAuthorizationSnapshot;
  cancellation: SorobanIntentCancellation;
  job?: IntegrationSorobanJobProjection;
  task?: AgentTaskProjection;
}

export interface SorobanIntentReplanResponse {
  operation: 'contract.intent.replan';
  version: 1;
  intent: StoredSorobanIntentSnapshot;
  authorization: SorobanIntentAuthorizationSnapshot;
  previousAuthorizationPlanDigest: string;
  authorizationPlanRevision: number;
  job?: IntegrationSorobanJobProjection;
  task?: AgentTaskProjection;
}
