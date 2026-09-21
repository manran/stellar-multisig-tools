import { StrKey } from '@stellar/stellar-sdk/base';
import type { SignerPrincipalRef } from '../../../../src/stellar/agentAccessTypes.js';
import type { ContractWorkspaceStore, StoredContractWorkspace } from './contractWorkspaceStore.js';

export class ContractWorkspaceServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ContractWorkspaceServiceError';
    this.status = status;
    this.code = code;
  }
}

function normalizedPrincipal(principal: SignerPrincipalRef): SignerPrincipalRef {
  if (principal.type !== 'signer' || !StrKey.isValidEd25519PublicKey(principal.address)) {
    throw new ContractWorkspaceServiceError('A valid signer Principal is required.', 400, 'invalid_principal');
  }
  if (principal.network !== 'public' && principal.network !== 'testnet') {
    throw new ContractWorkspaceServiceError('Principal network must be Mainnet or Testnet.', 400, 'invalid_network');
  }
  return { type: 'signer', network: principal.network, address: principal.address.trim() };
}

function normalizedContractId(value: string): string {
  const contractId = value.trim();
  if (!StrKey.isValidContract(contractId)) {
    throw new ContractWorkspaceServiceError('A valid Stellar C... contract address is required.', 400, 'invalid_contract');
  }
  return contractId;
}

export async function listContractWorkspaces(
  store: ContractWorkspaceStore,
  principalValue: SignerPrincipalRef,
): Promise<StoredContractWorkspace[]> {
  const principal = normalizedPrincipal(principalValue);
  const entries = await store.list(principal);
  return entries
    .filter((entry) => entry.version === 1 && entry.network === principal.network && StrKey.isValidContract(entry.contractId))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.contractId.localeCompare(right.contractId));
}

export async function keepContractWorkspace(
  store: ContractWorkspaceStore,
  principalValue: SignerPrincipalRef,
  contractIdValue: string,
  now = new Date(),
): Promise<StoredContractWorkspace> {
  const principal = normalizedPrincipal(principalValue);
  const contractId = normalizedContractId(contractIdValue);
  const existing = await store.get(principal, contractId);
  const timestamp = now.toISOString();
  const workspace: StoredContractWorkspace = {
    version: 1,
    contractId,
    network: principal.network,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  await store.put(principal, workspace);
  return workspace;
}

export async function forgetContractWorkspace(
  store: ContractWorkspaceStore,
  principalValue: SignerPrincipalRef,
  contractIdValue: string,
): Promise<void> {
  const principal = normalizedPrincipal(principalValue);
  const contractId = normalizedContractId(contractIdValue);
  await store.delete(principal, contractId);
}
