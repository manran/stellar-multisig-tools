import type { AgentActorProvenance } from '../src/stellar/agentAccessTypes.js';
import type { StellarNetwork } from '../src/stellar/types.js';

export interface StoredSorobanPreparation {
  version: 1;
  id: string;
  network: StellarNetwork;
  baseXdr: string;
  createdAt: string;
  expiresAt: string;
  capabilityHash: string;
  creatorAddress?: string;
  creatorActor?: AgentActorProvenance;
  discoverySignerKeys: string[];
}

export interface StoredSorobanAuthorizationContribution {
  version: 1;
  digest: string;
  entryIndex: number;
  signerAddress: string;
  signatureBase64: string;
  receivedAt: string;
  submittedBy?: AgentActorProvenance;
}

export interface StoredSorobanPreparationFreeze {
  version: 1;
  proposalId: string;
  frozenAt: string;
  frozenBy: string;
}

export interface SorobanPreparationStore {
  createPreparation(preparation: StoredSorobanPreparation): Promise<void>;
  updatePreparation(preparation: StoredSorobanPreparation): Promise<void>;
  getPreparation(id: string): Promise<StoredSorobanPreparation | null>;
  listPreparationsBySigner?(network: StellarNetwork, signerAddress: string): Promise<StoredSorobanPreparation[]>;
  listContributions(id: string): Promise<StoredSorobanAuthorizationContribution[]>;
  putContribution(id: string, contribution: StoredSorobanAuthorizationContribution): Promise<void>;
  getFreeze(id: string): Promise<StoredSorobanPreparationFreeze | null>;
  putFreeze(id: string, freeze: StoredSorobanPreparationFreeze): Promise<void>;
}
