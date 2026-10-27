import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
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
  keep(contractId: string): Promise<void>;
  forget(contractId: string): Promise<void>;
}

const ContractWorkspaceContext = createContext<ContractWorkspaceContextValue | null>(null);

async function migrateAndList(network: 'public' | 'testnet'): Promise<ContractWorkspaceRef[]> {
  const legacy = loadContractWorkspaces().filter((item) => item.network === network);
  for (const item of legacy) {
    await keepContractOperation(item.contractId, network);
    removeContractWorkspace(item.contractId, network);
  }
  return listContractWorkspaceOperation();
}

export function ContractWorkspaceProvider({ children }: { children: ReactNode }) {
  const { privateUnlocked, unlockedAddress, unlockedNetwork } = useStellarWallet();
  const [contracts, setContracts] = useState<ContractWorkspaceRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const ready = Boolean(privateUnlocked && unlockedAddress && unlockedNetwork);

  const refresh = useCallback(async () => {
    if (!privateUnlocked || !unlockedAddress || !unlockedNetwork) {
      setContracts([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setContracts(await migrateAndList(unlockedNetwork));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load contract workspaces.');
    } finally {
      setLoading(false);
    }
  }, [privateUnlocked, unlockedAddress, unlockedNetwork]);

  useEffect(() => {
    if (!privateUnlocked || !unlockedAddress || !unlockedNetwork) {
      setContracts([]);
      setLoading(false);
      setError('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    void migrateAndList(unlockedNetwork)
      .then((items) => { if (!cancelled) setContracts(items); })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load contract workspaces.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [privateUnlocked, unlockedAddress, unlockedNetwork]);

  const keep = useCallback(async (contractId: string) => {
    if (!privateUnlocked || !unlockedNetwork) throw new Error('Unlock the signer workspace to save contracts.');
    const contract = await keepContractOperation(contractId, unlockedNetwork);
    setContracts((current) => [contract, ...current.filter((item) => item.contractId !== contract.contractId)]);
  }, [privateUnlocked, unlockedNetwork]);
  const forget = useCallback(async (contractId: string) => {
    if (!privateUnlocked || !unlockedNetwork) throw new Error('Unlock the signer workspace to remove contracts.');
    await forgetContractOperation(contractId, unlockedNetwork);
    setContracts((current) => current.filter((item) => item.contractId !== contractId));
  }, [privateUnlocked, unlockedNetwork]);

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
