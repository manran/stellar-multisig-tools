import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, ClipboardCopy, KeyRound, LoaderCircle, RefreshCw, Share2 } from 'lucide-react';
import { xdr } from '@stellar/stellar-sdk/base';
import { ActionButton, NetworkFact, PageHeader, StatusBadge, WorkflowProgress } from './MultiSigUi';
import SorobanEffectsDiffView from './SorobanEffectsDiffView';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useStellarWallet } from './StellarWalletContext';
import {
  sorobanAuthorizationEntryPreimageXdr,
} from './stellar/sorobanAuthorization';
import type {
  SorobanIntentAuthorizationSnapshot,
  SorobanIntentContributionResponse,
  SorobanIntentExecutionResponse,
  SorobanIntentReplanResponse,
  SorobanIntentResponse,
  StoredSorobanIntentSnapshot,
} from './stellar/sorobanIntentApiTypes';
import { inspectSorobanAuthorizationEntry, type SorobanInvocationInspection } from './stellar/sorobanInspection';
import type { SorobanEffectsDiff, SorobanEffectsSnapshot } from './stellar/sorobanEffects';
import { isValidStellarAccountId } from './stellar/horizon';
import { sorobanExecutionRoutes, type SorobanExecutionRoute } from './stellar/executionPolicy';
import { sorobanAuthorizationStatusPresentation, sorobanIntentWorkflowStage } from './stellar/humanWorkflow';
import { privateSessionAddressHeaders } from './stellar/privateSessionTransport';
import { writeReviewHandoff } from './stellar/reviewHandoff';
import { navigateWorkspace, stellarHref } from './workspaceNavigation';

const POLL_INTERVAL_MS = 15_000;

interface ApiError {
  error?: string;
  code?: string;
  details?: { effectsDiff?: SorobanEffectsDiff };
}

class IntentApiError extends Error {
  constructor(message: string, readonly code?: string, readonly details?: ApiError['details']) {
    super(message);
    this.name = 'IntentApiError';
  }
}

function intentIdFromHash() {
  const value = window.location.hash.slice(1).trim().toUpperCase();
  return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(value) ? value : '';
}

function compactAddress(address: string) {
  return address.length <= 22 ? address : `${address.slice(0, 8)}…${address.slice(-8)}`;
}

async function apiJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T | ApiError;
  if (!response.ok) {
    const error = body as ApiError;
    throw new IntentApiError(error.error || `MultiSigTools returned HTTP ${response.status}.`, error.code, error.details);
  }
  return body as T;
}

function InvocationTree({ node, depth = 0 }: { node: SorobanInvocationInspection; depth?: number }) {
  return <div className={depth ? 'ml-4 border-l border-black/10 pl-4 dark:border-white/10' : ''}>
    <div className="rounded-xl bg-black/[0.03] p-4 text-sm dark:bg-white/[0.04]">
      <div className="font-semibold">{node.label}</div>
      {node.detail && <div className="mt-1 break-all font-mono text-xs text-neutral-500">{node.detail}</div>}
      {node.argumentPreviews.length > 0 && <div className="mt-2 text-xs text-neutral-500">{node.argumentPreviews.join(' · ')}</div>}
    </div>
    {node.children.length > 0 && <div className="mt-2 space-y-2">{node.children.map((child, index) => <InvocationTree key={`${child.label}-${depth}-${index}`} node={child} depth={depth + 1} />)}</div>}
  </div>;
}

