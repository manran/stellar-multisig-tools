import type { AgentActorProvenance } from '../../../../src/stellar/agentAccessTypes.js';
import type { MachineCallerProvenance } from '../../../../src/stellar/coordinationActorTypes.js';
import type { SorobanIntentIntegrationContext } from '../../../../src/stellar/integrationTypes.js';
import type { SorobanExecutionPolicy } from '../../../../src/stellar/executionPolicy.js';
import type { SorobanAuthorizationPlan } from '../../../../src/stellar/sorobanAuthorizationPlan.js';
import type { SorobanIntent } from '../../../../src/stellar/sorobanIntent.js';
import type { PrivateNoteRevision } from '../../../../src/stellar/privateNote.js';
import type { StellarNetwork } from '../../../../src/stellar/types.js';

export interface SorobanIntentPrivateContext {
  externalReference?: string;
  initialPrivateNote?: PrivateNoteRevision;
}

export interface StoredSorobanIntentAuthorizationContribution {
  version: 1;
  digest: string;
  entryIndex: number;
  signerAddress: string;
  signatureBase64: string;
  /** Plan identity is optional only for contributions written before plan revisions existed. */
  authorizationPlanDigest?: string;
  authorizationPlanRevision?: number;
  receivedAt: string;
  submittedBy?: AgentActorProvenance;
}

export interface StoredSorobanIntentExecutionPreparation {
  version: 1;
  transactionHash: string;
  authorizationPlanDigest: string;
  authorizationPlanRevision: number;
  executionSource: string;
  transactionSequence: string;
  validUntil: string | null;
  latestLedger: number;
  effectsDigest: string;
  effectsAccepted: boolean;
  preparedAt: string;
  preparedByAddress?: string;
  preparedBy?: MachineCallerProvenance;
}

export interface StoredSorobanIntentExecutionObservation {
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

export interface StoredSorobanAuthorizationPlanRevision {
  revision: number;
  authorizationPlan: SorobanAuthorizationPlan;
  supersededAt: string;
}

export interface StoredSorobanIntentCancellation {
  version: 1;
  cancelledAt: string;
  authorizationPlanDigest: string;
  authorizationPlanRevision: number;
  cancelledByAddress?: string;
  cancelledBy?: MachineCallerProvenance;
}

export interface StoredSorobanIntent {
  version: 1;
  id: string;
  network: StellarNetwork;
  intent: SorobanIntent;
  authorizationPlan: SorobanAuthorizationPlan;
  /** Missing on legacy records means revision 1. */
  authorizationPlanRevision?: number;
  authorizationPlanHistory?: StoredSorobanAuthorizationPlanRevision[];
  createdAt: string;
  creatorAddress?: string;
  creatorActor?: MachineCallerProvenance;
  discoverySignerKeys: string[];
  integration?: SorobanIntentIntegrationContext;
  executionPolicy?: SorobanExecutionPolicy;
  privateContext?: SorobanIntentPrivateContext;
  cancellation?: StoredSorobanIntentCancellation;
}

export interface SorobanIntentStore {
  createIntent(value: StoredSorobanIntent): Promise<void>;
  getIntent(id: string): Promise<StoredSorobanIntent | null>;
  updateIntent(value: StoredSorobanIntent): Promise<void>;
  cancelIntent?(id: string, cancellation: StoredSorobanIntentCancellation): Promise<{ cancellation: StoredSorobanIntentCancellation; created: boolean }>;
  bindExecutionPolicy?(id: string, executionPolicy: SorobanExecutionPolicy): Promise<SorobanExecutionPolicy>;
  listIntentsBySigner?(network: StellarNetwork, signerAddress: string): Promise<StoredSorobanIntent[]>;
  listContributions(id: string): Promise<StoredSorobanIntentAuthorizationContribution[]>;
  putContribution(id: string, contribution: StoredSorobanIntentAuthorizationContribution): Promise<void>;
  listExecutionPreparations?(id: string): Promise<StoredSorobanIntentExecutionPreparation[]>;
  putExecutionPreparation?(id: string, preparation: StoredSorobanIntentExecutionPreparation): Promise<void>;
  listExecutionObservations?(id: string): Promise<StoredSorobanIntentExecutionObservation[]>;
  getExecutionObservation?(id: string, transactionHash: string): Promise<StoredSorobanIntentExecutionObservation | null>;
  putExecutionObservation?(id: string, observation: StoredSorobanIntentExecutionObservation): Promise<void>;
}
