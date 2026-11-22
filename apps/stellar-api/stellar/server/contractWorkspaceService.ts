import { StrKey } from '@stellar/stellar-sdk/base';
import type { SignerPrincipalRef } from '../../../../packages/stellar-core/src/agentAccessTypes.js';
import type { ContractWorkspacePrincipal, ContractWorkspaceStore, StoredContractWorkspace } from './contractWorkspaceStore.js';
import { userWorkspaceOwner } from './userWorkspaceOwner.js';

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

function normalizedPrincipal(principal: ContractWorkspacePrincipal): ContractWorkspacePrincipal {
  if (principal.type === 'user') {
    userWorkspaceOwner(principal.network, principal.userId);
    return { type: 'user', network: principal.network, userId: principal.userId.toLowerCase() };
  }
  if (principal.type !== 'signer' || !StrKey.isValidEd25519PublicKey(principal.address)) {
    throw new ContractWorkspaceServiceError('A valid signer Principal is required.', 400, 'invalid_principal');
  }
  if (principal.network !== 'public' && principal.network !== 'testnet') {
    throw new ContractWorkspaceServiceError('Principal network must be Mainnet or Testnet.', 400, 'invalid_network');
  }
  return { type: 'signer', network: principal.network, address: principal.address.trim() };
}

export async function importLegacyContractWorkspaces(
  store: ContractWorkspaceStore,
  user: Extract<ContractWorkspacePrincipal, { type: 'user' }>,
  walletAddress: string,
): Promise<void> {
  const userPrincipal = normalizedPrincipal(user);
  const signer = normalizedPrincipal({ type: 'signer', network: user.network, address: walletAddress });
  if (!store.hasImportedWallet || !store.markImportedWallet) {
    throw new ContractWorkspaceServiceError('Workspace import is unavailable.', 503, 'workspace_import_unavailable');
  }
  if (await store.hasImportedWallet(userPrincipal, walletAddress)) return;
  for (const entry of await store.list(signer)) {
    if (!await store.get(userPrincipal, entry.contractId)) await store.put(userPrincipal, entry);
  }
  await store.markImportedWallet(userPrincipal, walletAddress);
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
  principalValue: ContractWorkspacePrincipal,
): Promise<StoredContractWorkspace[]> {
  const principal = normalizedPrincipal(principalValue);
  const entries = await store.list(principal);
  return entries
    .filter((entry) => entry.version === 1 && entry.network === principal.network && StrKey.isValidContract(entry.contractId))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.contractId.localeCompare(right.contractId));
}

export async function keepContractWorkspace(
  store: ContractWorkspaceStore,
  principalValue: ContractWorkspacePrincipal,
  contractIdValue: string,
  now = new Date(),
  metadata?: { nickname?: string; organization?: string },
): Promise<StoredContractWorkspace> {
  const principal = normalizedPrincipal(principalValue);
  const contractId = normalizedContractId(contractIdValue);
  const existing = await store.get(principal, contractId);
  const cleanLabel = (value: string | undefined, key: string, previous?: string) => {
    if (value === undefined) return previous;
    const trimmed = value.trim();
    if (trimmed.length > 80) throw new ContractWorkspaceServiceError(`${key} must be 80 characters or fewer.`, 400, 'invalid_contract_label');
    return trimmed || undefined;
  };
  const nickname = cleanLabel(metadata?.nickname, 'Nickname', existing?.nickname);
  const organization = cleanLabel(metadata?.organization, 'Organization', existing?.organization);
  const timestamp = now.toISOString();
  const workspace: StoredContractWorkspace = {
    version: 1,
    contractId,
    network: principal.network,
    ...(nickname ? { nickname } : {}),
    ...(organization ? { organization } : {}),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  await store.put(principal, workspace);
  return workspace;
}

export async function forgetContractWorkspace(
  store: ContractWorkspaceStore,
  principalValue: ContractWorkspacePrincipal,
  contractIdValue: string,
): Promise<void> {
  const principal = normalizedPrincipal(principalValue);
  const contractId = normalizedContractId(contractIdValue);
  await store.delete(principal, contractId);
}
