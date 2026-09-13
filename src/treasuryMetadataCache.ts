import type { StellarNetwork } from './stellar/types.js';
import { privateSessionAddressHeaders } from './stellar/privateSessionTransport.js';

const CACHE_PREFIX = 'multisig-tools.treasury-name.v2';
const CACHE_TTL_MS = 5 * 60_000;
const BATCH_SIZE = 50;

interface CacheRecord {
  version: 2;
  name: string | null;
  fetchedAt: number;
}

interface LoadOptions {
  fetchImpl?: typeof fetch;
  storage?: Storage;
  origin?: string;
  now?: () => number;
}

const inFlightByFetch = new WeakMap<typeof fetch, Map<string, Promise<Record<string, string>>>>();

function key(network: StellarNetwork, accountId: string) {
  return `${CACHE_PREFIX}:${network}:${accountId}`;
}

function readRecord(storage: Storage, network: StellarNetwork, accountId: string): CacheRecord | null {
  try {
    const raw = storage.getItem(key(network, accountId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<CacheRecord>;
    if (value.version !== 2 || (value.name !== null && typeof value.name !== 'string') || typeof value.fetchedAt !== 'number') return null;
    return { version: 2, name: value.name?.trim() || null, fetchedAt: value.fetchedAt };
  } catch {
    return null;
  }
}

function writeRecord(storage: Storage, network: StellarNetwork, accountId: string, name: string | null, fetchedAt: number) {
  try {
    storage.setItem(key(network, accountId), JSON.stringify({ version: 2, name: name?.trim() || null, fetchedAt } satisfies CacheRecord));
  } catch {
    // Display cache is best-effort and never authorization evidence.
  }
}

export function cachedTreasuryName(storage: Storage, network: StellarNetwork, accountId: string): string {
  return readRecord(storage, network, accountId)?.name ?? '';
}

export function cachedTreasuryNames(storage: Storage, network: StellarNetwork, accountIds: string[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const accountId of accountIds) {
    const name = cachedTreasuryName(storage, network, accountId);
    if (name) names[accountId] = name;
  }
  return names;
}

export function cacheTreasuryName(
  storage: Storage,
  network: StellarNetwork,
  accountId: string,
  name: string | null | undefined,
  now = Date.now(),
) {
  try {
    const normalized = name?.trim() ?? '';
    if (normalized) writeRecord(storage, network, accountId, normalized, now);
    else storage.removeItem(key(network, accountId));
  } catch {
    // Display cache is best-effort and never authorization evidence.
  }
}

function abortError() {
  const error = new Error('The request was aborted.');
  error.name = 'AbortError';
  return error;
}

function waitForSharedRequest<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => { signal.removeEventListener('abort', onAbort); reject(abortError()); };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (cause) => { signal.removeEventListener('abort', onAbort); reject(cause); },
    );
  });
}

async function fetchBatch(
  batch: string[],
  network: StellarNetwork,
  address: string,
  fetchImpl: typeof fetch,
  storage: Storage,
  origin: string,
  fetchedAt: number,
): Promise<Record<string, string>> {
  const url = new URL('/api/treasury-box', origin);
  url.searchParams.set('network', network);
  url.searchParams.set('accounts', batch.join(','));
  const response = await fetchImpl(url, {
    cache: 'no-store',
    headers: privateSessionAddressHeaders(address),
  });
  const body = await response.json() as {
    metadataByAccount?: Record<string, { name?: string } | null>;
    error?: string;
  };
  if (!response.ok) throw new Error(body.error || 'Unable to load shared Treasury names.');
  const names: Record<string, string> = {};
  for (const accountId of batch) {
    const metadata = body.metadataByAccount?.[accountId] ?? null;
    const name = metadata?.name?.trim() || null;
    writeRecord(storage, network, accountId, name, fetchedAt);
    if (name) names[accountId] = name;
  }
  return names;
}

export async function loadSharedTreasuryNames(
  accountIds: string[],
  network: StellarNetwork,
  address: string,
  signal?: AbortSignal,
  options: LoadOptions = {},
): Promise<Record<string, string>> {
  const unique = [...new Set(accountIds.filter(Boolean))];
  const fetchImpl = options.fetchImpl ?? fetch;
  const storage = options.storage ?? sessionStorage;
  const origin = options.origin ?? window.location.origin;
  const now = options.now ?? Date.now;
  const currentTime = now();
  const names: Record<string, string> = {};
  const stale: string[] = [];

  for (const accountId of unique) {
    const record = readRecord(storage, network, accountId);
    if (record && currentTime - record.fetchedAt < CACHE_TTL_MS) {
      if (record.name) names[accountId] = record.name;
    } else {
      stale.push(accountId);
    }
  }

  let inFlight = inFlightByFetch.get(fetchImpl);
  if (!inFlight) {
    inFlight = new Map();
    inFlightByFetch.set(fetchImpl, inFlight);
  }

  for (let index = 0; index < stale.length; index += BATCH_SIZE) {
    const batch = stale.slice(index, index + BATCH_SIZE);
    const requestKey = `${origin}|${network}|${address}|${batch.join(',')}`;
    let request = inFlight.get(requestKey);
    if (!request) {
      request = fetchBatch(batch, network, address, fetchImpl, storage, origin, currentTime);
      inFlight.set(requestKey, request);
      const clear = () => { if (inFlight?.get(requestKey) === request) inFlight.delete(requestKey); };
      void request.then(clear, clear);
    }
    Object.assign(names, await waitForSharedRequest(request, signal));
  }
  return names;
}
