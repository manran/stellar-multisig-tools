import type { SorobanGAccountAuthorizerStatus } from './sorobanAuthorization.js';
import type { SorobanAuthorizationPlan } from './sorobanAuthorizationPlan.js';
import type { SorobanIntent } from './sorobanIntent.js';
import type { SorobanEffectsDiff, SorobanEffectsSnapshot } from './sorobanEffects.js';
import type { MachineCallerProvenance } from './coordinationActorTypes.js';
import type { SorobanIntentIntegrationContext } from './integrationTypes.js';
import type { ExecutionPolicy } from './executionPolicy.js';
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
  executionPolicy?: ExecutionPolicy;
  privateContext?: {
    externalReference?: string;
    initialPrivateNote?: PrivateNoteRevision;
  };
}

export type SorobanIntentEvidenceEventType =
  | 'intent_created'
  | 'authorization_added'
  | 'authorization_plan_revised'
  | 'execution_prepared'
  | 'execution_confirmed'
  | 'execution_failed';

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
  validUntil?: string | null;
  latestLedger?: number;
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
  status: 'awaiting_authorization' | 'authorization_ready' | 'expired' | 'blocked';
  statusDetail?: string;
  authorizationEntriesXdr: string[];
  contributionCount: number;
  authorizers: SorobanGAccountAuthorizerStatus[];
}


export type SorobanIntentViewerAction = 'authorize' | 'route_execution' | 'waiting' | 'waiting_execution' | 'execution_failed' | 'attention';

export interface InboxSorobanIntentSnapshot {
  id: string;
  network: StellarNetwork;
  createdAt: string;
  creatorAddress?: string;
  creatorActor?: MachineCallerProvenance;
  status: SorobanIntentAuthorizationSnapshot['status'];
  statusDetail?: string;
  contributionCount: number;
  authorizers: SorobanGAccountAuthorizerStatus[];
  viewerAction: SorobanIntentViewerAction;
}

export interface SorobanIntentResponse {
  operation: 'contract.intent.create' | 'contract.intent.inspect';
  version: 1;
  replayed?: boolean;
  intent: StoredSorobanIntentSnapshot;
  authorization: SorobanIntentAuthorizationSnapshot;
  evidence?: SorobanIntentEvidenceEvent[];
}

export interface SorobanIntentContributionResponse {
  operation: 'contract.intent.contribute';
  version: 1;
  added: boolean;
  authorization: SorobanIntentAuthorizationSnapshot;
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
}

export interface SorobanIntentExecutionResponse {
  operation: 'contract.intent.execution.prepare';
  version: 1;
  execution: {
    version: 1;
    intentId: string;
    network: StellarNetwork;
    intentDigest: string;
    authorizationPlanDigest: string;
    executionSource: string;
    transactionSequence: string;
    transactionHash: string;
    validUntil: string | null;
    latestLedger: number;
    effectsDiff: SorobanEffectsDiff;
    effects: SorobanEffectsSnapshot;
    effectsAccepted: boolean;
    xdr: string;
  };
}

export interface SorobanIntentReplanResponse {
  operation: 'contract.intent.replan';
  version: 1;
  intent: StoredSorobanIntentSnapshot;
  authorization: SorobanIntentAuthorizationSnapshot;
  previousAuthorizationPlanDigest: string;
  authorizationPlanRevision: number;
}
