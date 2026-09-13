export interface ContractWorkspaceRef {
  contractId: string;
  network: 'public' | 'testnet';
  importedAt: number;
}

type ContractWorkspaceStorage = Pick<Storage, 'getItem' | 'setItem'>;

const KEY = 'multisig-tools.contract-workspaces';

export function saveContractWorkspace(ref: ContractWorkspaceRef, storage: ContractWorkspaceStorage = localStorage): void {
  const current = loadContractWorkspaces(storage);
  const next = [ref, ...current.filter((item) => !(item.contractId === ref.contractId && item.network === ref.network))];
  storage.setItem(KEY, JSON.stringify(next));
}

export function loadContractWorkspaces(storage: ContractWorkspaceStorage = localStorage): ContractWorkspaceRef[] {
  try {
    const value = JSON.parse(storage.getItem(KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is ContractWorkspaceRef =>
      item && typeof item.contractId === 'string' && (item.network === 'public' || item.network === 'testnet')
        && typeof item.importedAt === 'number' && Number.isFinite(item.importedAt),
    );
  } catch {
    return [];
  }
}

export function removeContractWorkspace(
  contractId: string,
  network: ContractWorkspaceRef['network'],
  storage: ContractWorkspaceStorage = localStorage,
): void {
  const next = loadContractWorkspaces(storage).filter(
    (item) => !(item.contractId === contractId && item.network === network),
  );
  storage.setItem(KEY, JSON.stringify(next));
}
