import { horizonUrl, isValidStellarAccountId } from './horizon.js';
import type { StellarAccountSnapshot, StellarNetwork } from './types.js';

const CACHE_TTL_MS = 5 * 60_000;
const STALE_IF_RATE_LIMITED_MS = 15 * 60_000;
const DEFAULT_RATE_LIMIT_RETRY_MS = 30_000;

interface HorizonSignerAccountRecord {
  account_id: string;
  sequence: string;
  sequence_ledger?: number;
  sequence_time?: string;
  home_domain?: string;
  subentry_count: number;
  num_sponsoring: number;
  num_sponsored: number;
  balances: Array<{
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
    balance: string;
    selling_liabilities?: string;
    buying_liabilities?: string;
    limit?: string;
    is_authorized?: boolean;
  }>;
  thresholds: {
    low_threshold: number;
    med_threshold: number;
    high_threshold: number;
  };
  signers: Array<{
    key: string;
    type: string;
    weight: number;
    sponsor?: string;
  }>;
}

interface CacheEntry {
  accounts: StellarAccountSnapshot[];
  fetchedAt: number;
}

interface SignerAccountsState {
  cache: Map<string, CacheEntry>;
  inFlight: Map<string, Promise<StellarAccountSnapshot[]>>;
  rateLimitedUntil: Map<string, number>;
  generation: Record<StellarNetwork, number>;
}

const stateByFetch = new Map<typeof fetch, SignerAccountsState>();

function stateFor(fetchImpl: typeof fetch): SignerAccountsState {
  const existing = stateByFetch.get(fetchImpl);
  if (existing) return existing;
  const created: SignerAccountsState = {
    cache: new Map(),
    inFlight: new Map(),
    rateLimitedUntil: new Map(),
    generation: { public: 0, testnet: 0 },
  };
  stateByFetch.set(fetchImpl, created);
  return created;
}

export function invalidateSignerAccountsCache(network?: StellarNetwork) {
  const networks: StellarNetwork[] = network ? [network] : ['public', 'testnet'];
  for (const state of stateByFetch.values()) {
    for (const targetNetwork of networks) {
      state.generation[targetNetwork] += 1;
      const prefix = `${targetNetwork}:`;
      for (const key of state.cache.keys()) {
        if (key.startsWith(prefix)) state.cache.delete(key);
      }
      for (const key of state.inFlight.keys()) {
        if (key.startsWith(prefix)) state.inFlight.delete(key);
      }
    }
  }
}

function accountSnapshot(record: HorizonSignerAccountRecord): StellarAccountSnapshot {
  const nativeBalance = record.balances.find((balance) => balance.asset_type === 'native');
  if (!nativeBalance) {
    throw new Error(`Horizon account ${record.account_id} did not include the native XLM balance.`);
  }

  return {
    accountId: record.account_id,
    sequence: record.sequence,
    sequenceLedger: record.sequence_ledger,
    sequenceTime: record.sequence_time,
    homeDomain: record.home_domain || undefined,
    subentryCount: record.subentry_count,
    numSponsoring: record.num_sponsoring,
    numSponsored: record.num_sponsored,
    nativeBalance: nativeBalance.balance,
    nativeSellingLiabilities: nativeBalance.selling_liabilities ?? '0.0000000',
    balances: record.balances.map((balance) => ({
      assetType: balance.asset_type,
      assetCode: balance.asset_type === 'native' ? 'XLM' : balance.asset_code ?? 'Unknown',
      assetIssuer: balance.asset_issuer,
      balance: balance.balance,
      sellingLiabilities: balance.selling_liabilities ?? '0.0000000',
      buyingLiabilities: balance.buying_liabilities ?? '0.0000000',
      limit: balance.limit,
      authorized: balance.is_authorized,
    })),
    thresholds: {
      low: record.thresholds.low_threshold,
      medium: record.thresholds.med_threshold,
      high: record.thresholds.high_threshold,
    },
    signers: record.signers.map((signer) => ({
      key: signer.key,
      type: signer.type,
      weight: signer.weight,
      sponsor: signer.sponsor,
    })),
  };
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
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (cause) => {
        signal.removeEventListener('abort', onAbort);
        reject(cause);
      },
    );
  });
}

function retryAfterMs(response: Response, now: number): number {
  const header = response.headers.get('Retry-After')?.trim();
  if (!header) return DEFAULT_RATE_LIMIT_RETRY_MS;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const retryAt = Date.parse(header);
  if (Number.isFinite(retryAt)) return Math.max(0, retryAt - now);
  return DEFAULT_RATE_LIMIT_RETRY_MS;
}

