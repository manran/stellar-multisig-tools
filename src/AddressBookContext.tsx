import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useStellarWallet } from './StellarWalletContext';
import { preferredAddressEntry, preferredAddressLabel } from './stellar/addressIdentity';

export type AddressAliasSubjectType = 'account' | 'signer';

export interface AddressAliasEntry {
  address: string;
  subjectType: AddressAliasSubjectType;
  label: string;
  createdAt: string;
  updatedAt: string;
}

interface AddressBookContextValue {
  entries: AddressAliasEntry[];
  loading: boolean;
  error: string;
  labelFor(address: string, subjectType: AddressAliasSubjectType): string;
  saveAlias(address: string, subjectType: AddressAliasSubjectType, label: string): Promise<void>;
  removeAlias(address: string, subjectType: AddressAliasSubjectType): Promise<void>;
}

const AddressBookContext = createContext<AddressBookContextValue | null>(null);
const ADDRESS_BOOK_CACHE_PREFIX = 'multisig-tools.address-book.v1';

function cacheKey(address: string, network: string) {
  return `${ADDRESS_BOOK_CACHE_PREFIX}:${network}:${address}`;
}

function parseEntry(value: unknown): AddressAliasEntry | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const subjectType = record.subject_type ?? record.subjectType;
  if (typeof record.address !== 'string' || typeof record.label !== 'string') return null;
  if (subjectType !== 'account' && subjectType !== 'signer') return null;
  return {
    address: record.address,
    subjectType,
    label: record.label,
    createdAt: typeof record.created_at === 'string'
      ? record.created_at
      : typeof record.createdAt === 'string' ? record.createdAt : '',
    updatedAt: typeof record.updated_at === 'string'
      ? record.updated_at
      : typeof record.updatedAt === 'string' ? record.updatedAt : '',
  };
}

function readCache(address: string, network: string): AddressAliasEntry[] {
  try {
    const raw = sessionStorage.getItem(cacheKey(address, network));
    if (!raw) return [];
    const values = JSON.parse(raw) as unknown;
    if (!Array.isArray(values)) return [];
    return values.map(parseEntry).filter((entry): entry is AddressAliasEntry => Boolean(entry));
  } catch {
    return [];
  }
}

function writeCache(address: string, network: string, entries: AddressAliasEntry[]) {
  try {
    sessionStorage.setItem(cacheKey(address, network), JSON.stringify(entries));
  } catch {
    // Private display cache is best-effort. The API remains the source of truth.
  }
}

function newestEntry(entries: AddressAliasEntry[]): AddressAliasEntry | null {
  return preferredAddressEntry(entries, entries[0]?.address ?? '');
}

