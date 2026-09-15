import type { AgentActorProvenance } from '../src/stellar/agentAccessTypes.js';
import type { CoordinationActorProvenance, SorobanIntentIntegrationContext } from '../src/stellar/integrationTypes.js';
import type { SorobanAuthorizationPlan } from '../src/stellar/sorobanAuthorizationPlan.js';
import type { SorobanIntent } from '../src/stellar/sorobanIntent.js';
import type { PrivateNoteRevision } from '../src/stellar/privateNote.js';
import type { StellarNetwork } from '../src/stellar/types.js';

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

export interface StoredSorobanAuthorizationPlanRevision {
  revision: number;
  authorizationPlan: SorobanAuthorizationPlan;
  supersededAt: string;
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
  creatorActor?: CoordinationActorProvenance;
  discoverySignerKeys: string[];
  integration?: SorobanIntentIntegrationContext;
  privateContext?: SorobanIntentPrivateContext;
}

export interface SorobanIntentStore {
  createIntent(value: StoredSorobanIntent): Promise<void>;
  getIntent(id: string): Promise<StoredSorobanIntent | null>;
  updateIntent(value: StoredSorobanIntent): Promise<void>;
  listIntentsBySigner?(network: StellarNetwork, signerAddress: string): Promise<StoredSorobanIntent[]>;
  listContributions(id: string): Promise<StoredSorobanIntentAuthorizationContribution[]>;
  putContribution(id: string, contribution: StoredSorobanIntentAuthorizationContribution): Promise<void>;
}
