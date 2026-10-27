import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { fixedClientStellarDeploymentNetwork } from '../../../packages/stellar-core/src/deploymentNetwork';
import type { StellarNetwork } from '../../../packages/stellar-core/src/types';
import { explicitNetworkFromSearch, resolveNetworklessWalletContext } from './stellar/networkContext';
import {
  connectWalletIdentity,
  getConnectedWalletIdentity,
  isWalletAuthEntrySigningUnsupported,
  isWalletMessageSigningUnsupported,
  isWalletSelectionCancelled,
  signAuthEntryWithWallet,
  signMessageWithWallet,
  signTransactionWithWallet,
  subscribeWalletIdentity,
  walletActionErrorMessage,
} from './stellar/walletKit';
import type { WalletIdentity, WalletNetworkSource } from './stellar/walletKit';
import { getDefaultUnlockDuration } from './stellar/unlockPreferences';
import type { UnlockDurationSeconds } from './stellar/unlockPreferences';
export type { UnlockDurationSeconds } from './stellar/unlockPreferences';

const STORAGE_KEY = 'multisig-tools.stellar.connected-wallet';
const STORAGE_NETWORK_KEY = 'multisig-tools.stellar.connected-wallet.network';
const STORAGE_NETWORK_SOURCE_KEY = 'multisig-tools.stellar.connected-wallet.network-source';
const STORAGE_EXPLICIT_NETWORK_KEY = 'multisig-tools.stellar.explicit-network';
const AUTO_CONNECT_SUPPRESSED_KEY = 'multisig-tools.stellar.auto-connect-suppressed';
const WALLET_IDENTITY_RETRY_MS = 250;
const WALLET_IDENTITY_FAILURES_BEFORE_CLEAR = 2;
const FIXED_DEPLOYMENT_NETWORK = fixedClientStellarDeploymentNetwork();

interface StellarWalletContextValue {
  address: string;
  network: StellarNetwork | null;
  networkSource: WalletNetworkSource | null;
  busy: boolean;
  error: string;
  connect: () => Promise<string>;
  clear: () => void;
  alignNetworkContext: (network: StellarNetwork) => Promise<void>;
  selectNetworkContext: (network: StellarNetwork) => Promise<void>;
  sign: (xdr: string, network: StellarNetwork) => Promise<string>;
  signAuthEntry: (preimageXdr: string, network: StellarNetwork) => Promise<{ signatureBase64: string; signerAddress: string }>;
  accountMenuOpen: boolean;
  setAccountMenuOpen: (open: boolean) => void;

  // Compatibility identity for workspace code: this is the currently selected
  // wallet, not proof that the private workspace is unlocked.
  sessionAddress: string;
  sessionNetwork: StellarNetwork | null;
  sessionExpiresAt: number | null;

  unlockedAddress: string;
  unlockedNetwork: StellarNetwork | null;
  unlockExpiresAt: number | null;
  privateUnlocked: boolean;
  authBusy: boolean;
  authError: string;
  unlock: (durationSeconds?: UnlockDurationSeconds, networkOverride?: StellarNetwork) => Promise<string>;
  lock: () => Promise<void>;
  refreshSession: () => Promise<void>;

  // Transitional aliases for callers that have not yet adopted Lock/Unlock
  // vocabulary. Product UI must use unlock/lock.
  signIn: (durationSeconds?: UnlockDurationSeconds) => Promise<string>;
  signOut: () => Promise<void>;
}

interface AuthStatusResponse {
  authenticated?: boolean;
  unlocked?: boolean;
  address?: string;
  network?: StellarNetwork;
  expires_at?: number;
  error?: string;
}

interface AuthChallengeResponse {
  message?: string;
  transaction?: string;
  network?: StellarNetwork;
  network_passphrase?: string;
  unlock_seconds?: number;
  error?: string;
}

interface AuthSessionResponse {
  address: string;
  network: StellarNetwork;
  expires_at: number;
}

const StellarWalletContext = createContext<StellarWalletContextValue | null>(null);

function storedNetwork(): StellarNetwork | null {
  const value = sessionStorage.getItem(STORAGE_NETWORK_KEY);
  return value === 'public' || value === 'testnet' ? value : null;
}

