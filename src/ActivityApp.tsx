import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  History,
  LoaderCircle,
  RefreshCw,
  WalletCards,
} from 'lucide-react';
import { useAddressBook } from './AddressBookContext';
import PrivateWorkspaceUnlock from './PrivateWorkspaceUnlock';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useStellarWallet } from './StellarWalletContext';
import { horizonTransactionUrl, isValidStellarAccountId } from './stellar/horizon';
import type { ActivityFactEvent, ActivityRequestItem, ActivityResponse } from './stellar/activityTypes';
import { privateSessionAddressHeaders } from './stellar/privateSessionTransport';
import { projectTransactionSemantics } from './stellar/transactionSemantics';
import type { StellarNetwork } from './stellar/types';
import { loadAdoptedTreasuryAccountIds } from './stellar/treasuryPreferences';
import { inspectTransactionXdr } from './stellar/transactionXdr';
import { parseTreasuryRoute, treasuryOverviewHref } from './treasuryNavigation';
import { cachedTreasuryNames, loadSharedTreasuryNames } from './treasuryMetadataCache';
import { treasuryDisplayLabel } from './treasuryDisplay';
import { stellarHref, stellarHrefWithSearch } from './workspaceNavigation';
import { stellarActivityScopeForPath } from './workspaceRoutes';

function shortAddress(address: string) {
  return address.length <= 22 ? address : `${address.slice(0, 10)}…${address.slice(-8)}`;
}

const MAX_ACTIVITY_PROJECTIONS = 8;
const activityProjectionCache = new Map<string, ActivityResponse>();

function activityProjectionKey(
  address: string,
  network: StellarNetwork,
  scope: string,
  accountId: string,
  unlockExpiresAt: number | null,
) {
  return unlockExpiresAt ? `${unlockExpiresAt}:${network}:${address}:${scope}:${accountId}` : '';
}

function cachedActivityProjection(key: string): ActivityResponse | null {
  return key ? activityProjectionCache.get(key) ?? null : null;
}

function cacheActivityProjection(key: string, data: ActivityResponse) {
  if (!key) return;
  activityProjectionCache.delete(key);
  activityProjectionCache.set(key, data);
  while (activityProjectionCache.size > MAX_ACTIVITY_PROJECTIONS) {
    const oldest = activityProjectionCache.keys().next().value as string | undefined;
    if (!oldest) break;
    activityProjectionCache.delete(oldest);
  }
}


function stellarExpertTransactionUrl(hash: string, network: StellarNetwork) {
  return `https://stellar.expert/explorer/${network === 'testnet' ? 'testnet' : 'public'}/tx/${encodeURIComponent(hash)}`;
}

function activityDescription(item: ActivityRequestItem) {
  const inspection = inspectTransactionXdr(item.baseXdr, item.network);
  const semantics = projectTransactionSemantics(inspection);
  if (semantics.kind === 'signing_change') {
    return { title: 'Change account signing', summary: 'Signing configuration change' };
  }
  if (semantics.kind === 'payment' && semantics.primaryOperation && semantics.payment) {
    const { amount, assetCode, destination } = semantics.payment;
    const title = amount && destination
      ? `${amount}${assetCode ? ` ${assetCode}` : ''} → ${shortAddress(destination)}`
      : semantics.primaryOperation.summary;
    return { title, summary: 'Payment' };
  }
  if (semantics.kind === 'single_operation' && semantics.primaryOperation) {
    return { title: semantics.primaryOperation.title, summary: semantics.primaryOperation.summary };
  }
  return {
    title: `${semantics.operationCount} changes in one transaction`,
    summary: semantics.operationTitles.slice(0, 2).join(' · '),
  };
}

function eventCopy(event: ActivityFactEvent, currentAddress: string, signerLabel: (address: string) => string) {
  switch (event.type) {
    case 'request_created': return { title: 'Transaction prepared', tone: 'neutral' as const };
    case 'private_note_added': return { title: 'Private note added', tone: 'neutral' as const };
    case 'private_note_revised': return { title: 'Private note revised', tone: 'neutral' as const };
    case 'private_commitment_created': return { title: 'Private commitment created', tone: 'neutral' as const };
    case 'approval_added': return {
      title: event.actorAddress === currentAddress
        ? 'You signed'
        : event.actorAddress
          ? `${signerLabel(event.actorAddress)} signed`
          : 'Signature added',
      tone: 'positive' as const,
    };
    case 'approval_declined': return {
      title: event.actorAddress === currentAddress
        ? 'You declined'
        : event.actorAddress
          ? `${signerLabel(event.actorAddress)} declined`
          : 'Proposal declined',
      tone: 'warning' as const,
    };
    case 'transaction_submitted': return { title: 'Submitted to Stellar', tone: 'positive' as const };
    case 'transaction_confirmed': return {
      title: event.ledger ? `Confirmed on Stellar · Ledger ${event.ledger.toLocaleString()}` : 'Confirmed on Stellar',
      tone: 'positive' as const,
    };
  }
}