function SimulationEffectsView({ effects }: { effects?: SorobanEffectsSnapshot }) {
  if (!effects) return <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">This legacy Intent has no recorded simulation-effects baseline. Do not execute it without refreshing authorization.</div>;
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2 text-xs text-neutral-500"><span>{effects.stateChangeCount} state changes</span><span>·</span><span>{effects.eventCount} successful events</span><span>·</span><span className="font-mono">{effects.digest.slice(0, 12)}…</span></div>
    {effects.stateChanges.map((change, index) => <div key={`state-${change.keyPreview}-${index}`} className="rounded-xl bg-black/[0.03] p-3 text-sm dark:bg-white/[0.04]"><div className="font-semibold">{change.kind} · {change.keyPreview}</div><div className="mt-1 break-words text-xs text-neutral-500">{change.beforePreview ?? '∅'} → {change.afterPreview ?? '∅'}</div></div>)}
    {effects.events.map((event, index) => <div key={`event-${event.contractId ?? 'system'}-${index}`} className="rounded-xl bg-black/[0.03] p-3 text-sm dark:bg-white/[0.04]"><div className="font-semibold">{event.type} event{event.contractId ? ` · ${compactAddress(event.contractId)}` : ''}</div><div className="mt-1 text-xs text-neutral-500">{event.topics.join(' · ') || 'No topics'}</div><div className="mt-1 break-words font-mono text-xs text-neutral-500">{event.data}</div></div>)}
    {effects.truncated && <div className="text-xs text-amber-700 dark:text-amber-300">Preview is truncated. The security digest still covers the complete simulation result.</div>}
  </div>;
}


