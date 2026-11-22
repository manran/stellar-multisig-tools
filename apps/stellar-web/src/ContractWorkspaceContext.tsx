import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  forgetContractOperation,
  keepContractOperation,
  listContractWorkspaceOperation,
} from './contractOperationsClient';
import type { ContractWorkspaceRef } from './contractOperationsClient';
import { useStellarWallet } from './StellarWalletContext';
import { useUserIdentity } from './UserIdentityContext';

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

export function ContractWorkspaceProvider({ children }: { children: ReactNode }) {
  const { privateUnlocked, unlockedAddress, unlockedNetwork } = useStellarWallet();
  const { identity, network } = useUserIdentity();
  const owner = identity ? `${network}:user:${identity.userId}` : '';
  const selectedWallet = identity?.address && privateUnlocked
    && unlockedAddress === identity.address && unlockedNetwork === network ? identity.address : '';
  const scopeRef = useRef(owner);
  scopeRef.current = owner;
  const [state, setState] = useState<{ owner: string; contracts: ContractWorkspaceRef[] }>({ owner: '', contracts: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const contracts = owner && state.owner === owner ? state.contracts : [];
  const ready = Boolean(identity);

  const refresh = useCallback(async () => {
    if (!owner) {
      setState({ owner: '', contracts: [] });
      return;
    }
    setLoading(true);
    setError('');
    try {
      const items = await listContractWorkspaceOperation(network, selectedWallet);
      if (scopeRef.current === owner) setState({ owner, contracts: items });
    } catch (cause) {
      if (scopeRef.current === owner) setError(cause instanceof Error ? cause.message : 'Unable to load contracts.');
    } finally {
      if (scopeRef.current === owner) setLoading(false);
    }
  }, [owner, network, selectedWallet]);

  useEffect(() => {
    if (!owner) {
      setState({ owner: '', contracts: [] });
      setLoading(false);
      setError('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    void listContractWorkspaceOperation(network, selectedWallet)
      .then((items) => { if (!cancelled && scopeRef.current === owner) setState({ owner, contracts: items }); })
      .catch((cause) => {
        if (!cancelled && scopeRef.current === owner) {
          setError(cause instanceof Error ? cause.message : 'Unable to load contracts.');
        }
      })
      .finally(() => { if (!cancelled && scopeRef.current === owner) setLoading(false); });
    return () => { cancelled = true; };
  }, [owner, network, selectedWallet]);

  const keep = useCallback(async (contractId: string) => {
    if (!owner) throw new Error('Sign in to save contracts.');
    const contract = await keepContractOperation(contractId, network, selectedWallet);
    if (scopeRef.current === owner) {
      setState((current) => ({
        owner,
        contracts: [contract, ...(current.owner === owner ? current.contracts : []).filter((item) => item.contractId !== contract.contractId)],
      }));
    }
  }, [owner, network, selectedWallet]);

  const forget = useCallback(async (contractId: string) => {
    if (!owner) throw new Error('Sign in to remove contracts.');
    await forgetContractOperation(contractId, network, selectedWallet);
    if (scopeRef.current === owner) {
      setState((current) => ({
        owner,
        contracts: (current.owner === owner ? current.contracts : []).filter((item) => item.contractId !== contractId),
      }));
    }
  }, [owner, network, selectedWallet]);

  const value = useMemo<ContractWorkspaceContextValue>(() => ({
    contracts, loading, error, ready, refresh, keep, forget,
  }), [contracts, loading, error, ready, refresh, keep, forget]);

  return <ContractWorkspaceContext.Provider value={value}>{children}</ContractWorkspaceContext.Provider>;
}

export function useContractWorkspaces(): ContractWorkspaceContextValue {
  const value = useContext(ContractWorkspaceContext);
  if (!value) throw new Error('useContractWorkspaces must be used inside ContractWorkspaceProvider.');
  return value;
}
