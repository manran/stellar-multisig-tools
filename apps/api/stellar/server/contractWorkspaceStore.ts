import type { SignerPrincipalRef } from '../../../../src/stellar/agentAccessTypes.js';
import type { StellarNetwork } from '../../../../src/stellar/types.js';

export interface StoredContractWorkspace {
  version: 1;
  contractId: string;
  network: StellarNetwork;
  createdAt: string;
  updatedAt: string;
}

export interface ContractWorkspaceStore {
  list(principal: SignerPrincipalRef): Promise<StoredContractWorkspace[]>;
  get(principal: SignerPrincipalRef, contractId: string): Promise<StoredContractWorkspace | null>;
  put(principal: SignerPrincipalRef, workspace: StoredContractWorkspace): Promise<void>;
  delete(principal: SignerPrincipalRef, contractId: string): Promise<void>;
}
