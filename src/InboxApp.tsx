import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CircleAlert, Inbox, LoaderCircle, RefreshCw } from 'lucide-react';
import { useAddressBook } from './AddressBookContext';
import PrivateWorkspaceUnlock from './PrivateWorkspaceUnlock';
import { NetworkBadge, PageHeader, RequestStatusBadge, StatusBadge } from './MultiSigUi';
import ReviewTransactionSummary from './ReviewTransactionSummary';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useStellarWallet } from './StellarWalletContext';
import {
  inboxViewerActionNeedsAction,
  inboxViewerActionPresentation,
} from '../packages/stellar-core/src/inboxPresentation';
import type { InboxActionCounts, InboxRequestSnapshot } from '../packages/stellar-core/src/inboxPresentation';
import { describeInboxRequest, inboxDeadlineLabel } from './stellar/inboxRequestPresentation';
import { intentAuthorizationWindowLabel, intentViewerActionNeedsAction, intentViewerActionPresentation } from './stellar/sorobanIntentPresentation';
import type { InboxSorobanIntentSnapshot } from '../packages/stellar-core/src/sorobanIntentApiTypes';
import type { InboxRequestDescription } from './stellar/inboxRequestPresentation';
import type { StellarNetwork } from '../packages/stellar-core/src/types';
import { navigateWorkspace, stellarHref } from './workspaceNavigation';

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

function DetailPane({ request, description }: { request: InboxRequestSnapshot; description: InboxRequestDescription }) {
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
      </div>
      <ReviewTransactionSummary inspection={description.inspection} />
      <button type="button" onClick={() => openRequestDetails(request)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-base font-semibold text-white hover:bg-emerald-700">{viewerAction.cta} <ArrowRight className="h-4 w-4" /></button>
    </div>
  );
}

export default function InboxApp() {
  const { labelFor } = useAddressBook();
  const {
    privateUnlocked,
    unlockedAddress,
    unlockedNetwork,
  } = useStellarWallet();
  const [data, setData] = useState<InboxResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [view, setView] = useState<InboxView>(() => viewFromUrl());

  async function loadInbox() {
    if (!privateUnlocked || !unlockedAddress || !unlockedNetwork) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/inbox', { cache: 'no-store' });
      const body = await response.json() as InboxResponse & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Unable to load your inbox.');
      setData(body);
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : 'Unable to load your inbox.');
    } finally {
      setLoading(false);
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
    if (privateUnlocked && unlockedAddress && unlockedNetwork) void loadInbox();
    else setData(null);
  }, [privateUnlocked, unlockedAddress, unlockedNetwork]);

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
              description="Transactions waiting for your signature, submission, review, or the next signer."
              meta={data ? <><NetworkBadge network={unlockedNetwork} /><span>{data.pending_count} open {data.pending_count === 1 ? 'work item' : 'work items'}</span></> : <NetworkBadge network={unlockedNetwork} />}
              actions={<button type="button" disabled={loading} onClick={() => void loadInbox()} aria-label="Refresh inbox" className="rounded-xl border border-black/10 p-2.5 hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/10"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>}
            />

            {data && data.pending_count > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                {needsCount > 0 && <button type="button" aria-pressed={view === 'needs'} onClick={() => changeView('needs')} className={`rounded-full px-3 py-1.5 font-semibold ${view === 'needs' ? 'bg-black text-white dark:bg-white dark:text-black' : 'border border-black/10 text-neutral-600 hover:bg-black/5 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/10'}`}>Needs me <span className="ml-1 opacity-60">{needsCount}</span></button>}
                {waitingCount > 0 && <button type="button" aria-pressed={view === 'waiting'} onClick={() => changeView('waiting')} className={`rounded-full px-3 py-1.5 font-semibold ${view === 'waiting' ? 'bg-black text-white dark:bg-white dark:text-black' : 'border border-black/10 text-neutral-600 hover:bg-black/5 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/10'}`}>Waiting <span className="ml-1 opacity-60">{waitingCount}</span></button>}
                <button type="button" aria-pressed={view === 'inbox'} onClick={() => changeView('inbox')} className={`rounded-full px-3 py-1.5 font-semibold ${view === 'inbox' ? 'bg-black text-white dark:bg-white dark:text-black' : 'border border-black/10 text-neutral-600 hover:bg-black/5 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/10'}`}>All <span className="ml-1 opacity-60">{data.pending_count}</span></button>
              </div>
            )}

            {error && <div className="mt-5 flex gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
            {loading && !data && <div className="mt-8 flex items-center gap-3 text-base text-neutral-500 dark:text-neutral-400"><LoaderCircle className="h-5 w-5 animate-spin" />Loading…</div>}

            {data && view === 'inbox' && data.pending_count === 0 && (
              <section className="mx-auto max-w-xl py-16 text-center sm:py-24">
                <Inbox className="mx-auto h-8 w-8 text-neutral-400" />
                <h2 className="mt-4 text-2xl font-bold">You're all caught up.</h2>
                <a href={stellarHref('/new')} className="mt-6 inline-flex items-center gap-2 rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10">New transaction <ArrowRight className="h-4 w-4" /></a>
              </section>
            )}

            {data && view !== 'inbox' && visibleRequests.length === 0 && visibleIntents.length === 0 && (
              <section className="mx-auto max-w-xl py-16 text-center sm:py-24">
                <Inbox className="mx-auto h-8 w-8 text-neutral-400" />
                <h2 className="mt-4 text-2xl font-bold">{view === 'needs' ? 'Nothing needs your action.' : 'Nothing is waiting.'}</h2>
                <button type="button" onClick={() => changeView('inbox')} className="mt-6 inline-flex rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10">Show all Inbox</button>
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
                    <DetailPane request={selectedRequest} description={selectedDescription} />
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
