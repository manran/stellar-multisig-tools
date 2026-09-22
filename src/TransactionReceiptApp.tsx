import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, CircleAlert, Clock3, LoaderCircle, Printer, XCircle } from 'lucide-react';
import PortableEvidenceDocument from './PortableEvidenceDocument';
import PrivateNoteCard from './PrivateNoteCard';
import PrivateWorkspaceUnlock from './PrivateWorkspaceUnlock';
import { NetworkFact, WorkflowProgress } from './MultiSigUi';
import ReviewTransactionSummary from './ReviewTransactionSummary';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import TransactionAuthorizationResults from './TransactionAuthorizationResults';
import TransactionInspectorSummary from './TransactionInspectorSummary';
import { useAddressBook } from './AddressBookContext';
import { useStellarWallet } from './StellarWalletContext';
import type { ActivityFactEvent, ActivityRequestItem } from '../packages/stellar-core/src/activityTypes';
import { buildPortableEvidenceRecord } from './stellar/portableEvidence';
import { privateSessionAddressHeaders } from '../packages/stellar-core/src/privateSessionTransport';
import type { CreateSigningRequestResponse, SigningRequestSnapshot } from '../packages/stellar-core/src/requestTypes';
import { projectTransactionReviewAuthorizationStatus } from '../packages/stellar-core/src/transactionReviewAnalysis';
import { analyzeAccountAuthorization } from '../packages/stellar-core/src/authorization';
import { humanAuthorizationRequirement } from './stellar/authorizationPresentation';
import type { SourceAnalysis } from '../packages/stellar-core/src/transactionReviewAnalysis';
import { analyzeTransactionAuthorization } from '../packages/stellar-core/src/transactionAuthorization';
import { inspectTransactionXdr } from '../packages/stellar-core/src/transactionXdr';
import type { TransactionXdrInspection } from '../packages/stellar-core/src/transactionXdr';
import type { StellarNetwork } from '../packages/stellar-core/src/types';
import { cachedTreasuryNames, loadSharedTreasuryNames } from './treasuryMetadataCache';
import { treasuryDisplayLabel } from './treasuryDisplay';
import { treasuryActivityHref, treasuryOverviewHref } from './treasuryNavigation';
import { isCurrentWorkspaceNavigationState, stellarHref } from './workspaceNavigation';

function shortAddress(value: string) { return value.length <= 22 ? value : `${value.slice(0, 10)}…${value.slice(-8)}`; }
function displayRequestId(id: string) { return id.match(/.{1,4}/g)?.join('-') ?? id; }
function eventTitle(event: ActivityFactEvent, labelFor: (address: string) => string) {
  const actor = event.actorAddress ? labelFor(event.actorAddress) : '';
  switch (event.type) {
    case 'request_created': return actor ? `${actor} created the proposal` : 'Proposal created';
    case 'private_note_added': return actor ? `${actor} added the Private Note` : 'Private Note attached';
    case 'private_note_revised': return actor ? `${actor} revised the Private Note` : 'Legacy Private Note revision';
    case 'private_commitment_created': return 'Private commitment attached';
    case 'approval_added': return actor ? `${actor} signed` : 'Signature added · signer not recorded';
    case 'approval_declined': return actor ? `${actor} declined` : 'Proposal declined · signer not recorded';
    case 'transaction_submitted': return actor ? `${actor} submitted to Stellar` : 'Submitted to Stellar';
    case 'transaction_confirmed': return event.ledger ? `System confirmed · Ledger ${event.ledger.toLocaleString()}` : 'System confirmed on Stellar';
  }
}