function dotClass(tone: 'neutral' | 'positive' | 'warning') {
  if (tone === 'positive') return 'bg-emerald-500';
  if (tone === 'warning') return 'bg-amber-500';
  return 'bg-neutral-400';
}

function ActivityCard({
  item,
  currentAddress,
  defaultOpen,
  accountLabelFor,
  scopeAccountId,
}: {
  item: ActivityRequestItem;
  currentAddress: string;
  defaultOpen: boolean;
  accountLabelFor: (accountId: string) => string;
  scopeAccountId?: string;
}) {
  const { labelFor } = useAddressBook();
  const [open, setOpen] = useState(defaultOpen);
  const description = activityDescription(item);
  const accountLabel = item.accountIds.length === 1
    ? accountLabelFor(item.accountIds[0])
    : `${item.accountIds.length} source accounts`;
  const confirmed = [...item.events].reverse().find((event) => event.type === 'transaction_confirmed');
  const signerLabel = (signerAddress: string) => labelFor(signerAddress, 'signer') || shortAddress(signerAddress);

  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="group rounded-3xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
      <summary className="cursor-pointer list-none p-5 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-neutral-500 dark:text-neutral-400">
              <span>{accountLabel}</span>
              {item.network === 'testnet' && <><span>·</span><span className="text-sky-700 dark:text-sky-300">Testnet</span></>}
            </div>
            <h2 className="mt-2 break-words text-xl font-bold tracking-tight">{description.title}</h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{description.summary}</p>
          </div>
          <div className="flex shrink-0 items-start gap-3">
            <div className="text-right text-xs text-neutral-400">
              <div>{new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
              <div className="mt-1 font-mono">{item.requestId.match(/.{1,4}/g)?.join('-') ?? item.requestId}</div>
            </div>
            <ChevronDown className={`mt-0.5 h-4 w-4 text-neutral-400 transition ${open ? 'rotate-180' : ''}`} />
          </div>
        </div>
      </summary>

      <div className="px-5 pb-5 sm:px-6 sm:pb-6">
        <div className="border-t border-black/10 pt-5 dark:border-white/10">
          {item.events.map((event, index) => {
            const copy = eventCopy(event, currentAddress, signerLabel);
            const isLast = index === item.events.length - 1;
            return (
              <div key={event.eventId} className="relative grid grid-cols-[18px_minmax(0,1fr)] gap-3 pb-5 last:pb-0">
                {!isLast && <div className="absolute left-[4px] top-3 h-[calc(100%-0.25rem)] w-px bg-black/10 dark:bg-white/10" />}
                <div className={`relative z-10 mt-1.5 h-2.5 w-2.5 rounded-full ${dotClass(copy.tone)}`} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-sm font-semibold">{copy.title}</div>
                    <time className="text-xs text-neutral-400">{new Date(event.occurredAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
                  </div>
                  {event.detail && <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">{event.detail}</p>}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-black/10 pt-4 dark:border-white/10">
          <div>
            {confirmed && <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />Confirmed</div>}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-xs font-semibold">
            {confirmed ? <a href={stellarHrefWithSearch('/receipt', { request: item.requestId, account: scopeAccountId, network: item.network })} className="underline decoration-black/20 underline-offset-4 dark:decoration-white/20">Transaction receipt</a> : <a href={stellarHrefWithSearch('/s', { request: item.requestId, network: item.network })} className="underline decoration-emerald-600/30 text-emerald-700 underline-offset-4 dark:text-emerald-300">Review & Submit</a>}
            {confirmed && <a href={horizonTransactionUrl(item.transactionHash, item.network)} target="_blank" rel="noreferrer" className="underline decoration-black/20 underline-offset-4 dark:decoration-white/20">View network record</a>}
            {confirmed && <a href={stellarExpertTransactionUrl(item.transactionHash, item.network)} target="_blank" rel="noreferrer" className="underline decoration-black/20 underline-offset-4 dark:decoration-white/20">View on StellarExpert</a>}
          </div>
        </div>
      </div>
    </details>
  );
}

export default function ActivityApp() {
  const {
    address,
    network: connectedNetwork,
    networkSource,
    privateUnlocked,
    unlockedAddress,
    unlockedNetwork,
    unlockExpiresAt,
  } = useStellarWallet();
  const { labelFor } = useAddressBook();
  const activityScope = stellarActivityScopeForPath(window.location.pathname) ?? 'personal';
  const isTreasuryActivity = activityScope === 'treasury';
  const route = isTreasuryActivity
    ? parseTreasuryRoute(window.location.search)
    : { accountId: '', network: null };
  const accountParam = route.accountId;
  const network = networkSource === 'application' && route.network ? route.network : connectedNetwork;
  const routeNetworkMismatch = Boolean(route.network && connectedNetwork && networkSource === 'wallet' && route.network !== connectedNetwork);
  const privateReady = Boolean(
    privateUnlocked
    && address
    && network
    && unlockedAddress === address
    && unlockedNetwork === network,
  );
  const initialAccountId = isValidStellarAccountId(accountParam) ? accountParam : '';
  const initialProjectionKey = privateReady && address && network && !routeNetworkMismatch
    ? activityProjectionKey(address, network, activityScope, initialAccountId, unlockExpiresAt)
    : '';
  const [accountId, setAccountId] = useState(initialAccountId);
  const [accountOptions, setAccountOptions] = useState<string[]>([]);
  const [treasuryNames, setTreasuryNames] = useState<Record<string, string>>({});
  const [data, setData] = useState<ActivityResponse | null>(() => cachedActivityProjection(initialProjectionKey));
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState('');
  const projectionKey = privateReady && address && network && !routeNetworkMismatch
    ? activityProjectionKey(address, network, activityScope, isTreasuryActivity ? accountId : '', unlockExpiresAt)
    : '';

  useEffect(() => {
    setData(cachedActivityProjection(projectionKey));
    setError('');
  }, [projectionKey]);

  useEffect(() => {
    if (!isTreasuryActivity || !address || !network || routeNetworkMismatch) {
      setAccountOptions(accountId ? [accountId] : []);
      return;
    }
    const adoptedIds = loadAdoptedTreasuryAccountIds(localStorage, address, network);
    const ids = [...new Set([...adoptedIds, ...(accountId ? [accountId] : [])])];
    setAccountOptions(ids);
    if (!accountId && ids.length === 1) setAccountId(ids[0]);
  }, [isTreasuryActivity, address, network, accountId, routeNetworkMismatch]);

  const activityAccountIds = useMemo(
    () => data ? [...new Set(data.items.flatMap((item) => item.accountIds))] : [],
    [data],
  );
  const treasuryNameIds = isTreasuryActivity ? accountOptions : activityAccountIds;

  useEffect(() => {
    if (!network || treasuryNameIds.length === 0) {
      setTreasuryNames({});
      return;
    }
    setTreasuryNames(cachedTreasuryNames(sessionStorage, network, treasuryNameIds));
    if (!privateReady || !address || routeNetworkMismatch) return;
    let cancelled = false;
    const controller = new AbortController();
    void loadSharedTreasuryNames(treasuryNameIds, network, address, controller.signal)
      .then((names) => { if (!cancelled) setTreasuryNames((current) => ({ ...current, ...names })); })
      .catch(() => undefined);
    return () => { cancelled = true; controller.abort(); };
  }, [privateReady, address, network, routeNetworkMismatch, treasuryNameIds]);

  async function loadActivity(targetAccount = accountId, cursor?: string, append = false) {
    if (!privateReady || !address || !network) return;
    if (isTreasuryActivity && !targetAccount) {
      setData(null);
      return;
    }
    if (append) setLoadingOlder(true); else setLoading(true);
    setError('');
    try {
      const url = new URL('/api/activity', window.location.origin);
      if (isTreasuryActivity && targetAccount) url.searchParams.set('account', targetAccount);
      if (cursor) url.searchParams.set('cursor', cursor);
      const response = await fetch(url, { cache: 'no-store' });
      const body = await response.json() as ActivityResponse & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Unable to load Activity.');
      if (body.address !== address || body.network !== network) throw new Error('Activity response identity changed.');
      if (isTreasuryActivity && body.accountId !== targetAccount) throw new Error('Activity response treasury changed.');
      const targetProjectionKey = activityProjectionKey(
        address,
        network,
        activityScope,
        isTreasuryActivity ? targetAccount : '',
        unlockExpiresAt,
      );
      setData((current) => {
        const next = append && current
          ? { ...body, items: [...current.items, ...body.items] }
          : body;
        cacheActivityProjection(targetProjectionKey, next);
        return next;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load Activity.');
    } finally {
      if (append) setLoadingOlder(false); else setLoading(false);
    }
  }

  useEffect(() => {
    if (privateReady && (!isTreasuryActivity || accountId)) void loadActivity(accountId);
    else setData(null);
  }, [privateReady, isTreasuryActivity, accountId]);

  function chooseAccount(next: string) {
    setAccountId(next);
    if (address && network) {
      setData(cachedActivityProjection(activityProjectionKey(address, network, activityScope, next, unlockExpiresAt)));
    }
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('account', next);
    else url.searchParams.delete('account');
    if (next && network) url.searchParams.set('network', network); else if (!next) url.searchParams.delete('network');
    window.history.replaceState({}, '', url);
  }

  const heading = isTreasuryActivity ? 'Treasury Activity' : 'Activity';
  const subheading = isTreasuryActivity
    ? 'Retained MultiSig Tools proposal and transaction history for this Treasury.'
    : 'Proposal and transaction history this wallet saved, signed, declined, or otherwise participated in.';
  const accountLabelFor = (id: string) =>
    treasuryDisplayLabel(treasuryNames[id], labelFor(id, 'account')) || shortAddress(id);

  return (
    <StellarWorkspaceShell active="activity" networkContext={network}>
      <main className="px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-5xl">
          {isTreasuryActivity && accountId && network && !routeNetworkMismatch && <a href={treasuryOverviewHref(accountId, network)} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-neutral-600 hover:text-black dark:text-neutral-300 dark:hover:text-white"><ArrowLeft className="h-4 w-4" />Treasury</a>}
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-black/10 pb-5 dark:border-white/10">
            <div>
              <div className="flex items-center gap-3">
                <History className="h-6 w-6 text-neutral-400" />
                <h1 className="text-3xl font-bold tracking-tight">{heading}</h1>
              </div>
              <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{subheading}</p>
            </div>
            {privateReady && data && (
              <button type="button" disabled={loading} onClick={() => void loadActivity()} aria-label="Refresh Activity" className="rounded-xl border border-black/10 p-2.5 hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/10"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
            )}
          </div>

          {routeNetworkMismatch && <div className="mt-5 flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />This Treasury link is for {route.network === 'testnet' ? 'Testnet' : 'Mainnet'}, but the connected wallet is on {connectedNetwork === 'testnet' ? 'Testnet' : 'Mainnet'}.</div>}

          {!privateReady && !routeNetworkMismatch && (
            <PrivateWorkspaceUnlock
              title="Confirm your wallet"
              description="Choose or confirm a Stellar wallet to open its private Activity. This does not sign or submit a transaction."
              buttonLabel="Open Activity"
            />
          )}

          {address && privateReady && isTreasuryActivity && (
            <section className="mt-5 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03] sm:p-5">
              {accountOptions.length > 1 ? (
                <label className="block max-w-xl">
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">Treasury</span>
                  <select value={accountId} onChange={(event) => chooseAccount(event.target.value)} className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-3 text-sm font-semibold outline-none focus:border-emerald-500 dark:border-white/10 dark:bg-[#151515]">
                    <option value="">Choose a treasury</option>
                    {accountOptions.map((id) => <option key={id} value={id}>{treasuryNames[id] || `Treasury · ${shortAddress(id)}`}</option>)}
                  </select>
                </label>
              ) : accountId ? (
                <div><div className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">Treasury</div><div className="mt-1 font-semibold">{treasuryNames[accountId] || shortAddress(accountId)}</div></div>
              ) : null}
              {accountOptions.length === 0 && !accountId && <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">No saved treasuries were found for this wallet.</p>}
            </section>
          )}

          {error && <div className="mt-5 flex gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
          {loading && !data && <div className="mt-8 flex items-center gap-3 text-sm text-neutral-500 dark:text-neutral-400"><LoaderCircle className="h-5 w-5 animate-spin" />Loading Activity…</div>}

          {privateReady && isTreasuryActivity && !accountId && (
            <section className="py-16 text-center sm:py-20">
              <WalletCards className="mx-auto h-8 w-8 text-neutral-400" />
              <h2 className="mt-4 text-2xl font-bold">Choose a treasury</h2>
              <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Treasury Activity never grants additional history access; it only groups transactions this wallet saved or participated in.</p>
            </section>
          )}

          {data && data.items.length === 0 && (
            <section className="py-16 text-center sm:py-20">
              <Clock3 className="mx-auto h-8 w-8 text-neutral-400" />
              <h2 className="mt-4 text-2xl font-bold">No Activity yet</h2>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-neutral-500 dark:text-neutral-400">{isTreasuryActivity ? 'No retained proposal or transaction history is associated with this treasury yet.' : 'Transactions you save or participate in through MultiSig Tools will appear here.'}</p>
            </section>
          )}

          {data && data.items.length > 0 && (
            <div className="mt-5 space-y-4">
              {data.items.map((item, index) => (
                <ActivityCard
                  key={item.requestId}
                  item={item}
                  currentAddress={data.address}
                  defaultOpen={data.items.length <= 2 || index === 0}
                  accountLabelFor={accountLabelFor}
                  scopeAccountId={isTreasuryActivity ? accountId : undefined}
                />
              ))}
              {data.nextCursor && <div className="flex justify-center pt-2"><button type="button" disabled={loadingOlder} onClick={() => void loadActivity(accountId, data.nextCursor, true)} className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/10">{loadingOlder ? 'Loading…' : 'Load older'}</button></div>}
            </div>
          )}
        </div>
      </main>
    </StellarWorkspaceShell>
  );
}
