import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import { ArrowRight, Fingerprint, History, Inbox, Plus, Vault } from 'lucide-react';
import { NetworkBadge, PageHeader, StatusBadge } from './MultiSigUi';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useStellarWallet } from './StellarWalletContext';
import { useUserIdentity } from './UserIdentityContext';
import { privateSessionAddressHeaders } from '../../../packages/stellar-core/src/privateSessionTransport';
import { isWalletUserRejected } from './stellar/walletKit';
import { inboxActionCountPresentations, inboxViewerActionNeedsAction, inboxViewerActionPresentation } from '../../../packages/stellar-core/src/inboxPresentation';
import type { InboxActionCounts, InboxRequestSnapshot } from '../../../packages/stellar-core/src/inboxPresentation';
import { describeInboxRequest, inboxDeadlineLabel } from './stellar/inboxRequestPresentation';
import { inboxHasFailedSignerEmail } from './stellar/inboxSenderProgress';
import { intentAuthorizationWindowLabel, intentViewerActionNeedsAction, intentViewerActionPresentation } from './stellar/sorobanIntentPresentation';
import type { InboxSorobanIntentSnapshot } from '../../../packages/stellar-core/src/sorobanIntentApiTypes';
import type { StellarNetwork } from '../../../packages/stellar-core/src/types';
import { navigateWorkspace, stellarHref, stellarHrefWithSearch } from './workspaceNavigation';

interface InboxCountResponse {
  address?: string | null;
  userId?: string;
  network?: StellarNetwork;
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

function inboxAttentionCopy(summary: DashboardInboxSummary | null, emailAttentionCount = 0) {
  if (!summary) return 'See proposals that need your signature, submission, or review.';
  const { pendingCount, actionCounts } = summary;
  if (actionCounts.actionRequired === 0 && emailAttentionCount === 0) {
    if (pendingCount === 0) return 'No open proposals need your action right now.';
    return `${pendingCount} open ${pendingCount === 1 ? 'proposal is' : 'proposals are'} waiting on other signers or ledger conditions.`;
  }
  const parts: string[] = [];
  if (emailAttentionCount > 0) parts.push(`${emailAttentionCount} signer email${emailAttentionCount === 1 ? '' : 's'} need${emailAttentionCount === 1 ? 's' : ''} follow-up`);
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
    unlockedAddress,
    unlockedNetwork,
    authBusy,
    unlock,
  } = useStellarWallet();
  const { identity } = useUserIdentity();
  const viewerAddress = identity?.address && privateUnlocked
    && unlockedNetwork === identity.network && unlockedAddress === identity.address ? identity.address : '';
  const owner = identity ? `${identity.network}:${identity.userId}:${identity.method}:${viewerAddress}` : '';
  const [loadedInbox, setLoadedInbox] = useState<{ owner: string; summary: DashboardInboxSummary } | null>(null);
  // Never render a previous wallet's private Inbox summary, even briefly.
  const inboxSummary = owner && loadedInbox?.owner === owner ? loadedInbox.summary : null;

