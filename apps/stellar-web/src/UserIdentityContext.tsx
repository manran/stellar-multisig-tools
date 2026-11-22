import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { fixedClientStellarDeploymentNetwork } from '../../../packages/stellar-core/src/deploymentNetwork';
import type { StellarNetwork } from '../../../packages/stellar-core/src/types';
import { privateSessionAddressHeaders } from '../../../packages/stellar-core/src/privateSessionTransport';
import { useStellarWallet } from './StellarWalletContext';

export interface MstUserIdentity {
  userId: string;
  network: StellarNetwork;
  method: 'passkey' | 'stellar_wallet';
  address?: string;
  expiresAt?: number;
}

export interface MstUserProfile { nickname: string; }

export interface IdentityMethod {
  kind: 'passkey' | 'stellar_wallet';
  id?: string;
  address?: string;
}

interface IdentityContextValue {
  identity: MstUserIdentity | null;
  credentials: IdentityMethod[];
  profile: MstUserProfile | null;
  network: StellarNetwork;
  loading: boolean;
  refresh: () => Promise<void>;
}

const IdentityContext = createContext<IdentityContextValue | null>(null);

export function UserIdentityProvider({ children }: { children: ReactNode }) {
  const wallet = useStellarWallet();
  const network = fixedClientStellarDeploymentNetwork() ?? wallet.sessionNetwork ?? 'testnet';
  const selectedWallet = wallet.privateUnlocked && wallet.address === wallet.unlockedAddress
    && wallet.unlockedNetwork === network ? wallet.unlockedAddress : '';
  const scope = `${network}:${selectedWallet}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const refreshVersion = useRef(0);
  const [state, setState] = useState<{ scope: string; identity: MstUserIdentity | null; credentials: IdentityMethod[]; profile: MstUserProfile | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const identity = state?.scope === scope ? state.identity : null;
  const credentials = state?.scope === scope ? state.credentials : [];
  const profile = state?.scope === scope ? state.profile : null;

  const refresh = useCallback(async () => {
    const revision = ++refreshVersion.current;
    // A linked verified wallet exposes signer/owner capabilities. An unlinked
    // wallet stays a separate credential until the Passkey user links it.
    const identityResponse = await fetch(`/api/identity?network=${network}`, {
      cache: 'no-store',
      headers: selectedWallet ? privateSessionAddressHeaders(selectedWallet) : {},
    });
    let body = await identityResponse.json() as { authenticated?: boolean; identity?: MstUserIdentity; credentials?: IdentityMethod[]; profile?: MstUserProfile };
    if (!identityResponse.ok && identityResponse.status !== 401) throw new Error('Unable to load MST identity.');
    if (identityResponse.status === 401) body = { authenticated: false };
    if (currentScope.current !== scope || refreshVersion.current !== revision) return;
    setState({ scope, identity: body.authenticated && body.identity?.network === network ? body.identity : null,
      credentials: Array.isArray(body.credentials) ? body.credentials : [],
      profile: body.authenticated && body.profile && typeof body.profile.nickname === 'string' ? body.profile : null });
  }, [network, scope, selectedWallet]);

  useEffect(() => {
    let current = true;
    setLoading(true);
    void refresh().catch(() => {
      if (current) setState({ scope, identity: null, credentials: [], profile: null });
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; refreshVersion.current += 1; };
  }, [refresh, scope]);

  return <IdentityContext.Provider value={{ identity, credentials, profile, network, loading, refresh }}>
    {children}
  </IdentityContext.Provider>;
}

export function useUserIdentity(): IdentityContextValue {
  const value = useContext(IdentityContext);
  if (!value) throw new Error('UserIdentityProvider is missing.');
  return value;
}