function storedNetworkSource(): WalletNetworkSource | null {
  const value = sessionStorage.getItem(STORAGE_NETWORK_SOURCE_KEY);
  return value === 'wallet' || value === 'application' ? value : null;
}

function storedExplicitNetwork(): StellarNetwork | null {
  const value = sessionStorage.getItem(STORAGE_EXPLICIT_NETWORK_KEY);
  return value === 'public' || value === 'testnet' ? value : null;
}

function rememberExplicitNetwork(network: StellarNetwork) {
  sessionStorage.setItem(STORAGE_EXPLICIT_NETWORK_KEY, network);
}

function rememberIdentity(identity: WalletIdentity) {
  sessionStorage.setItem(STORAGE_KEY, identity.address);
  sessionStorage.setItem(STORAGE_NETWORK_KEY, identity.network);
  sessionStorage.setItem(STORAGE_NETWORK_SOURCE_KEY, identity.networkSource);
}

function forgetIdentity() {
  sessionStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_NETWORK_KEY);
  sessionStorage.removeItem(STORAGE_NETWORK_SOURCE_KEY);
}

function storedAutoConnectSuppression() {
  return sessionStorage.getItem(AUTO_CONNECT_SUPPRESSED_KEY) === '1';
}

function rememberAutoConnectSuppression(suppressed: boolean) {
  if (suppressed) sessionStorage.setItem(AUTO_CONNECT_SUPPRESSED_KEY, '1');
  else sessionStorage.removeItem(AUTO_CONNECT_SUPPRESSED_KEY);
}

function errorMessage(cause: unknown, fallback: string): string {
  return walletActionErrorMessage(cause, fallback);
}

