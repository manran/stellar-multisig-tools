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
  if (actionCounts.readyForExecutionRouting > 0) parts.push(`${actionCounts.readyForExecutionRouting} ready to choose execution`);
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
            description="See what needs your action first, then start or continue work from the same workspace."
          />

          <section className="mt-8" aria-labelledby="dashboard-attention">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div id="dashboard-attention" className="text-sm font-bold">Needs your attention</div>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{inboxAttentionCopy(inboxSummary)}</p>
              </div>
              {inboxSummary && inboxSummary.pendingCount > 0 && (
                <a href={stellarHref('/inbox')} className={'shrink-0 text-sm font-bold ' + accentText}>Open Inbox</a>
              )}
            </div>

            {!inboxSummary && (
              <div className="mst-work-list mt-4">
                <a
                  href={stellarHref('/inbox')}
                  onClick={(event) => void openPrivateDestination(event, stellarHref('/inbox'))}
                  className="mst-work-row"
                >
                  <div>
                    <div className="mst-work-row__meta"><Inbox className="h-4 w-4" />Private workspace</div>
                    <div className="mst-work-row__title">Open your Inbox</div>
                    <p className="mst-work-row__copy">Confirm the current wallet to see proposals that need your signature, submission, or review.</p>
                  </div>
                  <span className={'mst-work-row__action ' + accentText}>{authBusy ? 'Confirm in wallet…' : 'Open Inbox'} <ArrowRight className="h-4 w-4" /></span>
                </a>
              </div>
            )}

            {inboxSummary && inboxSummary.actionCounts.actionRequired === 0 && (
              <div className="mst-work-list mt-4">
                <div className="mst-work-row">
                  <div>
                    <div className="mst-work-row__title">You're all caught up.</div>
                    <p className="mst-work-row__copy">{inboxAttentionCopy(inboxSummary)}</p>
                    {inboxSummary.actionCounts.waiting > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2" aria-label="Inbox action summary">
                        {inboxActionCountPresentations(inboxSummary.actionCounts).map((item) => (
                          <StatusBadge key={item.key} tone={item.tone}>{item.label}</StatusBadge>
                        ))}
                      </div>
                    )}
                  </div>
                  {inboxSummary.actionCounts.waiting > 0 && (
                    <a href={stellarHrefWithSearch('/inbox', { view: 'waiting' })} className={'mst-work-row__action ' + accentText}>View waiting <ArrowRight className="h-4 w-4" /></a>
                  )}
                </div>
              </div>
            )}

            {inboxSummary && inboxSummary.actionCounts.actionRequired > 0 && (
              <div className="mst-work-list mt-4">
                {intentAttention.map((intent) => {
                  const action = intentViewerActionPresentation(intent.viewerAction);
                  return (
                    <button key={'intent-' + intent.id} type="button" onClick={() => openIntentDetails(intent)} className="mst-work-row">
                      <div>
                        <div className="mst-work-row__meta">
                          <StatusBadge tone={action.tone}>{action.label}</StatusBadge>
                          <NetworkBadge network={intent.network} />
                          <span>{intentAuthorizationWindowLabel(intent)}</span>
                        </div>
                        <div className="mst-work-row__title">Contract authorization</div>
                        <p className="mst-work-row__copy">{action.detail}</p>
                        <div className="mt-2 font-mono text-xs text-neutral-400">Created by {intent.creatorAddress ? shortAddress(intent.creatorAddress) : (intent.creatorActor?.label ?? intent.creatorActor?.id ?? 'external service')}</div>
                      </div>
                      <span className="mst-work-row__action text-violet-700 dark:text-violet-300">{action.cta} <ArrowRight className="h-4 w-4" /></span>
                    </button>
                  );
                })}
                {inboxSummary.requests.filter((request) => inboxViewerActionNeedsAction(request.viewerAction)).slice(0, requestAttentionLimit).map((request) => {
                  const description = describeInboxRequest(request);
                  const action = inboxViewerActionPresentation(request.viewerAction);
                  return (
                    <button key={request.id} type="button" onClick={() => openRequestDetails(request)} className="mst-work-row">
                      <div>
                        <div className="mst-work-row__meta">
                          <StatusBadge tone={action.tone}>{action.label}</StatusBadge>
                          <NetworkBadge network={request.network} />
                          <span>{inboxDeadlineLabel(description.inspection)}</span>
                        </div>
                        <div className="mst-work-row__title">{description.title}</div>
                        <p className="mst-work-row__copy">{description.summary}</p>
                        <div className="mt-2 font-mono text-xs text-neutral-400">{shortAddress(description.source)}</div>
                      </div>
                      <span className={'mst-work-row__action ' + accentText}>{action.cta} <ArrowRight className="h-4 w-4" /></span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="mt-10" aria-labelledby="dashboard-start">
            <div id="dashboard-start" className="text-sm font-bold">Start or continue</div>
            <div className="mst-dashboard-shortcuts mt-3">
              <a href={stellarHref('/new')}><Plus className="h-4 w-4" />New proposal</a>
              <a href={stellarHref('/treasury')}><Vault className="h-4 w-4" />Treasuries</a>
              <a href={stellarHref('/activity')} onClick={(event) => void openPrivateDestination(event, stellarHref('/activity'))}><History className="h-4 w-4" />Activity</a>
            </div>
          </section>
        </div>
      </main>
    </StellarWorkspaceShell>
  );
}
