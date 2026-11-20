import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CircleAlert, Inbox, LoaderCircle, RefreshCw } from 'lucide-react';
import { useAddressBook } from './AddressBookContext';
import PrivateWorkspaceUnlock from './PrivateWorkspaceUnlock';
import { ActionButton, NetworkBadge, PageHeader, RequestStatusBadge, StatusBadge } from './MultiSigUi';
import ReviewTransactionSummary from './ReviewTransactionSummary';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useStellarWallet } from './StellarWalletContext';
import {
  inboxViewerActionNeedsAction,
  inboxViewerActionPresentation,
} from '../../../packages/stellar-core/src/inboxPresentation';
import type { InboxActionCounts, InboxRequestSnapshot } from '../../../packages/stellar-core/src/inboxPresentation';
import {
  describeInboxRequest,
  inboxDeadlineLabel,
  inboxOutgoingSignerProgress,
} from './stellar/inboxRequestPresentation';
import { inboxSenderProgress } from './stellar/inboxSenderProgress';
import { intentAuthorizationWindowLabel, intentViewerActionNeedsAction, intentViewerActionPresentation } from './stellar/sorobanIntentPresentation';
import type { InboxSorobanIntentSnapshot } from '../../../packages/stellar-core/src/sorobanIntentApiTypes';
import type { InboxRequestDescription } from './stellar/inboxRequestPresentation';
import type { StellarNetwork } from '../../../packages/stellar-core/src/types';
import { navigateWorkspace, stellarHref } from './workspaceNavigation';
import { isWalletUserRejected } from './stellar/walletKit';

interface InboxResponse {
  address: string;
  network: StellarNetwork;
  pending_count: number;
  action_count: number;
  action_counts: InboxActionCounts;
  requests: InboxRequestSnapshot[];
  intents: InboxSorobanIntentSnapshot[];
}

type InboxView = 'inbox' | 'needs' | 'waiting';

function openRequestDetails(request: InboxRequestSnapshot) {
  navigateWorkspace('/request', {
    hash: request.id,
    state: {
      requestPreview: request,
      returnTo: window.location.href,
      returnLabel: 'Back to Inbox',
    },
  });
}

function openIntentDetails(intent: InboxSorobanIntentSnapshot) {
  navigateWorkspace('/a', {
    hash: intent.id,
    state: {
      returnTo: window.location.href,
      returnLabel: 'Back to Inbox',
    },
  });
}

function shortAddress(address: string) {
  return address.length <= 24 ? address : `${address.slice(0, 12)}…${address.slice(-9)}`;
}

function viewFromUrl(): InboxView {
  const value = new URLSearchParams(window.location.search).get('view');
  if (value === 'needs' || value === 'waiting') return value;
  return 'inbox';
}

function OutgoingProgress({
  request,
  viewerAddress,
  signerLabel,
  compact = false,
}: {
  request: InboxRequestSnapshot;
  viewerAddress: string;
  signerLabel: (address: string) => string;
  compact?: boolean;
}) {
  const progress = useMemo(() => inboxSenderProgress(request, inboxOutgoingSignerProgress(request, viewerAddress)), [request, viewerAddress]);
  if (progress.length === 0) return null;
  const visible = compact ? progress.slice(0, 2) : progress;
  return (
    <div className={`mt-2 text-xs leading-5 text-[var(--color-muted)] ${compact ? 'space-y-2' : 'space-y-3'}`}>
      {visible.map((item) => (
        <div key={item.signerAddress} title={item.signerAddress}>
          <div>
            <span className="font-semibold text-[var(--color-ink-2)]">Asked {signerLabel(item.signerAddress)}</span>
            <span className={item.needsAttention ? 'font-semibold text-[var(--color-danger)]' : item.signature === 'transaction' ? 'font-semibold text-[var(--color-success)]' : ''}> · {item.label}</span>
          </div>
          <div>
            {item.notification && <span>{item.notification.label}{!compact && <> · <time dateTime={item.notification.occurredAt}>{new Date(item.notification.occurredAt).toLocaleString()}</time></>}</span>}
            {item.viewedAt && <span>{item.notification && ' · '}Viewed{!compact && <> · <time dateTime={item.viewedAt}>{new Date(item.viewedAt).toLocaleString()}</time></>}</span>}
          </div>
          {!compact && <>
            <div>Asked <time dateTime={item.askedAt}>{new Date(item.askedAt).toLocaleString()}</time></div>
            <p className="mt-1 text-[var(--color-ink-2)]">{item.detail}</p>
          </>}
        </div>
      ))}
      {compact && progress.length > visible.length && <div>+{progress.length - visible.length} more asked signer{progress.length - visible.length === 1 ? '' : 's'}</div>}
    </div>
  );
}

