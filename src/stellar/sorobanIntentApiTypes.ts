import type { SorobanGAccountAuthorizerStatus } from './sorobanAuthorization.js';
import type { SorobanAuthorizationPlan } from './sorobanAuthorizationPlan.js';
import type { SorobanIntent } from './sorobanIntent.js';
import type { SorobanEffectsDiff, SorobanEffectsSnapshot } from './sorobanEffects.js';
import type { MachineCallerProvenance } from './coordinationActorTypes.js';
import type { SorobanIntentIntegrationContext, IntegrationExecutionPolicy } from './integrationTypes.js';
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
  executionPolicy?: IntegrationExecutionPolicy;
  privateContext?: {
    externalReference?: string;
    initialPrivateNote?: PrivateNoteRevision;
  };
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


export type SorobanIntentViewerAction = 'authorize' | 'execute' | 'waiting' | 'attention';

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
}

export interface SorobanIntentContributionResponse {
  operation: 'contract.intent.contribute';
  version: 1;
  added: boolean;
  authorization: SorobanIntentAuthorizationSnapshot;
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
