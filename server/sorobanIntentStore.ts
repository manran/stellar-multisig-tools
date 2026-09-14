import type { AgentActorProvenance } from '../src/stellar/agentAccessTypes.js';
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
  receivedAt: string;
  submittedBy?: AgentActorProvenance;
}

export interface StoredSorobanIntent {
  version: 1;
  id: string;
  network: StellarNetwork;
  intent: SorobanIntent;
  authorizationPlan: SorobanAuthorizationPlan;
  createdAt: string;
  creatorAddress: string;
  creatorActor?: AgentActorProvenance;
  privateContext?: SorobanIntentPrivateContext;
}

export interface SorobanIntentStore {
  createIntent(value: StoredSorobanIntent): Promise<void>;
  getIntent(id: string): Promise<StoredSorobanIntent | null>;
  updateIntent(value: StoredSorobanIntent): Promise<void>;
  listContributions(id: string): Promise<StoredSorobanIntentAuthorizationContribution[]>;
  putContribution(id: string, contribution: StoredSorobanIntentAuthorizationContribution): Promise<void>;
}
