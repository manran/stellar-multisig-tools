import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  forgetContractOperation,
  keepContractOperation,
  listContractWorkspaceOperation,
} from './contractOperationsClient';
import type { ContractWorkspaceRef } from './contractOperationsClient';
import { loadContractWorkspaces, removeContractWorkspace } from './contractWorkspace';
import { useStellarWallet } from './StellarWalletContext';

interface ContractWorkspaceContextValue {
  contracts: ContractWorkspaceRef[];
  loading: boolean;
  error: string;
  ready: boolean;
  refresh(): Promise<void>;
  keep(contractId: string, network: 'public' | 'testnet', address: string): Promise<void>;
  forget(contractId: string): Promise<void>;
}

const ContractWorkspaceContext = createContext<ContractWorkspaceContextValue | null>(null);

async function migrateAndList(network: 'public' | 'testnet', address: string): Promise<ContractWorkspaceRef[]> {
  const legacy = loadContractWorkspaces().filter((item) => item.network === network);
  for (const item of legacy) {
    await keepContractOperation(item.contractId, network, address);
    removeContractWorkspace(item.contractId, network);
  }
  return listContractWorkspaceOperation(address);
}

export function ContractWorkspaceProvider({ children }: { children: ReactNode }) {
  const { address, network, privateUnlocked, unlockedAddress, unlockedNetwork } = useStellarWallet();
  const owner = privateUnlocked && unlockedAddress && unlockedNetwork && address === unlockedAddress && network === unlockedNetwork ? [unlockedNetwork, unlockedAddress].join(':') : '';
  const scopeRef = useRef({ owner, revision: 0 });
  if (scopeRef.current.owner !== owner) scopeRef.current = { owner, revision: 0 };
  const scope = scopeRef.current;
  const [collection, setCollection] = useState<{ owner: string; items: ContractWorkspaceRef[] }>({ owner: '', items: [] });
  const contracts = collection.owner === owner && owner ? collection.items : [];
  const replaceContracts = useCallback((update: (items: ContractWorkspaceRef[]) => ContractWorkspaceRef[]) => {
    if (scopeRef.current !== scope || !scope.owner) return;
    scope.revision++;
    setCollection(current => scopeRef.current === scope ? { owner: scope.owner, items: update(current.owner === scope.owner ? current.items : []) } : current);
  }, [scope]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const ready = Boolean(owner);

  const refresh = useCallback(async () => {
    if (!scope.owner || !unlockedAddress || !unlockedNetwork) {
      setCollection({ owner: '', items: [] });
      return;
    }
    setLoading(true);
    setError('');
    try {
      const revision = scope.revision;
      const items = await migrateAndList(unlockedNetwork, unlockedAddress);
      if (scopeRef.current === scope && scope.revision === revision) replaceContracts(() => items);
    } catch (cause) {
      if (scopeRef.current === scope) setError(cause instanceof Error ? cause.message : 'Unable to load contract workspaces.');
    } finally {
      if (scopeRef.current === scope) setLoading(false);
    }
  }, [privateUnlocked, unlockedAddress, unlockedNetwork, scope, replaceContracts]);

  useEffect(() => {
    if (!scope.owner || !unlockedAddress || !unlockedNetwork) {
      setCollection({ owner: '', items: [] });
      setLoading(false);
      setError('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    const revision = scope.revision;
    void migrateAndList(unlockedNetwork, unlockedAddress)
      .then((items) => { if (!cancelled && scopeRef.current === scope && scope.revision === revision) replaceContracts(() => items); })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load contract workspaces.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [privateUnlocked, unlockedAddress, unlockedNetwork, scope, replaceContracts]);

  const keep = useCallback(async (contractId: string, network: 'public' | 'testnet', address: string) => {
    const contract = await keepContractOperation(contractId, network, address);
    const expectedOwner = [network, address].join(':');
    const currentScope = scopeRef.current;
    if (currentScope.owner !== expectedOwner) return;
    currentScope.revision++;
    setCollection(current => scopeRef.current !== currentScope ? current : {
      owner: expectedOwner,
      items: [contract, ...(current.owner === expectedOwner ? current.items : []).filter(item => item.contractId !== contract.contractId)],
    });
    // If the initial list was still loading, fetch the full collection after the save.
    const revision = currentScope.revision;
    const items = await listContractWorkspaceOperation(address).catch(() => null);
    if (items && scopeRef.current === currentScope && currentScope.revision === revision) {
      currentScope.revision++;
      setCollection(current => scopeRef.current === currentScope ? { owner: expectedOwner, items } : current);
    }
  }, []);
  const forget = useCallback(async (contractId: string) => {
    if (!scope.owner || !unlockedAddress || !unlockedNetwork) throw new Error('Unlock the signer workspace to remove contracts.');
    await forgetContractOperation(contractId, unlockedNetwork, unlockedAddress);
    replaceContracts((current) => current.filter((item) => item.contractId !== contractId));
  }, [scope, unlockedAddress, unlockedNetwork, replaceContracts]);

  const value = useMemo<ContractWorkspaceContextValue>(() => ({
    contracts,
    loading,
    error,
    ready,
    refresh,
    keep,
    forget,
  }), [contracts, loading, error, ready, refresh, keep, forget]);

  return <ContractWorkspaceContext.Provider value={value}>{children}</ContractWorkspaceContext.Provider>;
}

export function useContractWorkspaces(): ContractWorkspaceContextValue {
  const value = useContext(ContractWorkspaceContext);
  if (!value) throw new Error('useContractWorkspaces must be used inside ContractWorkspaceProvider.');
  return value;
}
