import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { ArrowRight, History, Inbox, Plus, Vault } from 'lucide-react';
import { NetworkBadge, PageHeader, StatusBadge } from './MultiSigUi';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useStellarWallet } from './StellarWalletContext';
import { isWalletUserRejected } from './stellar/walletKit';
import { inboxActionCountPresentations, inboxViewerActionNeedsAction, inboxViewerActionPresentation } from './stellar/inboxPresentation';
import type { InboxActionCounts, InboxRequestSnapshot } from './stellar/inboxPresentation';
import { describeInboxRequest, inboxDeadlineLabel } from './stellar/inboxRequestPresentation';
import { intentAuthorizationWindowLabel, intentViewerActionNeedsAction, intentViewerActionPresentation } from './stellar/sorobanIntentPresentation';
import type { InboxSorobanIntentSnapshot } from './stellar/sorobanIntentApiTypes';
import { navigateWorkspace, stellarHref, stellarHrefWithSearch } from './workspaceNavigation';

interface InboxCountResponse {
  pending_count?: number;
  action_count?: number;
  action_counts?: InboxActionCounts;
  requests?: InboxRequestSnapshot[];
  intents?: InboxSorobanIntentSnapshot[];
}

interface DashboardInboxSummary {
  pendingCount: number;
  actionCounts: InboxActionCounts;
  requests: InboxRequestSnapshot[];
  intents: InboxSorobanIntentSnapshot[];
}

function inboxAttentionCopy(summary: DashboardInboxSummary | null) {
  if (!summary) return 'See proposals that need your signature, submission, or review.';
  const { pendingCount, actionCounts } = summary;
  if (actionCounts.actionRequired === 0) {
    if (pendingCount === 0) return 'No open proposals need your action right now.';
    return `${pendingCount} open ${pendingCount === 1 ? 'proposal is' : 'proposals are'} waiting on other signers or ledger conditions.`;
  }
  const parts: string[] = [];
  if (actionCounts.contractAuthorizationNeeded > 0) parts.push(`${actionCounts.contractAuthorizationNeeded} contract authorization${actionCounts.contractAuthorizationNeeded === 1 ? '' : 's'} need${actionCounts.contractAuthorizationNeeded === 1 ? 's' : ''} you`);
  if (actionCounts.readyForTransactionSigning > 0) parts.push(`${actionCounts.readyForTransactionSigning} ready for transaction signing`);
  if (actionCounts.signatureNeeded > 0) parts.push(`${actionCounts.signatureNeeded} need${actionCounts.signatureNeeded === 1 ? 's' : ''} your signature`);
  if (actionCounts.readyToSubmit > 0) parts.push(`${actionCounts.readyToSubmit} ready to submit`);
  if (actionCounts.needsAttention > 0) parts.push(`${actionCounts.needsAttention} need${actionCounts.needsAttention === 1 ? 's' : ''} review`);
  return parts.join(' · ');
}

function shortAddress(address: string) {
  return address.length <= 24 ? address : `${address.slice(0, 12)}…${address.slice(-9)}`;
}