export default function SorobanIntentApp() {
  const intentId = useMemo(intentIdFromHash, []);
  const wallet = useStellarWallet();
  const [intent, setIntent] = useState<StoredSorobanIntentSnapshot | null>(null);
  const [authorization, setAuthorization] = useState<SorobanIntentAuthorizationSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [executionSource, setExecutionSource] = useState('');
  const [executionDiff, setExecutionDiff] = useState<SorobanEffectsDiff | null>(null);
  const [pendingExecution, setPendingExecution] = useState<SorobanIntentExecutionResponse | null>(null);
  const [pendingExecutionRoute, setPendingExecutionRoute] = useState<SorobanExecutionRoute | null>(null);
  const [executionRoute, setExecutionRoute] = useState<SorobanExecutionRoute>('current_client');
  const [executionCopied, setExecutionCopied] = useState(false);
  const initialLoadKey = useRef('');

  const sessionAddress = wallet.privateUnlocked ? wallet.unlockedAddress : '';
  const invocationFacts = useMemo(() => {
    if (!authorization) return [];
    return authorization.authorizationEntriesXdr.flatMap((value, index) => {
      try {
        const entry = xdr.SorobanAuthorizationEntry.fromXdr(value, 'base64');
        const inspected = inspectSorobanAuthorizationEntry(entry, index);
        return inspected.invocation ? [inspected.invocation] : [];
      } catch {
        return [];
      }
    });
  }, [authorization]);

  async function loadIntent(address = sessionAddress, quiet = false) {
    if (!intentId || !address) return;
    if (!quiet) setLoading(true);
    if (!quiet) setError('');
    try {
      const response = await fetch('/api/intent', {
        cache: 'no-store',
        headers: {
          'X-MultiSig-Intent-Id': intentId,
          ...privateSessionAddressHeaders(address),
        },
      });
      const body = await apiJson<SorobanIntentResponse>(response);
      setIntent(body.intent);
      setAuthorization(body.authorization);
      if (!quiet) { setExecutionDiff(null); setPendingExecution(null); setPendingExecutionRoute(null); setExecutionCopied(false); }
      if (!executionSource && isValidStellarAccountId(address)) setExecutionSource(address);
    } catch (cause) {
      if (!quiet) setError(cause instanceof Error ? cause.message : 'Unable to load this Soroban Intent.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  async function confirmSigner() {
    setBusy(true);
    setError('');
    try {
      if (!wallet.address) await wallet.connect();
      const address = wallet.privateUnlocked && wallet.unlockedNetwork === intent?.network
        ? wallet.unlockedAddress
        : await wallet.unlock(undefined, intent?.network);
      await loadIntent(address);
      return address;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to confirm this signer wallet.');
      return '';
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!intentId || !wallet.privateUnlocked || !wallet.unlockedAddress) return;
    const key = `${intentId}:${wallet.unlockedAddress}`;
    if (initialLoadKey.current === key) return;
    initialLoadKey.current = key;
    void loadIntent(wallet.unlockedAddress);
  }, [intentId, wallet.privateUnlocked, wallet.unlockedAddress]);

  useEffect(() => {
    if (!intent || !wallet.privateUnlocked || !wallet.unlockedAddress) return;
    const timer = window.setInterval(() => void loadIntent(wallet.unlockedAddress, true), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [intent?.id, wallet.privateUnlocked, wallet.unlockedAddress]);

  const targetsForSigner = useMemo(() => {
    if (!authorization || !sessionAddress) return [];
    return authorization.authorizers.filter((authorizer) =>
      !authorizer.ready
      && authorizer.activeSigners.some((signer) => signer.publicKey === sessionAddress)
      && !authorizer.signerEvidence.some((signer) => signer.publicKey === sessionAddress));
  }, [authorization, sessionAddress]);

  async function authorize() {
    if (!intent || !authorization || busy) return;
    setBusy(true);
    setError('');
    try {
      let address = sessionAddress;
      if (!address) address = await confirmSigner();
      if (!address) return;
      let current = authorization;
      const targets = current.authorizers.filter((authorizer) =>
        !authorizer.ready
        && authorizer.activeSigners.some((signer) => signer.publicKey === address)
        && !authorizer.signerEvidence.some((signer) => signer.publicKey === address));
      if (targets.length === 0) throw new Error('This wallet is not needed for the remaining Soroban authorization.');

      for (const target of targets) {
        const entryXdr = current.authorizationEntriesXdr[target.entryIndex];
        if (!entryXdr) throw new Error('The authorization entry is no longer available. Refresh this Intent.');
        const entry = xdr.SorobanAuthorizationEntry.fromXdr(entryXdr, 'base64');
        const preimageXdr = sorobanAuthorizationEntryPreimageXdr({
          entry,
          network: intent.network,
          expirationLedger: target.expirationLedger,
        });
        const signed = await wallet.signAuthEntry(preimageXdr, intent.network);
        if (signed.signerAddress !== address) throw new Error('The selected wallet changed while authorization was being signed.');
        const response = await fetch('/api/intent', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-MultiSig-Intent-Id': intent.id,
            ...privateSessionAddressHeaders(address),
          },
          body: JSON.stringify({ entryIndex: target.entryIndex, signatureBase64: signed.signatureBase64 }),
        });
        const body = await apiJson<SorobanIntentContributionResponse>(response);
        current = body.authorization;
      }
      setAuthorization(current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to add Soroban authorization.');
    } finally {
      setBusy(false);
    }
  }

  async function copyShareLink() {
    if (!intent) return;
    const url = new URL(stellarHref('/a'));
    url.hash = intent.id;
    await navigator.clipboard.writeText(url.toString());
    setCopied(true);
  }

  async function refreshAuthorization() {
    const refreshingChangedStructure = executionDiff?.requiresReauthorization === true;
    if (!intent || !authorization || (authorization.status !== 'expired' && !refreshingChangedStructure) || busy) return;
    setBusy(true);
    setError('');
    try {
      let address = sessionAddress;
      if (!address) address = await confirmSigner();
      if (!address) return;
      const response = await fetch('/api/intent', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-MultiSig-Intent-Id': intent.id,
          ...privateSessionAddressHeaders(address),
        },
        body: JSON.stringify({ action: 'replan' }),
      });
      const body = await apiJson<SorobanIntentReplanResponse>(response);
      setIntent(body.intent);
      setAuthorization(body.authorization);
      setExecutionDiff(null);
      setPendingExecution(null);
      setPendingExecutionRoute(null);
      setExecutionCopied(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to refresh Soroban authorization.');
    } finally {
      setBusy(false);
    }
  }

  function continueToSigningRoom(body: SorobanIntentExecutionResponse, route: SorobanExecutionRoute = 'multisigtools') {
    if (!intent) return;
    writeReviewHandoff(sessionStorage, {
      xdr: body.execution.xdr,
      network: intent.network,
      privateNote: intent.privateContext?.initialPrivateNote?.text ?? null,
      sorobanEffectsBaseline: body.execution.effects,
      sorobanTransactionHash: body.execution.transactionHash,
      sorobanIntentId: intent.id,
    });
    navigateWorkspace('/signing-room', {
      state: {
        returnTo: `${stellarHref('/a')}#${intent.id}`,
        returnLabel: 'Back to contract authorization',
        autoSorobanSimulation: false,
        executionRoute: route,
      },
    });
  }

  async function prepareExecution(
    route: SorobanExecutionRoute = executionRoute,
    acceptedEffectsDigest?: string,
    sourceOverride?: string,
  ) {
    if (!intent || !authorization || authorization.status !== 'authorization_ready' || busy) return;
    const source = sourceOverride ?? (route === 'current_client' && isValidStellarAccountId(sessionAddress) ? sessionAddress : executionSource);
    if (!isValidStellarAccountId(source)) {
      setError('Enter a valid Stellar G... account to provide the final transaction sequence and fee.');
      return;
    }
    setPendingExecutionRoute(route);
    setExecutionCopied(false);
    setBusy(true);
    setError('');
    try {
      let address = sessionAddress;
      if (!address) address = await confirmSigner();
      if (!address) return;
      const response = await fetch('/api/intent', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-MultiSig-Intent-Id': intent.id,
          ...privateSessionAddressHeaders(address),
        },
        body: JSON.stringify({ executionSource: source, ...(acceptedEffectsDigest ? { acceptedEffectsDigest } : {}) }),
      });
      const body = await apiJson<SorobanIntentExecutionResponse>(response);
      setExecutionDiff(body.execution.effectsDiff);
      if (acceptedEffectsDigest || body.execution.effectsDiff.kind === 'unchanged') {
        if (route === 'handoff') {
          setPendingExecution(body);
          return;
        }
        continueToSigningRoom(body, route);
        return;
      }
      setPendingExecution(body);
      setBusy(false);
    } catch (cause) {
      if (cause instanceof IntentApiError && (cause.code === 'intent_execution_effects_review_required' || cause.code === 'intent_execution_effects_reauthorization_required')) {
        const diff = cause.details?.effectsDiff;
        if (diff) setExecutionDiff(diff);
        setPendingExecution(null);
      }
      setError(cause instanceof Error ? cause.message : 'Unable to prepare the final transaction.');
      setBusy(false);
    }
  }

  async function copyPreparedExecution() {
    if (!pendingExecution) return;
    await navigator.clipboard.writeText(pendingExecution.execution.xdr);
    setExecutionCopied(true);
  }

  if (!intentId) {
    return <StellarWorkspaceShell active="inbox"><main className="mx-auto max-w-2xl px-4 py-14"><h1 className="text-3xl font-bold">Contract authorization</h1><p className="mt-3 text-neutral-600 dark:text-neutral-300">Open a valid Soroban Intent link.</p><a href={stellarHref('/inbox')} className="mt-6 inline-flex font-semibold text-emerald-700 dark:text-emerald-300">Back to Inbox</a></main></StellarWorkspaceShell>;
  }

  if (!wallet.privateUnlocked && !intent) {
    return (
      <StellarWorkspaceShell active="inbox">
        <main className="mx-auto max-w-2xl px-4 py-14">
          <WorkflowProgress current="review" />
          <h1 className="mt-6 text-3xl font-bold">Contract authorization</h1>
          <p className="mt-3 text-sm leading-6 text-neutral-600 dark:text-neutral-300">This link carries only an Intent id. Confirm a Stellar wallet so MultiSig Tools can verify that you created the Intent or are a current signer for its authorization.</p>
          <ActionButton className="mt-6" disabled={busy || wallet.authBusy} onClick={() => void confirmSigner()}><KeyRound className="h-4 w-4" />{busy || wallet.authBusy ? 'Confirming…' : 'Confirm signer wallet'}</ActionButton>
          {error && <div className="mt-5 rounded-xl border border-red-500/25 bg-red-500/[0.08] p-4 text-sm">{error}</div>}
        </main>
      </StellarWorkspaceShell>
    );
  }

  if (loading && !intent) {
    return <StellarWorkspaceShell active="inbox"><main className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-14 text-neutral-500"><LoaderCircle className="h-5 w-5 animate-spin" />Loading Soroban Intent…</main></StellarWorkspaceShell>;
  }

  if (!intent || !authorization) {
    return <StellarWorkspaceShell active="inbox"><main className="mx-auto max-w-2xl px-4 py-14"><h1 className="text-3xl font-bold">Intent unavailable</h1><p className="mt-3 text-neutral-600 dark:text-neutral-300">{error || 'This Soroban Intent could not be opened.'}</p><ActionButton className="mt-5" variant="secondary" onClick={() => void confirmSigner()}>Try another signer</ActionButton></main></StellarWorkspaceShell>;
  }

  const status = sorobanAuthorizationStatusPresentation(authorization.status);
  return (
    <StellarWorkspaceShell active="inbox" networkContext={intent.network}>
      <main className="px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-5xl">
          <a href={stellarHref('/inbox')} className="text-sm font-semibold text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white">← Inbox</a>
          <div className="mt-3">
            <PageHeader
              title="Contract authorization"
              description="Authorize the contract Intent first. The final transaction source, sequence, fee and envelope signatures are chosen only after authorization is complete."
              meta={<NetworkFact network={intent.network} />}
            />
          </div>
          <div className="mt-6"><WorkflowProgress current={sorobanIntentWorkflowStage(authorization.status)} /></div>

          <div className="mt-6 space-y-5">
            <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3"><StatusBadge tone={status.tone}>{status.label}</StatusBadge><span className="font-mono text-xs text-neutral-400">{intent.id}</span></div>
              <div className="mt-3 break-all font-mono text-[11px] text-neutral-500">Intent {intent.intent.intentDigest}</div>
              {authorization.statusDetail && <p className="mt-3 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{authorization.statusDetail}</p>}
              <div className="mt-4 flex flex-wrap gap-2"><ActionButton variant="secondary" size="sm" onClick={() => void copyShareLink()}><Share2 className="h-4 w-4" />{copied ? 'Intent link copied' : 'Share with another signer'}</ActionButton><ActionButton variant="secondary" size="sm" onClick={() => void loadIntent(sessionAddress)}><RefreshCw className="h-4 w-4" />Refresh</ActionButton></div>
            </section>

            {intent.privateContext?.initialPrivateNote && <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5 sm:p-6"><div className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">Private Note</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-700 dark:text-neutral-200">{intent.privateContext.initialPrivateNote.text}</p></section>}

            {invocationFacts.length > 0 && <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5 sm:p-6"><h2 className="text-xl font-bold">Authorized invocation tree</h2><p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">This tree shows the authorization-bearing calls discovered by Soroban. Simulation effects below are broader evidence and may include internal calls that do not require a separate AUTH entry.</p><div className="mt-4 space-y-3">{invocationFacts.map((fact, index) => <InvocationTree key={`${fact.label}-${index}`} node={fact} />)}</div></section>}

            <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5 sm:p-6"><h2 className="text-xl font-bold">Simulation effects at authorization</h2><p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">This is the recording-simulation evidence fixed into the AuthorizationPlan. Plugins may improve labels, but they do not change the comparison or safety thresholds.</p><div className="mt-4"><SimulationEffectsView effects={intent.authorizationPlan.effects} /></div></section>

            {executionDiff && <section className={`rounded-2xl border p-5 sm:p-6 ${executionDiff.requiresExplicitReview ? 'border-red-500/30 bg-red-500/[0.07]' : 'border-amber-500/25 bg-amber-500/[0.06]'}`}><h2 className="text-xl font-bold">Execution effects comparison</h2><p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">The final enforcing simulation is compared with what signers reviewed. Numeric drift is measured generically; protocol plugins may improve labels but never weaken the comparison.</p><div className="mt-4"><SorobanEffectsDiffView diff={executionDiff} /></div>{pendingExecution && <div className="mt-5 flex flex-wrap gap-2">{pendingExecutionRoute === 'handoff' ? <ActionButton onClick={() => void copyPreparedExecution()}><ClipboardCopy className="h-4 w-4" />{executionCopied ? 'Prepared XDR copied' : 'Copy prepared XDR'}</ActionButton> : <ActionButton onClick={() => continueToSigningRoom(pendingExecution, pendingExecutionRoute ?? 'multisigtools')}>Continue to Signing Room</ActionButton>}<ActionButton variant="secondary" disabled={busy} onClick={() => void prepareExecution(pendingExecutionRoute ?? executionRoute)}><RefreshCw className={busy ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />Re-check effects</ActionButton></div>}{!pendingExecution && executionDiff.requiresReauthorization && <div className="mt-5"><p className="text-sm font-semibold text-red-700 dark:text-red-300">The effect structure changed. The old AUTH cannot approve a different effect shape. Refresh the plan, review the new effects, and collect fresh authorization.</p><ActionButton className="mt-3" disabled={busy} onClick={() => void refreshAuthorization()}><RefreshCw className={busy ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />{busy ? 'Refreshing…' : 'Review changed effects and re-authorize'}</ActionButton></div>}{!pendingExecution && executionDiff.requiresExplicitReview && !executionDiff.requiresReauthorization && <div className="mt-5"><p className="text-sm font-semibold text-red-700 dark:text-red-300">The numeric result changed substantially. Next step is disabled until you explicitly accept this exact effects digest. MultiSigTools will simulate again before producing XDR.</p><ActionButton className="mt-3" disabled={busy} onClick={() => void prepareExecution(pendingExecutionRoute ?? executionRoute, executionDiff.currentDigest)}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CircleAlert className="h-4 w-4" />}{busy ? 'Re-checking…' : 'I reviewed this numeric change — prepare transaction'}</ActionButton></div>}</section>}

            <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5 sm:p-6">
              <h2 className="text-xl font-bold">Required authorization</h2>
              <div className="mt-4 space-y-3">{authorization.authorizers.map((authorizer) => <div key={authorizer.entryIndex} className="rounded-xl border border-black/10 p-4 text-sm dark:border-white/10"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold">{compactAddress(authorizer.authorizer)}</div><div className={authorizer.ready ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'font-semibold text-neutral-500'}>{authorizer.threshold === 0 ? (authorizer.ready ? 'Signature present' : 'Signature required') : `${authorizer.signedWeight} / ${authorizer.threshold} approval power`}</div></div><div className="mt-2 flex flex-wrap gap-2">{authorizer.signerEvidence.length ? authorizer.signerEvidence.map((signer) => <span key={signer.publicKey} className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300">{compactAddress(signer.publicKey)} · +{signer.weight}</span>) : <span className="text-xs text-neutral-500">Waiting for signer authorization.</span>}</div></div>)}</div>
              {authorization.status === 'awaiting_authorization' && <div className="mt-5 rounded-xl bg-black/[0.03] p-4 dark:bg-white/[0.04]"><div className="text-sm font-semibold">Your action</div><p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Selected verified wallet: {sessionAddress ? compactAddress(sessionAddress) : 'none'}.</p><div className="mt-3 flex flex-wrap gap-2">{targetsForSigner.length > 0 && wallet.networkSource !== 'application' && <ActionButton disabled={busy} onClick={() => void authorize()}><KeyRound className="h-4 w-4" />{busy ? 'Authorizing…' : 'Authorize contract Intent'}</ActionButton>}<ActionButton variant="secondary" disabled={busy || wallet.busy} onClick={() => void confirmSigner()}>{sessionAddress ? 'Choose another signer' : 'Choose signer'}</ActionButton></div>{targetsForSigner.length === 0 && sessionAddress && <p className="mt-2 text-xs text-neutral-500">This wallet has no remaining AUTH contribution. Share the Intent link with another current signer.</p>}{targetsForSigner.length > 0 && wallet.networkSource === 'application' && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Ledger and Trezor can sign the final transaction envelope but not detached Soroban AUTH entries. Choose another current signer for this step.</p>}</div>}
            </section>

            {authorization.status === 'authorization_ready' && intent.executionPolicy?.mode === 'external' && <section className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] p-5 sm:p-6"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /><div><h2 className="text-xl font-bold">Authorization complete</h2><p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">AUTH collection is complete. {intent.integration.serviceLabel ?? intent.integration.serviceId} is the external executor for this Intent. MultiSigTools will not let a signer replace that execution boundary.</p></div></div></section>}

            {authorization.status === 'authorization_ready' && intent.executionPolicy?.mode !== 'external' && <section className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] p-5 sm:p-6"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /><div><h2 className="text-xl font-bold">Authorization complete</h2><p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">AUTH collection is complete. Choose how the final transaction should be executed. This does not change the already-authorized contract invocation.</p></div></div><div className="mt-5 grid gap-2 sm:grid-cols-3">{sorobanExecutionRoutes(intent.executionPolicy).filter((route) => route !== 'external_service').map((route) => { const labels = route === 'current_client' ? ['Use this wallet', 'Continue with the current verified wallet as executor.'] : route === 'handoff' ? ['Handle outside MultiSigTools', 'Prepare exact XDR for another wallet, service, CLI, or operator.'] : ['MultiSigTools coordinates', 'Prepare the final transaction and continue through the Proposal signing flow.']; return <button key={route} type="button" onClick={() => { setExecutionRoute(route); setExecutionDiff(null); setPendingExecution(null); setPendingExecutionRoute(null); setExecutionCopied(false); }} className={`rounded-xl border p-4 text-left ${executionRoute === route ? 'border-emerald-500/50 bg-white dark:bg-black/20' : 'border-black/10 bg-white/50 dark:border-white/10 dark:bg-black/10'}`}><div className="text-sm font-semibold">{labels[0]}</div><div className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">{labels[1]}</div></button>; })}</div>{executionRoute === 'current_client' ? <div className="mt-5"><div className="text-sm font-semibold">Current executor</div><p className="mt-1 font-mono text-xs text-neutral-500">{sessionAddress ? compactAddress(sessionAddress) : 'No verified wallet selected'}</p><ActionButton className="mt-3" disabled={busy || !isValidStellarAccountId(sessionAddress)} onClick={() => void prepareExecution('current_client', undefined, sessionAddress)}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}{busy ? 'Preparing transaction…' : 'Continue with this wallet'}</ActionButton></div> : <div className="mt-5"><label htmlFor="intent-execution-source" className="text-sm font-semibold">Transaction source / executor</label><div className="mt-2 flex flex-col gap-2 sm:flex-row"><input id="intent-execution-source" value={executionSource} onChange={(event) => { setExecutionSource(event.target.value.trim()); setExecutionDiff(null); setPendingExecution(null); setPendingExecutionRoute(null); setExecutionCopied(false); }} placeholder="G... executor account" spellCheck={false} className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-4 py-3 font-mono text-sm outline-none dark:border-white/10 dark:bg-black/20" /><ActionButton disabled={busy || !isValidStellarAccountId(executionSource)} onClick={() => void prepareExecution(executionRoute)}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : executionRoute === 'handoff' ? <ClipboardCopy className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}{busy ? 'Preparing transaction…' : executionRoute === 'handoff' ? 'Prepare handoff' : 'Continue to transaction signing'}</ActionButton></div>{sessionAddress && executionSource !== sessionAddress && <button type="button" className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300" onClick={() => { setExecutionSource(sessionAddress); setExecutionDiff(null); setPendingExecution(null); setPendingExecutionRoute(null); setExecutionCopied(false); }}>Use my verified wallet as executor</button>}</div>}</section>}

            {authorization.status === 'expired' && <section className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.08] p-4 sm:p-5"><div className="flex gap-3"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" /><div className="min-w-0 flex-1"><div className="font-semibold">Authorization expired</div><div className="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-300">Refresh the authorization plan for this same Intent. A fresh nonce and expiration window will be created; signatures from the expired plan remain history and will not carry over.</div><ActionButton className="mt-4" variant="secondary" disabled={busy} onClick={() => void refreshAuthorization()}><RefreshCw className={busy ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />{busy ? 'Refreshing…' : 'Refresh authorization'}</ActionButton></div></div></section>}

            {authorization.status === 'blocked' && <section className="rounded-2xl border border-red-500/25 bg-red-500/[0.07] p-4"><div className="flex gap-3"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" /><div><div className="font-semibold">This Intent cannot continue</div><div className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{authorization.statusDetail || 'The current Soroban authorization is no longer usable.'}</div></div></div></section>}
          </div>
          {error && <div className="mt-5 flex gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />{error}</div>}
        </div>
      </main>
    </StellarWorkspaceShell>
  );
}