function rateLimitError(until: number, now: number) {
  const seconds = Math.max(1, Math.ceil((until - now) / 1000));
  return new Error(`Horizon signer lookup is rate limited. Retry in about ${seconds}s.`);
}

export function peekAccountsForSigner(
  signerAddress: string,
  network: StellarNetwork,
  fetchImpl: typeof fetch = fetch,
): StellarAccountSnapshot[] | null {
  const normalizedSigner = signerAddress.trim();
  if (!isValidStellarAccountId(normalizedSigner)) return null;
  const cached = stateFor(fetchImpl).cache.get(`${network}:${normalizedSigner}`);
  if (!cached || Date.now() - cached.fetchedAt >= STALE_IF_RATE_LIMITED_MS) return null;
  return cached.accounts;
}

export async function loadAccountsForSigner(
  signerAddress: string,
  network: StellarNetwork,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<StellarAccountSnapshot[]> {
  const normalizedSigner = signerAddress.trim();
  if (!isValidStellarAccountId(normalizedSigner)) {
    throw new Error('Enter a valid Stellar signing address.');
  }
  if (signal?.aborted) throw abortError();

  const key = `${network}:${normalizedSigner}`;
  const state = stateFor(fetchImpl);
  const now = Date.now();
  const cached = state.cache.get(key);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached.accounts;

  const rateLimitedUntil = state.rateLimitedUntil.get(key) ?? 0;
  if (rateLimitedUntil > now) {
    if (cached && now - cached.fetchedAt < STALE_IF_RATE_LIMITED_MS) return cached.accounts;
    throw rateLimitError(rateLimitedUntil, now);
  }
  if (rateLimitedUntil) state.rateLimitedUntil.delete(key);

  const existing = state.inFlight.get(key);
  if (existing) return waitForSharedRequest(existing, signal);

  const generation = state.generation[network];
  const request = (async () => {
    const baseUrl = new URL(horizonUrl(network));
    let nextUrl = new URL(`${horizonUrl(network)}/accounts`);
    nextUrl.searchParams.set('signer', normalizedSigner); nextUrl.searchParams.set('limit', '200');
    const byAccountId = new Map<string, StellarAccountSnapshot>();
    let fetchedAt = Date.now(); let pageCount = 0;
    while (true) {
      const response = await fetchImpl(nextUrl, { headers: { Accept: 'application/json' } });
      fetchedAt = Date.now();
      if (response.status === 429) {
        const until = fetchedAt + retryAfterMs(response, fetchedAt); state.rateLimitedUntil.set(key, until);
        const stale = state.cache.get(key); if (stale && fetchedAt - stale.fetchedAt < STALE_IF_RATE_LIMITED_MS) return stale.accounts;
        throw rateLimitError(until, fetchedAt);
      }
      if (!response.ok) throw new Error(`Unable to load signing access (${response.status}).`);
      const body = await response.json() as { _embedded?: { records?: HorizonSignerAccountRecord[] }; _links?: { next?: { href?: string } } };
      const records = body._embedded?.records ?? [];
      for (const record of records) if (record.signers.some((signer) => signer.type === 'ed25519_public_key' && signer.key === normalizedSigner && signer.weight > 0)) byAccountId.set(record.account_id, accountSnapshot(record));
      if (records.length < 200) break;
      const nextHref = body._links?.next?.href; if (!nextHref) break;
      const candidate = new URL(nextHref, nextUrl);
      if (candidate.origin !== baseUrl.origin || candidate.pathname !== '/accounts' || candidate.searchParams.get('signer') !== normalizedSigner) throw new Error('Horizon signer pagination returned an invalid next page.');
      if (candidate.toString() === nextUrl.toString()) throw new Error('Horizon signer pagination did not advance.');
      nextUrl = candidate; if (++pageCount > 10_000) throw new Error('Horizon signer pagination exceeded the safety limit.');
    }
    const accounts = [...byAccountId.values()]; state.rateLimitedUntil.delete(key);
    if (state.generation[network] === generation) state.cache.set(key, { accounts, fetchedAt });
    return accounts;
  })();


  state.inFlight.set(key, request);
  const clearInFlight = () => {
    if (state.inFlight.get(key) === request) state.inFlight.delete(key);
  };
  void request.then(clearInFlight, clearInFlight);

  return waitForSharedRequest(request, signal);
}