export default function StellarDashboardApp() {
  const {
    sessionNetwork,
    privateUnlocked,
    authBusy,
    unlock,
  } = useStellarWallet();
  const [inboxSummary, setInboxSummary] = useState<DashboardInboxSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!privateUnlocked) {
      setInboxSummary(null);
      return () => { cancelled = true; };
    }

    void fetch('/api/inbox', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null;
        return await response.json() as InboxCountResponse;
      })
      .then((body) => {
        if (
          !cancelled
          && typeof body?.pending_count === 'number'
          && body.action_counts
          && typeof body.action_counts.actionRequired === 'number'
          && Array.isArray(body.requests)
        ) {
          setInboxSummary({ pendingCount: body.pending_count, actionCounts: body.action_counts, requests: body.requests, intents: Array.isArray(body.intents) ? body.intents : [] });
        }
      })
      .catch(() => {
        if (!cancelled) setInboxSummary(null);
      });

    return () => { cancelled = true; };
  }, [privateUnlocked]);

  async function openPrivateDestination(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (privateUnlocked) return;
    event.preventDefault();
    if (authBusy) return;
    try {
      await unlock();
      window.location.assign(href);
    } catch (cause) {
      if (!isWalletUserRejected(cause)) window.location.assign(href);
    }
  }

  function openRequestDetails(request: InboxRequestSnapshot) {
    navigateWorkspace('/request', {
      hash: request.id,
      state: {
        requestPreview: request,
        returnTo: window.location.href,
        returnLabel: 'Back to Home',
      },
    });
  }

  function openIntentDetails(intent: InboxSorobanIntentSnapshot) {
    navigateWorkspace('/a', {
      hash: intent.id,
      state: {
        returnTo: window.location.href,
        returnLabel: 'Back to Home',
      },
    });
  }

  const intentAttention = (inboxSummary?.intents ?? [])
    .filter((item) => intentViewerActionNeedsAction(item.viewerAction))
    .slice(0, 3);
  const requestAttentionLimit = Math.max(0, 3 - intentAttention.length);

  const testnet = sessionNetwork === 'testnet';
  const accentText = testnet ? 'text-sky-700 dark:text-sky-300' : 'text-emerald-700 dark:text-emerald-300';
  const primaryBg = testnet ? 'bg-sky-700 hover:bg-sky-800' : 'bg-emerald-700 hover:bg-emerald-800';

  return (
    <StellarWorkspaceShell active="dashboard">
      <main className="px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl">
          <PageHeader
            eyebrow={<span className={accentText}>{testnet ? 'Testnet workspace' : 'Your workspace'}</span>}
            title="Dashboard"
            description="Proposals that need attention, the treasuries you work with, and the next action — in one place."
          />

          <section className="mt-6">
            <div className="mb-3 flex items-center justify-between gap-4">
              <div className="text-xs font-bold uppercase tracking-[0.16em] text-neutral-400">What needs your attention</div>
              {inboxSummary && inboxSummary.actionCounts.actionRequired > 0 && (
                <a href={stellarHref('/inbox')} className={`text-sm font-bold ${accentText}`}>View all Inbox</a>
              )}
            </div>

            {!inboxSummary && (
              <a
                href={stellarHref('/inbox')}
                onClick={(event) => void openPrivateDestination(event, stellarHref('/inbox'))}
                className="group flex flex-col gap-5 rounded-3xl border border-black/10 bg-white p-5 shadow-sm transition hover:border-emerald-500/35 dark:border-white/10 dark:bg-white/[0.04] sm:flex-row sm:items-center sm:justify-between sm:p-6"
              >
                <div className="flex min-w-0 items-start gap-4">
                  <div className={`rounded-xl p-3 ${testnet ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'}`}><Inbox className="h-5 w-5" /></div>
                  <div className="min-w-0">
                    <div className="text-lg font-bold">Inbox</div>
                    <p className="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{inboxAttentionCopy(null)}</p>
                  </div>
                </div>
                <div className={`inline-flex shrink-0 items-center gap-2 self-start rounded-xl px-4 py-2.5 text-sm font-bold text-white sm:self-auto ${primaryBg}`}>
                  {authBusy ? 'Confirm in wallet…' : 'Open Inbox'} <ArrowRight className="h-4 w-4" />
                </div>
              </a>
            )}

            {inboxSummary && inboxSummary.actionCounts.actionRequired === 0 && (
              <div className="rounded-3xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.04] sm:p-6">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-4">
                    <div className={`rounded-xl p-3 ${testnet ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'}`}><Inbox className="h-5 w-5" /></div>
                    <div>
                      <div className="text-lg font-bold">You're all caught up.</div>
                      <p className="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{inboxAttentionCopy(inboxSummary)}</p>
                      {inboxSummary.actionCounts.waiting > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2" aria-label="Inbox action summary">
                          {inboxActionCountPresentations(inboxSummary.actionCounts).map((item) => (
                            <StatusBadge key={item.key} tone={item.tone}>{item.label}</StatusBadge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {inboxSummary.actionCounts.waiting > 0 && (
                    <a href={stellarHrefWithSearch('/inbox', { view: 'waiting' })} className={`inline-flex shrink-0 items-center gap-2 self-start text-sm font-bold sm:self-auto ${accentText}`}>View waiting <ArrowRight className="h-4 w-4" /></a>
                  )}
                </div>
              </div>
            )}

            {inboxSummary && inboxSummary.actionCounts.actionRequired > 0 && (
              <div className="space-y-3">
                {intentAttention.map((intent) => {
                  const action = intentViewerActionPresentation(intent.viewerAction);
                  return (
                    <button key={`intent-${intent.id}`} type="button" onClick={() => openIntentDetails(intent)} className="group w-full rounded-2xl border border-violet-500/15 bg-white p-4 text-left transition hover:border-violet-500/35 dark:border-violet-400/15 dark:bg-white/[0.04] sm:p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2"><StatusBadge tone={action.tone}>{action.label}</StatusBadge><div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400"><NetworkBadge network={intent.network} /><span>{intentAuthorizationWindowLabel(intent)}</span></div></div>
                      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div className="min-w-0"><h2 className="text-lg font-bold leading-6">Soroban Intent</h2><p className="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{action.detail}</p><div className="mt-2 font-mono text-xs text-neutral-400">Created by {shortAddress(intent.creatorAddress)}</div></div><span className="inline-flex shrink-0 items-center gap-2 self-start text-sm font-bold text-violet-700 dark:text-violet-300 sm:self-auto">{action.cta} <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" /></span></div>
                    </button>
                  );
                })}
                {inboxSummary.requests.filter((request) => inboxViewerActionNeedsAction(request.viewerAction)).slice(0, requestAttentionLimit).map((request) => {
                  const description = describeInboxRequest(request);
                  const action = inboxViewerActionPresentation(request.viewerAction);
                  return (
                    <button key={request.id} type="button" onClick={() => openRequestDetails(request)} className="group w-full rounded-2xl border border-black/10 bg-white p-4 text-left transition hover:border-emerald-500/30 dark:border-white/10 dark:bg-white/[0.04] sm:p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <StatusBadge tone={action.tone}>{action.label}</StatusBadge>
                        <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                          <NetworkBadge network={request.network} />
                          <span>{inboxDeadlineLabel(description.inspection)}</span>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                        <div className="min-w-0">
                          <h2 className="text-lg font-bold leading-6">{description.title}</h2>
                          <p className="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{description.summary}</p>
                          <div className="mt-2 font-mono text-xs text-neutral-400">{shortAddress(description.source)}</div>
                        </div>
                        <span className={`inline-flex shrink-0 items-center gap-2 self-start text-sm font-bold sm:self-auto ${accentText}`}>{action.cta} <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" /></span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="mt-6 grid overflow-hidden rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-white/[0.04] md:grid-cols-3">
            <a href={stellarHref('/new')} className="group border-b border-black/10 p-5 transition hover:bg-black/[0.025] dark:border-white/10 dark:hover:bg-white/[0.04] md:border-b-0 md:border-r">
              <Plus className={`h-5 w-5 ${accentText}`} />
              <h2 className="mt-7 text-lg font-bold">New proposal</h2>
              <p className="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-300">Prepare an action, review the exact result, then collect approvals.</p>
              <div className={`mt-5 flex items-center gap-1.5 text-sm font-bold ${accentText}`}>Create proposal <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" /></div>
            </a>

            <a href={stellarHref('/treasury')} className="group border-b border-black/10 p-5 transition hover:bg-black/[0.025] dark:border-white/10 dark:hover:bg-white/[0.04] md:border-b-0 md:border-r">
              <Vault className={`h-5 w-5 ${accentText}`} />
              <h2 className="mt-7 text-lg font-bold">Treasuries</h2>
              <p className="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-300">See shared-control accounts you can authorize and manage.</p>
              <div className={`mt-5 flex items-center gap-1.5 text-sm font-bold ${accentText}`}>Open Treasuries <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" /></div>
            </a>

            <a href={stellarHref('/activity')} onClick={(event) => void openPrivateDestination(event, stellarHref('/activity'))} className="group hidden p-5 transition hover:bg-black/[0.025] dark:hover:bg-white/[0.04] sm:block">
              <History className={`h-5 w-5 ${accentText}`} />
              <h2 className="mt-7 text-lg font-bold">Activity</h2>
              <p className="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-300">Follow proposals you participated in and their final state.</p>
              <div className={`mt-5 flex items-center gap-1.5 text-sm font-bold ${accentText}`}>View Activity <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" /></div>
            </a>
          </section>
        </div>
      </main>
    </StellarWorkspaceShell>
  );
}