export function AddressBookProvider({ children }: { children: ReactNode }) {
  const { privateUnlocked, unlockedAddress, unlockedNetwork } = useStellarWallet();
  const [entries, setEntries] = useState<AddressAliasEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const replaceEntries = useCallback((next: AddressAliasEntry[]) => {
    setEntries(next);
    if (unlockedAddress && unlockedNetwork) writeCache(unlockedAddress, unlockedNetwork, next);
  }, [unlockedAddress, unlockedNetwork]);

  useEffect(() => {
    if (!privateUnlocked || !unlockedAddress || !unlockedNetwork) {
      setEntries([]);
      setError('');
      setLoading(false);
      return;
    }

    const cached = readCache(unlockedAddress, unlockedNetwork);
    setEntries(cached);
    setLoading(cached.length === 0);
    setError('');

    let cancelled = false;
    const controller = new AbortController();
    void fetch('/api/address-book', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as { entries?: unknown[]; error?: string };
        if (!response.ok) throw new Error(body.error || `Unable to load address book (${response.status}).`);
        return (body.entries ?? []).map(parseEntry).filter((entry): entry is AddressAliasEntry => Boolean(entry));
      })
      .then((loaded) => {
        if (cancelled) return;
        setEntries(loaded);
        writeCache(unlockedAddress, unlockedNetwork, loaded);
      })
      .catch((cause) => {
        if (!cancelled && !controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Unable to refresh address book.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [privateUnlocked, unlockedAddress, unlockedNetwork]);

  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const address of new Set(entries.map((entry) => entry.address))) {
      const label = preferredAddressLabel(entries, address);
      if (label) map.set(address, label);
    }
    return map;
  }, [entries]);

  const labelFor = useCallback(
    (address: string, _subjectType: AddressAliasSubjectType) => labels.get(address) ?? '',
    [labels],
  );

  const saveAlias = useCallback(async (address: string, subjectType: AddressAliasSubjectType, label: string) => {
    if (!privateUnlocked || !unlockedAddress || !unlockedNetwork) {
      throw new Error('Unlock your private workspace to save private names.');
    }
    const value = label.trim();
    if (!value) throw new Error('Name cannot be empty.');

    const previous = entries;
    const now = new Date().toISOString();
    const existing = newestEntry(previous.filter((entry) => entry.address === address));
    const optimistic: AddressAliasEntry = {
      address,
      subjectType,
      label: value,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    replaceEntries([...previous.filter((entry) => entry.address !== address), optimistic]);
    setError('');

    try {
      const response = await fetch('/api/address-book', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ address, subject_type: subjectType, label: value }),
      });
      const body = await response.json().catch(() => ({})) as { entry?: unknown; error?: string };
      if (!response.ok) throw new Error(body.error || `Unable to save name (${response.status}).`);
      const entry = parseEntry(body.entry);
      if (!entry) throw new Error('Address book returned an invalid entry.');
      replaceEntries([...previous.filter((item) => item.address !== address), entry]);

      const opposite = subjectType === 'account' ? 'signer' : 'account';
      if (previous.some((item) => item.address === address && item.subjectType === opposite)) {
        void fetch('/api/address-book', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ address, subject_type: opposite }),
        }).catch(() => undefined);
      }
    } catch (cause) {
      replaceEntries(previous);
      const message = cause instanceof Error ? cause.message : 'Unable to save name.';
      setError(message);
      throw new Error(message);
    }
  }, [privateUnlocked, unlockedAddress, unlockedNetwork, entries, replaceEntries]);

  const removeAlias = useCallback(async (address: string, subjectType: AddressAliasSubjectType) => {
    if (!privateUnlocked || !unlockedAddress || !unlockedNetwork) {
      throw new Error('Unlock your private workspace to change private names.');
    }
    const previous = entries;
    const storedTypes = [...new Set(previous
      .filter((item) => item.address === address)
      .map((item) => item.subjectType))];
    const types = storedTypes.length > 0 ? storedTypes : [subjectType];
    replaceEntries(previous.filter((item) => item.address !== address));
    setError('');

    try {
      await Promise.all(types.map(async (type) => {
        const response = await fetch('/api/address-book', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ address, subject_type: type }),
        });
        const body = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(body.error || `Unable to remove name (${response.status}).`);
      }));
    } catch (cause) {
      replaceEntries(previous);
      const message = cause instanceof Error ? cause.message : 'Unable to remove name.';
      setError(message);
      throw new Error(message);
    }
  }, [privateUnlocked, unlockedAddress, unlockedNetwork, entries, replaceEntries]);

  const value = useMemo<AddressBookContextValue>(() => ({
    entries,
    loading,
    error,
    labelFor,
    saveAlias,
    removeAlias,
  }), [entries, loading, error, labelFor, saveAlias, removeAlias]);

  return <AddressBookContext.Provider value={value}>{children}</AddressBookContext.Provider>;
}

export function useAddressBook(): AddressBookContextValue {
  const value = useContext(AddressBookContext);
  if (!value) throw new Error('useAddressBook must be used inside AddressBookProvider.');
  return value;
}