function DetailPane({
  request,
  description,
  viewerAddress,
  signerLabel,
}: {
  request: InboxRequestSnapshot;
  description: InboxRequestDescription;
  viewerAddress: string;
  signerLabel: (address: string) => string;
}) {
  const viewerAction = inboxViewerActionPresentation(request.viewerAction);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <RequestStatusBadge status={request.status} />
        <NetworkBadge network={request.network} />
      </div>
      <div className="rounded-xl border border-black/10 p-4 dark:border-white/10">
        <StatusBadge tone={viewerAction.tone}>{viewerAction.label}</StatusBadge>
        <p className="mt-2 text-xs leading-5 text-neutral-600 dark:text-neutral-300">{viewerAction.detail}</p>
        <OutgoingProgress request={request} viewerAddress={viewerAddress} signerLabel={signerLabel} />
      </div>
      <ReviewTransactionSummary inspection={description.inspection} />
      <ActionButton onClick={() => openRequestDetails(request)} className="w-full">{viewerAction.cta} <ArrowRight className="h-4 w-4" /></ActionButton>
    </div>
  );
}

export default function InboxApp() {
  const { labelFor } = useAddressBook();
  const {
    privateUnlocked,
    unlockedAddress,
    unlockedNetwork,
    authBusy,
    busy: walletBusy,
    unlock,
  } = useStellarWallet();
  const [loadedData, setData] = useState<InboxResponse | null>(null);
  const [loadingFor, setLoadingFor] = useState('');
  const [loadError, setLoadError] = useState({ session: '', message: '', requiresVerification: false });
  const activeLoad = useRef<AbortController | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [view, setView] = useState<InboxView>(() => viewFromUrl());
  const session = privateUnlocked && unlockedAddress && unlockedNetwork ? `${unlockedNetwork}:${unlockedAddress}` : '';
  const currentSession = useRef(session);
  currentSession.current = session;
  const data = session && loadedData?.address === unlockedAddress && loadedData.network === unlockedNetwork ? loadedData : null;
  const loading = Boolean(session && loadingFor === session);
  const error = loadError.session === session ? loadError.message : '';
  const requiresVerification = loadError.session === session && loadError.requiresVerification;

  const loadInbox = useCallback(async () => {
    if (!privateUnlocked || !unlockedAddress || !unlockedNetwork) return;
    activeLoad.current?.abort();
    const controller = new AbortController();
    activeLoad.current = controller;
    setLoadingFor(session);
    setLoadError({ session, message: '', requiresVerification: false });
    let needsVerification = false;
    try {
      const response = await fetch('/api/inbox', { cache: 'no-store', signal: controller.signal });
      needsVerification = response.status === 401 || response.status === 403;
      if (!controller.signal.aborted && needsVerification) setData(null);
      const body = await response.json() as InboxResponse & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Unable to load your inbox.');
      if (body.address !== unlockedAddress || body.network !== unlockedNetwork) {
        needsVerification = true;
        if (!controller.signal.aborted) setData(null);
        throw new Error('The wallet session changed. Confirm your wallet and try again.');
      }
      if (!controller.signal.aborted) setData(body);
    } catch (cause) {
      if (!controller.signal.aborted) setLoadError({ session, message: cause instanceof Error ? cause.message : 'Unable to load your inbox.', requiresVerification: needsVerification });
    } finally {
      if (activeLoad.current === controller) {
        setLoadingFor('');
        activeLoad.current = null;
      }
    }
  }, [privateUnlocked, unlockedAddress, unlockedNetwork, session]);

  async function confirmInboxWallet() {
    if (authBusy || walletBusy || loading || !unlockedNetwork) return;
    try {
      const verifiedAddress = await unlock(undefined, unlockedNetwork);
      // A renewed proof for the same identity does not change the effect key.
      // A different identity is loaded by the scoped session effect instead.
      if (verifiedAddress === unlockedAddress && currentSession.current === session) await loadInbox();
    } catch (cause) {
      if (!isWalletUserRejected(cause)) {
        setLoadError({ session, message: cause instanceof Error ? cause.message : 'Unable to confirm this wallet. Try again.', requiresVerification: true });
      }
    }
  }

  function changeView(nextView: InboxView) {
    setView(nextView);
    const url = new URL(window.location.href);
    if (nextView === 'inbox') url.searchParams.delete('view');
    else url.searchParams.set('view', nextView);
    window.history.replaceState({}, '', url);
  }

  useEffect(() => {
    setData(null);
    setSelectedId('');
    if (privateUnlocked && unlockedAddress && unlockedNetwork) void loadInbox();
    return () => activeLoad.current?.abort();
  }, [privateUnlocked, unlockedAddress, unlockedNetwork, loadInbox]);

  const descriptions = useMemo(() => new Map(
    (data?.requests ?? []).map((request) => [request.id, describeInboxRequest(request)]),
  ), [data]);

  const needsCount = data?.action_counts.actionRequired ?? 0;
  const waitingCount = data?.action_counts.waiting ?? 0;

  const visibleRequests = useMemo(() => {
    const requests = [...(data?.requests ?? [])].sort((left, right) =>
      Number(inboxViewerActionNeedsAction(right.viewerAction)) - Number(inboxViewerActionNeedsAction(left.viewerAction)),
    );
    if (view === 'needs') return requests.filter((request) => inboxViewerActionNeedsAction(request.viewerAction));
    if (view === 'waiting') return requests.filter((request) => !inboxViewerActionNeedsAction(request.viewerAction));
    return requests;
  }, [data, view]);

  const visibleIntents = useMemo(() => {
    const intents = [...(data?.intents ?? [])].sort((left, right) =>
      Number(intentViewerActionNeedsAction(right.viewerAction)) - Number(intentViewerActionNeedsAction(left.viewerAction))
      || right.createdAt.localeCompare(left.createdAt),
    );
    if (view === 'needs') return intents.filter((item) => intentViewerActionNeedsAction(item.viewerAction));
    if (view === 'waiting') return intents.filter((item) => !intentViewerActionNeedsAction(item.viewerAction));
    return intents;
  }, [data, view]);

  useEffect(() => {
    if (!visibleRequests.length) {
      setSelectedId('');
      return;
    }
    if (!visibleRequests.some((request) => request.id === selectedId)) setSelectedId(visibleRequests[0].id);
  }, [visibleRequests, selectedId]);

  const selectedRequest = visibleRequests.find((request) => request.id === selectedId) ?? null;
  const selectedDescription = selectedRequest ? descriptions.get(selectedRequest.id) ?? null : null;
  const signerLabel = (address: string) => labelFor(address, 'signer') || shortAddress(address);
  return (
    <StellarWorkspaceShell active={view === 'needs' ? 'inbox' : view}>
      <main className="px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl">
        {!privateUnlocked && (
          <PrivateWorkspaceUnlock
            title="Confirm your wallet"
            description="Choose or confirm a Stellar wallet to open its private Inbox. This does not sign or submit a transaction."
            buttonLabel="Open Inbox"
          />
        )}

        {privateUnlocked && unlockedAddress && unlockedNetwork && (
          <>
            <PageHeader
              icon={<Inbox className="h-6 w-6" />}
              title="Inbox"
              description="See what needs your action and track the signers you invited."
              meta={data ? <><NetworkBadge network={unlockedNetwork} /><span>{data.pending_count} open {data.pending_count === 1 ? 'work item' : 'work items'}</span></> : <NetworkBadge network={unlockedNetwork} />}
              actions={<ActionButton variant="secondary" disabled={loading || authBusy || walletBusy} onClick={() => void loadInbox()} aria-label="Refresh inbox" aria-busy={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />{loading ? 'Refreshing…' : 'Refresh'}</ActionButton>}
            />

            {data && (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                <button type="button" aria-pressed={view === 'needs'} onClick={() => changeView('needs')} className={`min-h-11 rounded-full px-3 py-1.5 font-semibold ${view === 'needs' ? 'bg-black text-white dark:bg-white dark:text-black' : 'border border-black/10 text-neutral-600 hover:bg-black/5 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/10'}`}>Needs me <span className="ml-1 opacity-60">{needsCount}</span></button>
                <button type="button" aria-pressed={view === 'waiting'} onClick={() => changeView('waiting')} className={`min-h-11 rounded-full px-3 py-1.5 font-semibold ${view === 'waiting' ? 'bg-black text-white dark:bg-white dark:text-black' : 'border border-black/10 text-neutral-600 hover:bg-black/5 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/10'}`}>Waiting <span className="ml-1 opacity-60">{waitingCount}</span></button>
                <button type="button" aria-pressed={view === 'inbox'} onClick={() => changeView('inbox')} className={`min-h-11 rounded-full px-3 py-1.5 font-semibold ${view === 'inbox' ? 'bg-black text-white dark:bg-white dark:text-black' : 'border border-black/10 text-neutral-600 hover:bg-black/5 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/10'}`}>All <span className="ml-1 opacity-60">{data.pending_count}</span></button>
              </div>
            )}

            {error && <div role="alert" className="mt-5 flex flex-wrap items-start gap-3 rounded-xl border border-[var(--color-danger)] p-4 text-sm">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-danger)]" />
              <div className="min-w-0 flex-1"><p>{error}</p>{data && <p className="mt-1 text-[var(--color-muted)]">Showing the last loaded proposals. Refresh to check their current status.</p>}</div>
              <ActionButton variant="secondary" size="sm" className="min-h-11" disabled={loading || authBusy || walletBusy} aria-busy={authBusy} onClick={() => requiresVerification ? void confirmInboxWallet() : void loadInbox()}>{authBusy ? 'Confirm in wallet…' : requiresVerification ? 'Confirm wallet' : 'Try again'}</ActionButton>
            </div>}
            {loading && !data && <div role="status" className="mt-8 flex items-center gap-3 text-base text-neutral-500 dark:text-neutral-400"><LoaderCircle className="h-5 w-5 animate-spin" />Loading proposals…</div>}

            {data && !loading && !error && view === 'inbox' && data.pending_count === 0 && (
              <section className="mx-auto max-w-xl py-16 text-center sm:py-24">
                <Inbox className="mx-auto h-8 w-8 text-neutral-400" />
                <h2 className="mt-4 text-2xl font-bold">You're all caught up.</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">No open proposals for this wallet. Completed proposals are in Activity.</p>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <a href={stellarHref('/new')} className="mst-action-primary">New proposal <ArrowRight className="h-4 w-4" /></a>
                  <a href={stellarHref('/activity')} className="inline-flex min-h-11 items-center px-3 text-sm font-semibold text-[var(--color-ink-2)]">View Activity</a>
                </div>
              </section>
            )}

            {data && !loading && !error && view !== 'inbox' && visibleRequests.length === 0 && visibleIntents.length === 0 && (
              <section className="mx-auto max-w-xl py-16 text-center sm:py-24">
                <Inbox className="mx-auto h-8 w-8 text-neutral-400" />
                <h2 className="mt-4 text-2xl font-bold">{view === 'needs' ? 'Nothing needs your action.' : 'Nothing is waiting.'}</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{view === 'needs' ? 'Waiting proposals can still need another signer or submission by an external service.' : 'Use Needs me to find proposals you can act on.'}</p>
                <ActionButton variant="secondary" onClick={() => changeView('inbox')} className="mt-6">Show all proposals</ActionButton>
              </section>
            )}

            {data && visibleIntents.length > 0 && (
              <section className="mt-5">
                <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-neutral-400">Contract authorization</div>
                <div className="mst-inbox-list">
                  {visibleIntents.map((intent) => {
                    const action = intentViewerActionPresentation(intent.viewerAction);
                    return (
                      <button key={intent.id} type="button" onClick={() => openIntentDetails(intent)} className="mst-inbox-item group px-1 sm:px-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <StatusBadge tone={action.tone}>{action.label}</StatusBadge>
                          <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400"><NetworkBadge network={intent.network} /><span>{intentAuthorizationWindowLabel(intent)}</span></div>
                        </div>
                        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                          <div className="min-w-0"><h2 className="text-lg font-bold">Soroban Intent</h2><p className="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{action.detail}</p><div className="mt-2 font-mono text-xs text-neutral-400">Created by {intent.creatorAddress ? shortAddress(intent.creatorAddress) : (intent.creatorActor?.label ?? intent.creatorActor?.id ?? 'external service')}</div></div>
                          <span className="inline-flex shrink-0 items-center gap-2 self-start text-sm font-bold text-violet-700 dark:text-violet-300 sm:self-auto">{action.cta} <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" /></span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {data && visibleRequests.length > 0 && (
              <div className="mt-5 grid min-h-[560px] gap-5 xl:grid-cols-[minmax(300px,0.85fr)_minmax(420px,1.15fr)]">
                <div className="mst-inbox-list">
                  {visibleRequests.map((request) => {
                    const description = descriptions.get(request.id)!;
                    const selected = request.id === selectedId;
                    const sourceAlias = labelFor(description.source, 'account');
                    return (
                      <button key={request.id} type="button" data-selected={selected ? 'true' : 'false'} onClick={() => { if (window.matchMedia('(min-width: 1280px)').matches) setSelectedId(request.id); else openRequestDetails(request); }} className="mst-inbox-item px-1 sm:px-2">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <RequestStatusBadge status={request.status} />
                          <span className="text-neutral-500 dark:text-neutral-400">{inboxDeadlineLabel(description.inspection)}</span>
                        </div>
                        <h2 className="mt-2 text-lg font-bold leading-6">{description.title}</h2>
                        <p className="mt-1 line-clamp-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{description.summary}</p>
                        <div className="mt-3">
                          <StatusBadge tone={inboxViewerActionPresentation(request.viewerAction).tone}>{inboxViewerActionPresentation(request.viewerAction).label}</StatusBadge>
                          <OutgoingProgress request={request} viewerAddress={unlockedAddress} signerLabel={signerLabel} compact />
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                          {request.network === 'testnet' && (
                            <>
                              <span className="font-semibold text-sky-700 dark:text-sky-300">Testnet</span>
                              <span>·</span>
                            </>
                          )}
                          <span title={description.source}>{sourceAlias || shortAddress(description.source)}</span>
                          {sourceAlias && <span className="font-mono opacity-60">{shortAddress(description.source)}</span>}
                        </div>
                        <span className="mt-4 flex w-full items-center justify-between rounded-xl bg-black px-4 py-2.5 text-sm font-bold text-white dark:bg-white dark:text-black xl:hidden">
                          {inboxViewerActionPresentation(request.viewerAction).cta} <ArrowRight className="h-4 w-4" />
                        </span>
                      </button>
                    );
                  })}
                </div>

                {selectedRequest && selectedDescription && (
                  <div className="mst-inbox-detail hidden xl:block">
                    <DetailPane
                      request={selectedRequest}
                      description={selectedDescription}
                      viewerAddress={unlockedAddress}
                      signerLabel={signerLabel}
                    />
                  </div>
                )}

              </div>
            )}
          </>
        )}
        </div>
      </main>
    </StellarWorkspaceShell>
  );
}