  useEffect(() => {
    if (!owner || !identity) {
      setLoadedInbox(null);
      return;
    }
    const controller = new AbortController();
    void fetch('/api/inbox', { cache: 'no-store', signal: controller.signal,
      headers: viewerAddress ? privateSessionAddressHeaders(viewerAddress) : {} })
      .then(async (response) => {
        if (!response.ok) return null;
        return await response.json() as InboxCountResponse;
      })
      .then((body) => {
        if (controller.signal.aborted) return;
        if (
          body?.userId === identity.userId && body.network === identity.network
          && body.address === (viewerAddress || null)
          && typeof body.pending_count === 'number'
          && body.action_counts
          && typeof body.action_counts.actionRequired === 'number'
          && Array.isArray(body.requests)
        ) {
          setLoadedInbox({ owner, summary: {
            pendingCount: body.pending_count,
            actionCounts: body.action_counts,
            requests: body.requests,
            intents: Array.isArray(body.intents) ? body.intents : [],
          } });
        } else setLoadedInbox(null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadedInbox(null);
      });
    return () => controller.abort();
  }, [owner, viewerAddress, identity]);

  const failedEmails = useMemo(() => new Set(
    (inboxSummary?.requests ?? [])
      .filter((request) => inboxHasFailedSignerEmail(request, viewerAddress))
      .map((request) => request.id),
  ), [inboxSummary, viewerAddress]);
  const actionRequired = (inboxSummary?.actionCounts.actionRequired ?? 0) +
    (inboxSummary?.requests ?? []).filter((request) =>
      failedEmails.has(request.id) && !inboxViewerActionNeedsAction(request.viewerAction)).length;

  async function openPrivateDestination(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (identity || privateUnlocked) return;
    event.preventDefault();
    if (authBusy) return;
    try {
      await unlock();
      window.location.assign(href);
    } catch (cause) {
      if (!isWalletUserRejected(cause)) window.location.assign(href);
    }
  }

  function openRequestDetails(request: InboxRequestSnapshot, focusSignerFollowup = false) {
    navigateWorkspace('/request', {
      hash: request.id,
      state: {
        requestPreview: request,
        focusSignerFollowup,
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

  const testnet = identity?.network === 'testnet' || sessionNetwork === 'testnet';
  const accentText = testnet ? 'text-sky-700 dark:text-sky-300' : 'text-emerald-700 dark:text-emerald-300';
  const primaryBg = testnet ? 'bg-sky-700 hover:bg-sky-800' : 'bg-emerald-700 hover:bg-emerald-800';

  return (
    <StellarWorkspaceShell active="dashboard">
      <main className="mst-workbench-page">
        <div className="mx-auto max-w-6xl">
          <PageHeader
            eyebrow={<span className={accentText}>{testnet ? 'Testnet workspace' : 'Your workspace'}</span>}
            title="Overview"
            description="Your current work, in one place."
          />

          <section className="mt-8" aria-labelledby="dashboard-attention">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div id="dashboard-attention" className="text-sm font-bold">Needs your attention</div>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{inboxAttentionCopy(inboxSummary, failedEmails.size)}</p>
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
                    <p className="mst-work-row__copy">Use Passkey or a verified Stellar wallet to see your proposals and approvals.</p>
                  </div>
                  <span className={'mst-work-row__action ' + accentText}>{authBusy ? 'Confirm in wallet…' : 'Open Inbox'} <ArrowRight className="h-4 w-4" /></span>
                </a>
              </div>
            )}

            {inboxSummary && actionRequired === 0 && (
              <div className="mst-work-list mt-4">
                <div className="mst-work-row">
                  <div>
                    <div className="mst-work-row__title">{inboxSummary.pendingCount > 0 ? 'Waiting on others' : "You're all caught up."}</div>
                    <p className="mst-work-row__copy">{inboxSummary.pendingCount > 0 ? 'Nothing needs your action right now. Review the signing progress in Inbox.' : 'Start a new proposal or review completed activity.'}</p>
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

            {inboxSummary && actionRequired > 0 && (
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
                {inboxSummary.requests.filter((request) =>
                  inboxViewerActionNeedsAction(request.viewerAction) || failedEmails.has(request.id))
                  .slice(0, requestAttentionLimit).map((request) => {
                  const description = describeInboxRequest(request);
                  const action = inboxViewerActionPresentation(request.viewerAction);
                  const failedEmail = failedEmails.has(request.id);
                  const urgentEmailFailure = failedEmail && !inboxViewerActionNeedsAction(request.viewerAction);
                  return (
                    <button key={request.id} type="button" onClick={() => openRequestDetails(request, failedEmail)} className="mst-work-row">
                      <div>
                        <div className="mst-work-row__meta">
                          <StatusBadge tone={urgentEmailFailure ? 'danger' : action.tone}>{urgentEmailFailure ? 'Follow-up needed' : action.label}</StatusBadge>
                          <NetworkBadge network={request.network} />
                          <span>{inboxDeadlineLabel(description.inspection)}</span>
                        </div>
                        <div className="mst-work-row__title">{description.title}</div>
                        <p className="mst-work-row__copy">{description.summary}</p>
                        <div className="mt-2 font-mono text-xs text-neutral-400">{shortAddress(description.source)}</div>
                      </div>
                      <span className={'mst-work-row__action ' + accentText}>{failedEmail ? 'Follow up' : action.cta} <ArrowRight className="h-4 w-4" /></span>
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
              <a href={stellarHref('/identity')}><Fingerprint className="h-4 w-4" />Your account</a>
            </div>
          </section>
        </div>
      </main>
    </StellarWorkspaceShell>
  );
}
