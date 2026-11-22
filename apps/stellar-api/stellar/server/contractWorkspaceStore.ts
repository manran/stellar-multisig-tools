import type { SignerPrincipalRef } from '../../../../packages/stellar-core/src/agentAccessTypes.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';

export type ContractWorkspacePrincipal = SignerPrincipalRef | { type: 'user'; network: StellarNetwork; userId: string };

export interface StoredContractWorkspace {
  version: 1;
  contractId: string;
  network: StellarNetwork;
  createdAt: string;
  updatedAt: string;
}

export interface ContractWorkspaceStore {
  list(principal: ContractWorkspacePrincipal): Promise<StoredContractWorkspace[]>;
  get(principal: ContractWorkspacePrincipal, contractId: string): Promise<StoredContractWorkspace | null>;
  put(principal: ContractWorkspacePrincipal, workspace: StoredContractWorkspace): Promise<void>;
  delete(principal: ContractWorkspacePrincipal, contractId: string): Promise<void>;
  hasImportedWallet?(principal: ContractWorkspacePrincipal, wallet: string): Promise<boolean>;
  markImportedWallet?(principal: ContractWorkspacePrincipal, wallet: string): Promise<void>;
}