export default function TransactionReceiptApp() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const requestId = params.get('request')?.trim() ?? '';
  const accountId = params.get('account')?.trim() ?? '';
  const routeNetwork = params.get('network');
  const requestedNetwork: StellarNetwork | null = routeNetwork === 'public' || routeNetwork === 'testnet' ? routeNetwork : null;
  const { address, network: connectedNetwork, networkSource, privateUnlocked, unlockedAddress, unlockedNetwork } = useStellarWallet();
  const network = networkSource === 'application' && requestedNetwork ? requestedNetwork : connectedNetwork;
  const { labelFor } = useAddressBook();
  const privateReady = Boolean(privateUnlocked && address && network && unlockedAddress === address && unlockedNetwork === network);
  const networkMismatch = Boolean(requestedNetwork && connectedNetwork && networkSource === 'wallet' && requestedNetwork !== connectedNetwork);
  const [snapshot, setSnapshot] = useState<SigningRequestSnapshot | null>(null);
  const [activity, setActivity] = useState<ActivityRequestItem | null>(null);
  const [inspection, setInspection] = useState<TransactionXdrInspection | null>(null);
  const [sourceAnalyses, setSourceAnalyses] = useState<SourceAnalysis[]>([]);
  const [context, setContext] = useState<CreateSigningRequestResponse['context']>();
  const navigationReturnTarget = useMemo(() => {
    const state = window.history.state as { returnTo?: string; returnLabel?: string } | null;
    if (!isCurrentWorkspaceNavigationState(state) || !state?.returnTo) return null;
    try {
      const target = new URL(state.returnTo);
      return target.origin === window.location.origin ? { href: target.toString(), label: state.returnLabel?.trim() || 'Back' } : null;
    } catch {
      return null;
    }
  }, []);
  const [treasuryNames, setTreasuryNames] = useState<Record<string, string>>(() =>
    accountId && requestedNetwork ? cachedTreasuryNames(sessionStorage, requestedNetwork, [accountId]) : {},
  );
  const treasuryName = accountId ? treasuryNames[accountId] || '' : '';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.documentElement.classList.add('stellar-transaction-evidence');
    return () => document.documentElement.classList.remove('stellar-transaction-evidence');
  }, []);


  useEffect(() => {
    if (networkMismatch || !requestId) return;
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void (async () => {
      const headers = new Headers({ 'X-MultiSig-Request-Id': requestId });
      if (privateReady && address) {
        for (const [name, value] of Object.entries(privateSessionAddressHeaders(address))) headers.set(name, value);
      }
      const requestUrl = new URL('/api/request', window.location.origin);
      requestUrl.searchParams.set('view', 'history');
      if (accountId) requestUrl.searchParams.set('account', accountId);
      const requestResponse = await fetch(requestUrl, { cache: 'no-store', signal: controller.signal, headers });
      const requestBody = await requestResponse.json() as CreateSigningRequestResponse & { error?: string; code?: string };
      if (!requestResponse.ok) {
        if (requestBody.code === 'history_access_denied') return;
        throw new Error(requestBody.error || 'Unable to load transaction receipt.');
      }
      if (!requestBody.history) throw new Error('Transaction receipt projection is unavailable.');
      const parsed = inspectTransactionXdr(requestBody.request.mergedXdr, requestBody.request.network);
      if (cancelled) return;
      setSnapshot(requestBody.request); setContext(requestBody.context); setActivity(requestBody.history.activity); setInspection(parsed); setSourceAnalyses(requestBody.history.sourceAnalyses);
      const sourceAccountIds = requestBody.history.sourceAnalyses.flatMap((item) => item.account ? [item.account.accountId] : []);
      const sharedNameAccountIds = [...new Set([accountId, ...sourceAccountIds].filter(Boolean))];
      if (privateReady && address && sharedNameAccountIds.length > 0) {
        setTreasuryNames(cachedTreasuryNames(sessionStorage, requestBody.request.network, sharedNameAccountIds));
        void loadSharedTreasuryNames(sharedNameAccountIds, requestBody.request.network, address, controller.signal)
          .then((names) => { if (!cancelled) setTreasuryNames(names); })
          .catch(() => undefined);
      }
    })().catch((cause) => {
      if (!cancelled && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load transaction receipt.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [privateReady, address, network, requestId, accountId, networkMismatch]);

  const authorization = useMemo(() => snapshot && inspection ? analyzeTransactionAuthorization(snapshot.mergedXdr, snapshot.network, inspection, sourceAnalyses) : null, [snapshot, inspection, sourceAnalyses]);
  const authorizationStatus = projectTransactionReviewAuthorizationStatus(authorization);
  const portableEvidence = useMemo(() => snapshot && activity && inspection
    ? buildPortableEvidenceRecord({ snapshot, activity, inspection, sourceAnalyses })
    : null, [snapshot, activity, inspection, sourceAnalyses]);
  const approvalActors = new Set(activity?.events.filter((event) => event.type === 'approval_added' && event.actorAddress).map((event) => event.actorAddress!) ?? []);
  const declinedActors = new Set(activity?.events.filter((event) => event.type === 'approval_declined' && event.actorAddress).map((event) => event.actorAddress!) ?? []);
  const primarySource = sourceAnalyses.find((item) => item.accountId === inspection?.transactionSourceAccount)?.account;
  const sourceAccounts = sourceAnalyses.flatMap((item) => item.account ? [item.account] : []);
  const sourceAccountIds = new Set(sourceAccounts.map((account) => account.accountId));
  const accountResourceLabel = (value: string) => treasuryDisplayLabel(
    treasuryNames[value] || '',
    labelFor(value, 'account'),
  );
  const sharedAccountLabel = (value: string) => treasuryNames[value] || '';
  const signerLabel = (value: string) => value === address
    ? 'You'
    : sourceAccountIds.has(value)
      ? `${sharedAccountLabel(value) || shortAddress(value)} · account key`
      : labelFor(value, 'signer') || shortAddress(value);
  const fallbackBackHref = accountId && snapshot ? treasuryActivityHref(accountId, snapshot.network) : stellarHref('/activity');
  const fallbackBackLabel = accountId ? `Treasury / ${treasuryName || shortAddress(accountId)} / Activity` : 'Activity';
  const backHref = navigationReturnTarget?.href ?? fallbackBackHref;
  const backLabel = navigationReturnTarget?.label ?? fallbackBackLabel;

  return <StellarWorkspaceShell active="activity" networkContext={snapshot?.network ?? requestedNetwork ?? network}>
    <main className="transaction-evidence-page px-4 py-7 sm:px-6 lg:px-8 lg:py-8"><div className="mx-auto max-w-5xl">
      <div className="transaction-evidence-screen-controls">
        <a href={backHref} className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-600 hover:text-black dark:text-neutral-300 dark:hover:text-white"><ArrowLeft className="h-4 w-4" />{backLabel}</a>
      </div>
      {snapshot && <div className="transaction-evidence-screen-only mb-6"><WorkflowProgress current="done" /></div>}
      <div className="transaction-evidence-human-heading transaction-evidence-heading mt-5 flex flex-wrap items-end justify-between gap-4 border-b border-black/10 pb-5 dark:border-white/10">
        <div><h1 className="text-3xl font-bold tracking-tight">Transaction receipt</h1><p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Human-readable receipt with your authorized workspace context.</p></div>
        {snapshot && <div className="transaction-evidence-screen-controls">
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-black/5 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"><Printer className="h-4 w-4" />Export evidence PDF</button>
        </div>}
      </div>
      {networkMismatch && <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">This link is for {requestedNetwork === 'testnet' ? 'Testnet' : 'Mainnet'}, but the connected wallet is using {connectedNetwork === 'testnet' ? 'Testnet' : 'Mainnet'}.</div>}
      {!privateReady && !networkMismatch && !snapshot && !loading && <PrivateWorkspaceUnlock title="Confirm your wallet" description="Use this wallet to open private transaction history. This does not sign or submit anything." buttonLabel="Open transaction" />}
      {loading && <div className="mt-8 flex items-center gap-2 text-sm text-neutral-500"><LoaderCircle className="h-4 w-4 animate-spin" />Loading transaction history…</div>}
      {error && <div className="mt-5 flex gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
      {snapshot && inspection && activity && <><div className="transaction-evidence-human-document transaction-evidence-content mt-6 space-y-4">
        <section className="transaction-evidence-record overflow-hidden rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-white/[0.035]">
          <div className="transaction-evidence-record-status grid gap-4 border-b border-black/10 px-5 py-4 dark:border-white/10 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">{snapshot.submission ? 'Finalized record' : 'Record status'}</div>
              <div className="mt-1.5 flex items-center gap-2 text-xl font-bold tracking-tight">{snapshot.submission ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Clock3 className="h-5 w-5 text-amber-500" />}{snapshot.submission ? 'Confirmed on Stellar' : snapshot.status.replaceAll('_', ' ')}</div>
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:justify-end">
              <NetworkFact network={snapshot.network} long />
              <div className="border-l border-black/10 pl-3 text-right dark:border-white/10"><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">Proposal ID</div><div className="mt-0.5 font-mono text-xs font-semibold">{displayRequestId(snapshot.id)}</div></div>
            </div>
          </div>
          <dl className="transaction-evidence-record-grid grid text-sm sm:grid-cols-3 sm:divide-x sm:divide-black/10 dark:sm:divide-white/10">
            {snapshot.submission ? <>
              <div className="border-b border-black/10 px-5 py-3.5 dark:border-white/10 sm:border-b-0"><dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">Ledger</dt><dd className="mt-1 font-mono text-base font-bold tabular-nums">{snapshot.submission.ledger.toLocaleString()}</dd></div>
              <div className="border-b border-black/10 px-5 py-3.5 dark:border-white/10 sm:border-b-0"><dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">Submitted</dt><dd className="mt-1 tabular-nums">{new Date(snapshot.submission.submittedAt).toLocaleString()}</dd></div>
              <div className="px-5 py-3.5"><dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">Created</dt><dd className="mt-1 tabular-nums">{new Date(snapshot.createdAt).toLocaleString()}</dd></div>
            </> : <>
              <div className="border-b border-black/10 px-5 py-3.5 dark:border-white/10 sm:border-b-0"><dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">Created</dt><dd className="mt-1 tabular-nums">{new Date(snapshot.createdAt).toLocaleString()}</dd></div>
              <div className="border-b border-black/10 px-5 py-3.5 dark:border-white/10 sm:border-b-0"><dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">Expires</dt><dd className="mt-1 tabular-nums">{new Date(snapshot.expiresAt).toLocaleString()}</dd></div>
              <div className="px-5 py-3.5"><dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">Signatures</dt><dd className="mt-1 font-semibold tabular-nums">{snapshot.signatureCount} collected</dd></div>
            </>}
          </dl>
          <div className="transaction-evidence-record-hash border-t border-black/10 px-5 py-3.5 dark:border-white/10"><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">Transaction hash</div><div className="mt-1 break-all font-mono text-[11px] leading-5 text-neutral-600 dark:text-neutral-300">{snapshot.transactionHash}</div></div>
        </section>
        <ReviewTransactionSummary inspection={inspection} xdr={snapshot.mergedXdr} sourceAccount={primarySource ?? null} privateCommitment={context?.privateCommitment} mode="history" />
        <section className="transaction-evidence-signatures rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/[0.035] sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div><div className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">Signatures collected</div><h2 className="mt-1 text-2xl font-bold">{snapshot.signatureCount} signature{snapshot.signatureCount === 1 ? '' : 's'}</h2></div>
            {sourceAccounts.length > 1 && <div className="transaction-evidence-print-hide text-sm font-semibold text-neutral-500">{sourceAccounts.length} accounts involved</div>}
          </div>
          <div className="mt-5 space-y-5">
            {sourceAccounts.map((sourceAccount) => {
              const sourceLabel = accountResourceLabel(sourceAccount.accountId);
              const sourceSharedLabel = sharedAccountLabel(sourceAccount.accountId);
              const sourceSigners = sourceAccount.signers.filter((signer) => signer.type === 'ed25519_public_key' && signer.weight > 0);
              const sourceAuthorization = analyzeAccountAuthorization(sourceAccount);
              return (
                <div key={sourceAccount.accountId} className="transaction-evidence-signature-account border-t border-black/10 pt-4 first:border-t-0 first:pt-0 dark:border-white/10">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0"><div className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">Account</div>{sourceLabel && <div className="mt-1 font-semibold">{sourceLabel}</div>}<div className="mt-1 break-all font-mono text-[11px] leading-5 text-neutral-500 dark:text-neutral-400">{sourceAccount.accountId}</div></div>
                    <div className="transaction-evidence-print-hide max-w-sm text-right text-xs font-semibold leading-5 text-neutral-500">Standard · {humanAuthorizationRequirement(sourceAuthorization.thresholds.medium)}<br />Control · {humanAuthorizationRequirement(sourceAuthorization.thresholds.high)}</div>
                  </div>
                  <div className="transaction-evidence-signature-grid mt-3 overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
                    {sourceSigners.map((signer) => {
                      const approved = approvalActors.has(signer.key);
                      const declined = declinedActors.has(signer.key);
                      const isAccountKey = signer.key === sourceAccount.accountId;
                      const alias = isAccountKey ? sourceSharedLabel : labelFor(signer.key, 'signer');
                      return <div key={`${sourceAccount.accountId}:${signer.key}`} className="transaction-evidence-signature-card grid gap-2 border-b border-black/10 px-3.5 py-3 last:border-b-0 dark:border-white/10 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><div className="flex items-center gap-2">{approved ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : declined ? <XCircle className="h-4 w-4 shrink-0 text-red-500" /> : <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-neutral-300 dark:bg-neutral-600" />}{alias && <div className="transaction-evidence-human-label font-semibold">{alias}</div>}</div><div className="mt-1.5 break-all font-mono text-[11px] leading-5 text-neutral-500 dark:text-neutral-400">{signer.key}</div></div><div className="text-xs font-semibold text-neutral-500 sm:text-right">{isAccountKey ? 'Account key · ' : ''}{approved ? 'Signed' : declined ? 'Declined' : 'No recorded decision'}{signer.weight !== 1 ? <><br /><span className="font-normal">{`approval power ${signer.weight}`}</span></> : null}</div></div>;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        {context?.privateNote && <div className="space-y-2"><div className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">Private off-chain context · visible only in this authorized receipt · never included in the evidence PDF.</div><PrivateNoteCard note={context.privateNote} busy={false} locked allowConceal={false} /></div>}
        <section className="transaction-evidence-history rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/[0.035] sm:p-6"><div className="flex items-baseline justify-between gap-3"><div className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">History</div><div className="transaction-evidence-print-hide text-xs tabular-nums text-neutral-400">{activity.events.length} events</div></div><div className="mt-3 divide-y divide-black/10 border-y border-black/10 dark:divide-white/10 dark:border-white/10">{activity.events.map((event) => <div key={event.eventId} className="transaction-evidence-history-row grid grid-cols-[12px_minmax(0,1fr)] gap-3 py-3"><div className={`mt-1.5 h-2.5 w-2.5 rounded-full ${event.type === 'approval_declined' ? 'bg-red-500' : event.type === 'approval_added' || event.type === 'transaction_confirmed' ? 'bg-emerald-500' : 'bg-neutral-400'}`} /><div><div className="transaction-evidence-history-line grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3"><div className="text-sm font-semibold">{eventTitle(event, signerLabel)}</div><time className="whitespace-nowrap text-right text-xs tabular-nums text-neutral-400">{new Date(event.occurredAt).toLocaleString()}</time></div>{event.actorAddress && <div className="transaction-evidence-history-actor mt-1 break-all font-mono text-[10px] leading-4 text-neutral-400">{event.actorAddress}</div>}{event.detail && <p className="mt-1 text-xs leading-5 text-neutral-500">{event.detail}</p>}</div></div>)}</div></section>
        <div className="transaction-evidence-print-authorization"><TransactionAuthorizationResults inspection={inspection} authorization={authorization} sourceAnalyses={sourceAnalyses} /></div>
        <details className="transaction-evidence-advanced group rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5 sm:p-6"><summary className="cursor-pointer list-none text-sm font-semibold">Advanced <span className="ml-2 font-normal text-neutral-400">XDR · transaction fields · Core authorization</span></summary><div className="mt-5 space-y-6 border-t border-black/10 pt-5 dark:border-white/10"><div className="rounded-xl bg-black/[0.035] p-4 text-xs dark:bg-white/[0.04]"><div><span className="font-semibold">Request id:</span> <span className="font-mono">{displayRequestId(snapshot.id)}</span></div>{snapshot.sorobanOrigin && <div className="mt-2"><span className="font-semibold">Soroban origin:</span> Intent <span className="font-mono">{displayRequestId(snapshot.sorobanOrigin.intentId)}</span> · plan revision {snapshot.sorobanOrigin.authorizationPlanRevision} · prepared {new Date(snapshot.sorobanOrigin.executionPreparedAt).toLocaleString()}</div>}<div className="mt-2 break-all font-mono opacity-60">{snapshot.transactionHash}</div><div className="mt-2">{snapshot.submission ? `Submitted ${new Date(snapshot.submission.submittedAt).toLocaleString()} · Ledger ${snapshot.submission.ledger.toLocaleString()}` : `Expires ${new Date(snapshot.expiresAt).toLocaleString()}`}</div></div><TransactionInspectorSummary inspection={inspection} status={authorizationStatus} /><TransactionAuthorizationResults inspection={inspection} authorization={authorization} sourceAnalyses={sourceAnalyses} /></div></details>
        {accountId && snapshot && <div className="transaction-evidence-screen-controls text-sm"><a href={treasuryOverviewHref(accountId, snapshot.network)} className="font-semibold text-emerald-700 dark:text-emerald-300">Open Treasury overview</a></div>}
      </div>{portableEvidence && <PortableEvidenceDocument record={portableEvidence} inspection={inspection} />}</>}
    </div></main>
  </StellarWorkspaceShell>;
}