async function apiBody<T>(response: Response): Promise<T & { error?: string }> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Request failed with HTTP ${response.status}.`);
  return body;
}

export function StellarWalletProvider({ children }: { children: ReactNode }) {
  const initialExplicitNetwork = explicitNetworkFromSearch(window.location.search) ?? storedExplicitNetwork();
  const explicitNetworkRef = useRef<StellarNetwork | null>(initialExplicitNetwork);
  const [address, setAddress] = useState(() => sessionStorage.getItem(STORAGE_KEY) ?? '');
  const [network, setNetwork] = useState<StellarNetwork | null>(() => initialExplicitNetwork ?? storedNetwork());
  const [networkSource, setNetworkSource] = useState<WalletNetworkSource | null>(() => storedNetworkSource());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [unlockedAddress, setUnlockedAddress] = useState('');
  const [unlockedNetwork, setUnlockedNetwork] = useState<StellarNetwork | null>(null);
  const [unlockExpiresAt, setUnlockExpiresAt] = useState<number | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [unlockClock, setUnlockClock] = useState(0);
  const invalidatingUnlockRef = useRef(false);
  const didBootstrapAuthRef = useRef(false);
  const autoIdentitySuppressedRef = useRef(storedAutoConnectSuppression());

  const setAutoIdentitySuppressed = useCallback((suppressed: boolean) => {
    autoIdentitySuppressedRef.current = suppressed;
    rememberAutoConnectSuppression(suppressed);
  }, []);

  const applyWalletIdentity = useCallback((identity: WalletIdentity | null) => {
    if (!identity) {
      setAddress('');
      setNetwork(null);
      setNetworkSource(null);
      forgetIdentity();
      return;
    }
    const effectiveNetwork = identity.networkSource === 'application'
      ? resolveNetworklessWalletContext(identity.network, explicitNetworkRef.current)
      : identity.network;
    const effectiveIdentity = { ...identity, network: effectiveNetwork };
    setAddress(effectiveIdentity.address);
    setNetwork(effectiveIdentity.network);
    setNetworkSource(effectiveIdentity.networkSource);
    rememberIdentity(effectiveIdentity);
  }, []);

  const refreshWalletIdentity = useCallback(async (): Promise<WalletIdentity | null> => {
    if (autoIdentitySuppressedRef.current) return null;
    try {
      const identity = await getConnectedWalletIdentity();
      applyWalletIdentity(identity);
      return identity;
    } catch {
      return null;
    }
  }, [applyWalletIdentity]);

  const clearUnlockState = useCallback(() => {
    setUnlockedAddress('');
    setUnlockedNetwork(null);
    setUnlockExpiresAt(null);
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const response = await fetch('/api/auth', { cache: 'no-store' });
      const body = await apiBody<AuthStatusResponse>(response);
      if ((body.unlocked ?? body.authenticated) && body.address && body.network) {
        setUnlockedAddress(body.address);
        setUnlockedNetwork(body.network);
        setUnlockExpiresAt(body.expires_at ?? null);
      } else {
        clearUnlockState();
      }
    } catch {
      clearUnlockState();
    }
  }, [clearUnlockState]);

  useEffect(() => {
    if (didBootstrapAuthRef.current) return;
    didBootstrapAuthRef.current = true;
    if (address && network) void refreshSession();
  }, [address, network, refreshSession]);

  useEffect(() => {
    if (!unlockedAddress || !unlockedNetwork) return;
    if (address === unlockedAddress && network === unlockedNetwork) return;
    if (invalidatingUnlockRef.current) return;
    invalidatingUnlockRef.current = true;
    setAuthBusy(true);
    setAuthError('');
    void fetch('/api/auth', { method: 'DELETE' })
      .catch(() => undefined)
      .finally(() => {
        clearUnlockState();
        invalidatingUnlockRef.current = false;
        setAuthBusy(false);
      });
  }, [address, network, unlockedAddress, unlockedNetwork, clearUnlockState]);

  useEffect(() => {
    if (!unlockExpiresAt) return;
    const remainingMs = unlockExpiresAt * 1000 - Date.now();
    if (remainingMs <= 0) {
      clearUnlockState();
      return;
    }
    const timer = window.setTimeout(() => {
      setUnlockClock((value) => value + 1);
      clearUnlockState();
    }, Math.min(remainingMs + 50, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [unlockExpiresAt, clearUnlockState]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    let refreshInFlight = false;
    let consecutiveReadFailures = 0;
    let retryTimer: number | null = null;

    void subscribeWalletIdentity((identity) => {
      if (disposed) return;
      if (identity && autoIdentitySuppressedRef.current) return;
      consecutiveReadFailures = 0;
      applyWalletIdentity(identity);
    }).then((stop) => {
      if (disposed) stop();
      else unsubscribe = stop;
    });

    const refreshQuietly = () => {
      if (disposed || refreshInFlight || document.visibilityState !== 'visible' || autoIdentitySuppressedRef.current) return;
      refreshInFlight = true;
      void refreshWalletIdentity()
        .then((identity) => {
          if (disposed) return;
          if (identity) {
            consecutiveReadFailures = 0;
            return;
          }
          consecutiveReadFailures += 1;
          if (consecutiveReadFailures < WALLET_IDENTITY_FAILURES_BEFORE_CLEAR) {
            retryTimer = window.setTimeout(() => {
              retryTimer = null;
              refreshQuietly();
            }, WALLET_IDENTITY_RETRY_MS);
            return;
          }
          consecutiveReadFailures = 0;
          applyWalletIdentity(null);
        })
        .finally(() => {
          refreshInFlight = false;
        });
    };
    const refreshOnFocus = () => { refreshQuietly(); };
    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') refreshQuietly();
    };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnVisible);
    refreshQuietly();

    return () => {
      disposed = true;
      unsubscribe?.();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnVisible);
    };
  }, [applyWalletIdentity, refreshWalletIdentity]);

  const connect = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const locationNetwork = explicitNetworkFromSearch(window.location.search);
      if (locationNetwork) {
        explicitNetworkRef.current = locationNetwork;
        rememberExplicitNetwork(locationNetwork);
      }
      const identity = await connectWalletIdentity(explicitNetworkRef.current ?? undefined);
      setAutoIdentitySuppressed(false);
      applyWalletIdentity(identity);
      return identity.address;
    } catch (cause) {
      if (isWalletSelectionCancelled(cause)) return '';
      setError(errorMessage(cause, 'Unable to connect a Stellar wallet.'));
      throw cause;
    } finally {
      setBusy(false);
    }
  }, [address, applyWalletIdentity, setAutoIdentitySuppressed]);

  const clear = useCallback(() => {
    setAutoIdentitySuppressed(true);
    applyWalletIdentity(null);
    setError('');
  }, [applyWalletIdentity, setAutoIdentitySuppressed]);

  const alignNetworkContext = useCallback(async (targetNetwork: StellarNetwork) => {
    if (networkSource !== 'application') return;
    const effectiveTargetNetwork = FIXED_DEPLOYMENT_NETWORK ?? targetNetwork;
    try {
      const identity = await getConnectedWalletIdentity(effectiveTargetNetwork);
      if (identity.networkSource === 'application' && !explicitNetworkRef.current) applyWalletIdentity(identity);
    } catch {
      // Page/transaction context must not turn a transient device read into a
      // wallet disconnect. The explicit signing/unlock action will surface it.
    }
  }, [applyWalletIdentity, networkSource]);

  const selectNetworkContext = useCallback(async (targetNetwork: StellarNetwork) => {
    const effectiveTargetNetwork = FIXED_DEPLOYMENT_NETWORK ?? targetNetwork;
    explicitNetworkRef.current = effectiveTargetNetwork;
    rememberExplicitNetwork(effectiveTargetNetwork);
    if (networkSource !== 'application') return;
    try {
      const identity = await getConnectedWalletIdentity(effectiveTargetNetwork);
      if (identity.networkSource === 'application') applyWalletIdentity(identity);
    } catch {
      setNetwork(effectiveTargetNetwork);
    }
  }, [applyWalletIdentity, networkSource]);

  const resolveWalletIdentity = useCallback(async (preferredNetwork?: StellarNetwork) => {
    const requestedNetwork = FIXED_DEPLOYMENT_NETWORK ?? preferredNetwork ?? explicitNetworkRef.current ?? undefined;
    let identity: WalletIdentity;
    try {
      identity = await getConnectedWalletIdentity(requestedNetwork);
    } catch {
      identity = await connectWalletIdentity(requestedNetwork);
    }
    setAutoIdentitySuppressed(false);
    applyWalletIdentity(identity);
    return identity;
  }, [applyWalletIdentity, setAutoIdentitySuppressed]);

  const sign = useCallback(async (xdr: string, transactionNetwork: StellarNetwork) => {
    setBusy(true);
    setError('');
    try {
      const identity = await resolveWalletIdentity(transactionNetwork);
      if (identity.network !== transactionNetwork) {
        throw new Error(`Switch the selected wallet to ${transactionNetwork === 'testnet' ? 'Testnet' : 'Mainnet'} before signing this transaction.`);
      }
      return await signTransactionWithWallet(xdr, transactionNetwork, identity.address);
    } catch (cause) {
      setError(errorMessage(cause, 'The wallet could not sign this transaction.'));
      throw cause;
    } finally {
      setBusy(false);
    }
  }, [resolveWalletIdentity]);

  const signAuthEntry = useCallback(async (preimageXdr: string, authorizationNetwork: StellarNetwork) => {
    setBusy(true);
    setError('');
    try {
      const identity = await resolveWalletIdentity(authorizationNetwork);
      if (identity.network !== authorizationNetwork) {
        throw new Error(`Switch the selected wallet to ${authorizationNetwork === 'testnet' ? 'Testnet' : 'Mainnet'} before authorizing this contract call.`);
      }
      return await signAuthEntryWithWallet(preimageXdr, authorizationNetwork, identity.address);
    } catch (cause) {
      const message = isWalletAuthEntrySigningUnsupported(cause)
        ? 'The selected wallet cannot sign detached Soroban authorization entries. Choose another current signer wallet.'
        : errorMessage(cause, 'The wallet could not sign this Soroban authorization.');
      setError(message);
      throw new Error(message);
    } finally {
      setBusy(false);
    }
  }, [resolveWalletIdentity]);

  const unlock = useCallback(async (durationSeconds?: UnlockDurationSeconds, networkOverride?: StellarNetwork) => {
    const effectiveDurationSeconds = durationSeconds ?? getDefaultUnlockDuration(localStorage);
    setAuthBusy(true);
    setAuthError('');
    try {
      const identity = await resolveWalletIdentity(networkOverride);
      if (FIXED_DEPLOYMENT_NETWORK && identity.networkSource === 'wallet' && identity.network !== FIXED_DEPLOYMENT_NETWORK) {
        throw new Error(`Switch the selected wallet to ${FIXED_DEPLOYMENT_NETWORK === 'testnet' ? 'Testnet' : 'Mainnet'} before signing in.`);
      }
      const challenge = await apiBody<AuthChallengeResponse>(await fetch(
        `/api/auth?account=${encodeURIComponent(identity.address)}&network=${encodeURIComponent(identity.network)}&unlock_seconds=${effectiveDurationSeconds}`,
        { cache: 'no-store' },
      ));
      if (
        !challenge.message
        || !challenge.transaction
        || challenge.network !== identity.network
        || challenge.unlock_seconds !== effectiveDurationSeconds
      ) {
        throw new Error('Private workspace service returned an invalid unlock challenge.');
      }

      let session: AuthSessionResponse | null = null;
      try {
        const signature = await signMessageWithWallet(
          challenge.message,
          identity.network,
          identity.address,
        );
        session = await apiBody<AuthSessionResponse>(await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'sep53',
            challenge: challenge.transaction,
            signature,
            network: identity.network,
            unlock_seconds: effectiveDurationSeconds,
          }),
        }));
      } catch (cause) {
        if (!isWalletMessageSigningUnsupported(cause)) throw cause;
      }

      if (!session) {
        const signedChallenge = await signTransactionWithWallet(
          challenge.transaction,
          identity.network,
          identity.address,
        );
        session = await apiBody<AuthSessionResponse>(await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transaction: signedChallenge,
            network: identity.network,
            unlock_seconds: effectiveDurationSeconds,
          }),
        }));
      }

      if (session.network !== identity.network || session.address !== identity.address) {
        throw new Error('Private workspace unlock does not match the selected wallet.');
      }
      setUnlockedAddress(session.address);
      setUnlockedNetwork(session.network);
      setUnlockExpiresAt(session.expires_at);
      return session.address;
    } catch (cause) {
      setAuthError(errorMessage(cause, 'Unable to unlock the private workspace.'));
      throw cause;
    } finally {
      setAuthBusy(false);
    }
  }, [resolveWalletIdentity]);

  const lock = useCallback(async () => {
    setAuthBusy(true);
    setAuthError('');
    try {
      await fetch('/api/auth', { method: 'DELETE' });
      clearUnlockState();
    } finally {
      setAuthBusy(false);
    }
  }, [clearUnlockState]);

  const signIn = useCallback(async (durationSeconds?: UnlockDurationSeconds) => {
    if (unlockedAddress && unlockedNetwork) await lock();
    const selectedAddress = await connect();
    if (!selectedAddress) return '';
    return unlock(durationSeconds);
  }, [connect, lock, unlock, unlockedAddress, unlockedNetwork]);

  const signOut = useCallback(async () => {
    setAutoIdentitySuppressed(true);
    setAccountMenuOpen(false);
    setAuthBusy(true);
    setAuthError('');
    try {
      await fetch('/api/auth', { method: 'DELETE' }).catch(() => undefined);
    } finally {
      clearUnlockState();
      applyWalletIdentity(null);
      setError('');
      setAuthBusy(false);
    }
  }, [applyWalletIdentity, clearUnlockState, setAutoIdentitySuppressed]);

  const privateUnlocked = useMemo(() => Boolean(
    address
    && network
    && unlockedAddress === address
    && unlockedNetwork === network
    && unlockExpiresAt
    && unlockExpiresAt > Math.floor(Date.now() / 1000),
  // unlockClock forces reevaluation when the expiry timer fires.
  ), [address, network, unlockedAddress, unlockedNetwork, unlockExpiresAt, unlockClock]);

  return (
    <StellarWalletContext.Provider value={{
      address,
      network,
      networkSource,
      busy,
      error,
      connect,
      clear,
      alignNetworkContext,
      selectNetworkContext,
      sign,
      signAuthEntry,
      accountMenuOpen,
      setAccountMenuOpen,
      sessionAddress: address,
      sessionNetwork: network,
      sessionExpiresAt: unlockExpiresAt,
      unlockedAddress,
      unlockedNetwork,
      unlockExpiresAt,
      privateUnlocked,
      authBusy,
      authError,
      unlock,
      lock,
      refreshSession,
      signIn,
      signOut,
    }}>
      {children}
    </StellarWalletContext.Provider>
  );
}

export function useStellarWallet() {
  const context = useContext(StellarWalletContext);
  if (!context) throw new Error('useStellarWallet must be used within StellarWalletProvider.');
  return context;
}
