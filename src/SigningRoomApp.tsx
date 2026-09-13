import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  ClipboardCopy,
  FileInput,
  LoaderCircle,
  QrCode,
  Send,
} from 'lucide-react';
import ReviewTransactionSummary from './ReviewTransactionSummary';
import SorobanAuthorizationResults from './SorobanAuthorizationResults';
import { ActionButton, NetworkFact, WorkflowProgress } from './MultiSigUi';
import { useStellarWallet } from './StellarWalletContext';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import TransactionAuthorizationResults from './TransactionAuthorizationResults';
import TransactionInspectorSummary from './TransactionInspectorSummary';
import XdrQrCode from './XdrQrCode';
import { accountSigningReviewOutcome } from './stellar/accountSigningFlow';
import { loadNetworkParameters, submitTransactionXdr } from './stellar/horizon';
import type { StellarNetworkParameters, TransactionSubmissionResult } from './stellar/horizon';
import {
  canSubmitReviewedTransactionDirectly,
  loadTransactionSourceAnalyses,
  projectTransactionReviewAuthorizationStatus,
} from './stellar/transactionReviewAnalysis';
import type { SourceAnalysis } from './stellar/transactionReviewAnalysis';
import { privateCommitmentMatchesHash } from './stellar/privateCommitment';
import type { PrivateCommitmentDraft } from './stellar/privateCommitment';
import { resolveStellarNetwork } from './stellar/networkPreference';
import { clearPaymentDraft } from './stellar/paymentDraft';
import { takeReviewHandoff } from './stellar/reviewHandoff';
import { analyzeTransactionAuthorization } from './stellar/transactionAuthorization';
import { assessTransactionPreconditions } from './stellar/transactionPreconditions';
import { inspectTransactionXdr } from './stellar/transactionXdr';
import type { TransactionXdrInspection } from './stellar/transactionXdr';
import { privateSessionAddressHeaders } from './stellar/privateSessionTransport';
import { saveRequestLocalEffects } from './stellar/requestLocalEffects';
import { mergeSignedTransactionXdr } from './stellar/signatureMerge';
import type { CreateSigningRequestResponse, SigningRequestSnapshot } from './stellar/requestTypes';
import type { StellarNetwork } from './stellar/types';
import { isCurrentWorkspaceNavigationState, navigateWorkspace, stellarHref } from './workspaceNavigation';

function friendlyPreconditionState(
  preconditions: ReturnType<typeof assessTransactionPreconditions>,
  inspection: TransactionXdrInspection,
  hasNetworkState: boolean,
): { title: string; detail: string } {
  if (!hasNetworkState) {
    return { title: 'Unable to confirm network readiness', detail: 'Latest Stellar network state could not be loaded. You can still review or collect signatures and try again.' };
  }
  if (preconditions.status === 'expired') {
    const maxTime = inspection.timeBounds?.maxTime;
    const millis = maxTime && maxTime !== '0' ? Number(maxTime) * 1000 : NaN;
    return {
      title: 'Transaction expired',
      detail: Number.isFinite(millis)
        ? `This transaction expired at ${new Date(millis).toLocaleString()}. Create a fresh transaction to continue.`
        : 'This transaction is past its valid execution window. Create a fresh transaction before collecting more signatures.',
    };
  }
  if (preconditions.status === 'stale') {
    return { title: 'Transaction is stale', detail: 'The source account has already moved past this transaction. Create a fresh transaction before collecting more signatures.' };
  }
  if (preconditions.status === 'not_yet_valid') {
    return { title: 'Transaction is not valid yet', detail: 'Its configured execution conditions have not started yet. It can be submitted after those conditions are reached.' };
  }
  return { title: 'Unable to confirm transaction readiness', detail: 'One or more Stellar execution conditions could not be confirmed. Technical details are available under Advanced.' };
}

interface CreatedRequest {
  id: string;
  capability: string;
  snapshot: SigningRequestSnapshot;
  activityBound: boolean;
}

function transactionExplorerUrl(network: StellarNetwork, hash: string) {
  return `https://stellar.expert/explorer/${network === 'testnet' ? 'testnet' : 'public'}/tx/${encodeURIComponent(hash)}`;
}

interface SigningRoomNavigationState {
  returnTo?: string;
  returnLabel?: string;
  requestReturnTo?: string;
  requestReturnLabel?: string;
  autoSorobanSimulation?: boolean;
}

function navigationTarget(
  hrefValue: string | undefined,
  labelValue: string | undefined,
  defaultLabel: string,
): { href: string; label: string } | null {
  if (!hrefValue) return null;
  try {
    const target = new URL(hrefValue);
    if (target.origin !== window.location.origin) return null;
    return { href: target.toString(), label: labelValue?.trim() || defaultLabel };
  } catch {
    return null;
  }
}

function navigationReturnTarget(): { href: string; label: string } | null {
  const state = window.history.state as SigningRoomNavigationState | null;
  if (!isCurrentWorkspaceNavigationState(state)) return null;
  return navigationTarget(state?.returnTo, state?.returnLabel, 'Back');
}

function requestReturnTarget(): { href: string; label: string } | null {
  const state = window.history.state as SigningRoomNavigationState | null;
  if (!isCurrentWorkspaceNavigationState(state)) return null;
  return navigationTarget(state?.requestReturnTo, state?.requestReturnLabel, 'Back');
}

export default function SigningRoomApp() {
  const handoff = useMemo(() => takeReviewHandoff(sessionStorage), []);
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const navigationState = useMemo(() => {
    const state = window.history.state as SigningRoomNavigationState | null;
    return isCurrentWorkspaceNavigationState(state) ? state : null;
  }, []);
  const autoSorobanSimulation = navigationState?.autoSorobanSimulation === true;
  const wallet = useStellarWallet();
  const storedNetwork = handoff.network;
  const requestedNetwork = params.get('network');
  const initialNetwork = resolveStellarNetwork(requestedNetwork, storedNetwork ?? wallet.network);
  const initialReview = useMemo(() => {
    const normalized = handoff.xdr.trim();
    if (!normalized) return null;
    try {
      return {
        xdr: normalized,
        inspection: inspectTransactionXdr(normalized, initialNetwork),
      };
    } catch {
      return null;
    }
  }, [handoff.xdr, initialNetwork]);
  const didAutoReview = useRef(false);
  const [network, setNetwork] = useState<StellarNetwork>(initialNetwork);
  const [draftXdr, setDraftXdr] = useState(initialReview?.xdr ?? handoff.xdr);
  const [roomXdr, setRoomXdr] = useState(initialReview?.xdr ?? '');
  const [inspection, setInspection] = useState<TransactionXdrInspection | null>(initialReview?.inspection ?? null);
  const [privateNote, setPrivateNote] = useState<string | null>(handoff.privateNote);
  const [privateCommitment, setPrivateCommitment] = useState<PrivateCommitmentDraft | null>(handoff.privateCommitment);
  const [sourceAnalyses, setSourceAnalyses] = useState<SourceAnalysis[]>([]);
  const [networkParameters, setNetworkParameters] = useState<StellarNetworkParameters | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(handoff.xdr.trim()));
  const [copied, setCopied] = useState(false);
  const [showReviewXdrQr, setShowReviewXdrQr] = useState(false);
  const [showReturnedSignedXdr, setShowReturnedSignedXdr] = useState(false);
  const [returnedSignedXdr, setReturnedSignedXdr] = useState('');
  const [returnedSignedXdrMessage, setReturnedSignedXdrMessage] = useState('');
  const [startingRequest, setStartingRequest] = useState(false);
  const [directSubmitArmed, setDirectSubmitArmed] = useState(false);
  const [directSubmitting, setDirectSubmitting] = useState(false);
  const [directMainnetConfirmed, setDirectMainnetConfirmed] = useState(false);
  const [directSubmission, setDirectSubmission] = useState<TransactionSubmissionResult | null>(null);
  const [sorobanPreparedXdr, setSorobanPreparedXdr] = useState<string | null>(null);
  const [sorobanAuthorizationReady, setSorobanAuthorizationReady] = useState(false);

  const hasSorobanInvocation = Boolean(inspection?.operations.some((operation) => operation.soroban));
  const effectiveXdr = hasSorobanInvocation && sorobanPreparedXdr ? sorobanPreparedXdr : roomXdr;
  const effectiveInspection = useMemo(() => {
    if (!inspection || !effectiveXdr || effectiveXdr === roomXdr) return inspection;
    try {
      return inspectTransactionXdr(effectiveXdr, network);
    } catch {
      return inspection;
    }
  }, [inspection, effectiveXdr, roomXdr, network]);
  const authorization = useMemo(() => {
    if (!effectiveInspection || !effectiveXdr) return null;
    return analyzeTransactionAuthorization(effectiveXdr, network, effectiveInspection, sourceAnalyses);
  }, [effectiveInspection, effectiveXdr, network, sourceAnalyses]);
  const preconditions = useMemo(() => {
    if (!effectiveInspection) return null;
    const source = sourceAnalyses.find(
      (analysis) => analysis.accountId === effectiveInspection.transactionSourceAccount,
    )?.account ?? null;
    return assessTransactionPreconditions(effectiveInspection, source, { networkParameters });
  }, [effectiveInspection, sourceAnalyses, networkParameters]);
  const status = projectTransactionReviewAuthorizationStatus(authorization);
  const transactionIsDead = preconditions?.status === 'expired' || preconditions?.status === 'stale';
  const selectedWalletCanStartProposal = useMemo(() => {
    const address = wallet.address;
    if (!address || !effectiveInspection) return false;
    if (effectiveInspection.extraSigners.includes(address)) return true;
    return sourceAnalyses.some((analysis) => analysis.account?.signers.some((signer) =>
      signer.key === address
      && signer.weight > 0
      && signer.type === 'ed25519_public_key',
    ));
  }, [wallet.address, effectiveInspection, sourceAnalyses]);
  const accountSigningOutcome = handoff.accountSigningIntent && sourceAnalyses.length > 0
    ? accountSigningReviewOutcome(handoff.accountSigningIntent, selectedWalletCanStartProposal)
    : null;
  const accountSigningExportFirst = accountSigningOutcome === 'export';
  const accountSigningAuthorityPending = Boolean(handoff.accountSigningIntent && loading);
  const directSubmitReady = canSubmitReviewedTransactionDirectly(
    status,
    preconditions?.readyForSubmit === true,
    hasSorobanInvocation,
  );
  const transactionSignerHandoffNeeded = Boolean(
    hasSorobanInvocation
    && sorobanAuthorizationReady
    && !selectedWalletCanStartProposal,
  );
  const reviewCannotStart = Boolean(
    transactionIsDead || (hasSorobanInvocation && !sorobanAuthorizationReady),
  );
  const testnet = network === 'testnet';
  const returnTarget = navigationReturnTarget() ?? {
    href: stellarHref(''),
    label: 'Home',
  };
  const postFreezeReturnTarget = requestReturnTarget() ?? { href: stellarHref(''), label: 'Back to Home' };

  async function reviewXdr(value: string, targetNetwork: StellarNetwork) {
    setError('');
    setCopied(false);
    setShowReviewXdrQr(false);
    setShowReturnedSignedXdr(false);
    setReturnedSignedXdr('');
    setReturnedSignedXdrMessage('');
    setStartingRequest(false);
    setDirectSubmitArmed(false);
    setDirectSubmitting(false);
    setDirectMainnetConfirmed(false);
    setDirectSubmission(null);
    setSorobanPreparedXdr(null);
    setSorobanAuthorizationReady(false);
    setLoading(true);

    try {
      const normalized = value.trim();
      const parsed = inspectTransactionXdr(normalized, targetNetwork);
      setNetwork(targetNetwork);
      setDraftXdr(normalized);
      setRoomXdr(normalized);
      setInspection(parsed);
      setPrivateNote(normalized === handoff.xdr.trim() ? handoff.privateNote : null);
      setPrivateCommitment((current) => {
        if (!current || parsed.memo.type !== 'hash' || typeof parsed.memo.value !== 'string') return null;
        return privateCommitmentMatchesHash(current, parsed.memo.value) ? current : null;
      });
      setSourceAnalyses([]);
      setNetworkParameters(null);

      const [analyses, parameters] = await Promise.all([
        loadTransactionSourceAnalyses(parsed, targetNetwork),
        loadNetworkParameters(targetNetwork).catch(() => null),
      ]);
      setSourceAnalyses(analyses);
      setNetworkParameters(parameters);
    } catch (cause) {
      setRoomXdr('');
      setInspection(null);
      setPrivateNote(null);
      setPrivateCommitment(null);
      setSourceAnalyses([]);
      setNetworkParameters(null);
      setError(cause instanceof Error ? cause.message : 'Unable to review this transaction.');
    } finally {
      setLoading(false);
    }
  }

  function loadRoom(event: FormEvent) {
    event.preventDefault();
    if (!draftXdr.trim() || loading) return;
    setLoading(true);
    setError('');
    void reviewXdr(draftXdr, network);
  }

  useEffect(() => {
    if (didAutoReview.current) return;
    didAutoReview.current = true;
    if (handoff.xdr.trim()) void reviewXdr(handoff.xdr, initialNetwork);
  }, []);

  async function createStoredRequest(xdr: string): Promise<CreatedRequest> {
    if (!wallet.privateUnlocked || wallet.unlockedAddress !== wallet.address || wallet.unlockedNetwork !== network) {
      await wallet.unlock(undefined, network);
    }
    const response = await fetch('/api/request', {
      method: 'POST',
      headers: {
        ...privateSessionAddressHeaders(wallet.address),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        network,
        xdr: xdr.trim(),
        ...(privateNote ? { privateNote } : {}),
        ...(privateCommitment ? {
          privateCommitment: {
            text: privateCommitment.text,
            saltHex: privateCommitment.saltHex,
          },
        } : {}),
      }),
    });
    const body = await response.json() as CreateSigningRequestResponse & { error?: string };
    if (!response.ok) throw new Error(body.error || 'Unable to save this transaction.');
    if (!body.request?.id || !body.capability) throw new Error('MultiSigTools did not return a valid private link.');
    return {
      id: body.request.id,
      capability: body.capability,
      snapshot: body.request,
      activityBound: body.access?.activityBound ?? false,
    };
  }

  async function copyMergedXdr() {
    if (!effectiveXdr) return;
    await navigator.clipboard.writeText(effectiveXdr);
    setCopied(true);
  }

  function retirePaymentDraft() {
    if (!wallet.sessionAddress) return;
    try {
      const returnUrl = new URL(returnTarget.href);
      if (!returnUrl.pathname.endsWith('/new/payment')) return;
      clearPaymentDraft(sessionStorage, wallet.sessionAddress, network);
    } catch {
      // A malformed return target should not block the freeze transition.
    }
  }

  async function addReturnedSignedXdr(event: FormEvent) {
    event.preventDefault();
    if (!roomXdr || !returnedSignedXdr.trim() || loading) return;
    setError('');
    setReturnedSignedXdrMessage('');
    try {
      const merged = mergeSignedTransactionXdr(roomXdr, returnedSignedXdr, network);
      if (merged.addedSignatureCount === 0) {
        setReturnedSignedXdrMessage('No new signatures were found in that XDR.');
        return;
      }
      await reviewXdr(merged.mergedXdr, network);
      setReturnedSignedXdrMessage(`${merged.addedSignatureCount} signature${merged.addedSignatureCount === 1 ? '' : 's'} added. Review updated.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to add this signed XDR.');
    }
  }

  async function submitReviewedXdr() {
    if (!effectiveXdr || !directSubmitReady || !directSubmitArmed || directSubmitting || directSubmission) return;
    if (network === 'public' && !directMainnetConfirmed) return;
    setDirectSubmitting(true);
    setError('');
    try {
      const result = await submitTransactionXdr(effectiveXdr, network);
      setDirectSubmission(result);
      setDirectSubmitArmed(false);
      setDirectMainnetConfirmed(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to submit this signed transaction.');
    } finally {
      setDirectSubmitting(false);
    }
  }

  async function chooseAuthorizedSigner() {
    setError('');
    try {
      await wallet.connect();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to choose an authorized signer wallet.');
    }
  }

  async function continueToSignatures() {
    if (!roomXdr.trim() || reviewCannotStart || startingRequest) return;
    if (transactionSignerHandoffNeeded) {
      setError('');
      try {
        await wallet.connect();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Unable to choose a transaction signer wallet.');
      }
      return;
    }
    setStartingRequest(true);
    setError('');
    try {
      const request = await createStoredRequest(effectiveXdr);
      retirePaymentDraft();
      if (handoff.createTreasuryAccountId && wallet.sessionAddress) {
        saveRequestLocalEffects(sessionStorage, request.id, {
          adoptTreasury: {
            accountId: handoff.createTreasuryAccountId,
            walletAddress: wallet.sessionAddress,
            network,
          },
        });
      }
      navigateWorkspace('/s', {
        replace: true,
        hash: `${request.id}${request.capability}`,
        state: {
          requestPreview: request.snapshot,
          requestJustCreated: true,
          requestActivityBound: request.activityBound,
          returnTo: postFreezeReturnTarget.href,
          returnLabel: postFreezeReturnTarget.label,
        },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start this proposal.');
      setStartingRequest(false);
    }
  }

  const handleSorobanPreparedXdrChange = useCallback((xdr: string | null, ready: boolean) => {
    setSorobanPreparedXdr(xdr);
    setSorobanAuthorizationReady(Boolean(xdr && ready));
    setCopied(false);
  }, []);

  const reviewBlockedState = transactionIsDead && preconditions && effectiveInspection
    ? friendlyPreconditionState(preconditions, effectiveInspection, Boolean(networkParameters))
    : null;

  return (
    <StellarWorkspaceShell active="detail" networkContext={network}>
      <main className="px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6"><WorkflowProgress current={directSubmission ? 'done' : 'review'} /></div>
          {!inspection ? (
            <>
              <section className="max-w-2xl">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${testnet ? 'bg-sky-500/10 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300' : 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'}`}><FileInput className="h-5 w-5" /></div>
                <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">Import transaction</h1>
                <p className="mt-2 text-base leading-7 text-neutral-600 dark:text-neutral-300">Paste a Stellar transaction from another app, wallet, CLI, or Agent. You will see what it does before you approve anything.</p>
              </section>

              <form onSubmit={loadRoom} className="mt-7 max-w-3xl rounded-2xl border border-black/10 bg-white p-5 shadow-sm shadow-black/[0.02] dark:border-white/10 dark:bg-white/5 sm:p-6">
                <div className="mb-2 text-sm font-semibold">Transaction XDR</div>
                <div className="flex items-center gap-3"><NetworkFact network={network} long /><span className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">This deployment network is authoritative; imported XDR is not probed against another ledger.</span></div>
                <textarea value={draftXdr} onChange={(event) => { setDraftXdr(event.target.value); setError(''); }} placeholder="AAAAAgAAA..." spellCheck={false} rows={8} className="mt-4 w-full resize-y rounded-xl border border-black/10 bg-transparent p-4 font-mono text-sm leading-6 outline-none focus:border-emerald-500 dark:border-white/10" />
                <button disabled={loading || !draftXdr.trim()} className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">{loading && <LoaderCircle className="h-4 w-4 animate-spin" />}Review transaction</button>
              </form>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-4 border-b border-black/10 pb-5 dark:border-white/10">
                <div>
                  <a href={returnTarget.href} className="text-sm font-semibold text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white">← {returnTarget.label}</a>
                  <h1 className="mt-2 text-3xl font-bold tracking-tight">Review transaction</h1>
                </div>
                <NetworkFact network={network} />
              </div>

              <div className="mt-6 space-y-5">
                <ReviewTransactionSummary inspection={inspection} xdr={roomXdr} sourceAccount={sourceAnalyses.find((analysis) => analysis.accountId === inspection.transactionSourceAccount)?.account ?? null} privateCommitment={privateCommitment} />
                {hasSorobanInvocation && (
                  <SorobanAuthorizationResults
                    inspection={inspection}
                    envelopeXdr={roomXdr}
                    autoRun={autoSorobanSimulation}
                    onPreparedXdrChange={handleSorobanPreparedXdrChange}
                  />
                )}
                {transactionSignerHandoffNeeded && effectiveInspection && (
                  <section className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-5 sm:p-6">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">Transaction signing handoff</div>
                    <h2 className="mt-2 text-xl font-bold">Ready for transaction signing</h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">Contract authorization is complete. The final transaction envelope must now be handled by a current signer for <span className="font-mono text-xs">{effectiveInspection.transactionSourceAccount.slice(0, 8)}…{effectiveInspection.transactionSourceAccount.slice(-8)}</span>. That signer can continue in this browser or receive the exact prepared XDR on another device.</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <ActionButton onClick={() => void chooseAuthorizedSigner()}>Choose transaction signer</ActionButton>
                      <ActionButton variant="secondary" onClick={() => void copyMergedXdr()}><ClipboardCopy className="h-4 w-4" />{copied ? 'Prepared XDR copied' : 'Copy prepared XDR'}</ActionButton>
                      <ActionButton variant="secondary" aria-expanded={showReviewXdrQr} onClick={() => setShowReviewXdrQr((visible) => !visible)}><QrCode className="h-4 w-4" />{showReviewXdrQr ? 'Hide QR' : 'Show QR'}</ActionButton>
                    </div>
                    {showReviewXdrQr && <div className="mt-4"><XdrQrCode xdr={effectiveXdr} /></div>}
                    <p className="mt-3 text-xs leading-5 text-neutral-500 dark:text-neutral-400">On another device, open New → Import transaction. MultiSig Tools will continue this prepared Soroban XDR without re-running recording simulation or discarding pre-freeze authorization signatures.</p>
                  </section>
                )}
                {privateNote !== null && (
                  <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5 sm:p-6">
                    <div className="font-semibold">Private Note</div>
                    <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Stored privately by MultiSig Tools · not end-to-end encrypted.</p>
                    <textarea value={privateNote} onChange={(event) => setPrivateNote(event.target.value)} rows={6} placeholder="Why are we doing this transaction?" className="mt-4 w-full resize-y rounded-xl border border-black/10 bg-transparent p-3 text-sm leading-6 outline-none focus:border-emerald-500 dark:border-white/10" />
                  </section>
                )}
                {reviewBlockedState && (
                  <section className="rounded-2xl border border-red-500/25 bg-red-500/[0.07] p-4">
                    <div className="flex gap-3"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" /><div><div className="font-semibold">{reviewBlockedState.title}</div><div className="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{reviewBlockedState.detail}</div></div></div>
                  </section>
                )}
                {accountSigningAuthorityPending && (
                  <section className="rounded-2xl border border-black/10 bg-white p-5 text-sm dark:border-white/10 dark:bg-white/5">
                    <div className="flex items-center gap-3"><LoaderCircle className="h-4 w-4 animate-spin text-neutral-500" /><div><div className="font-semibold">Checking current account signers…</div><div className="mt-1 text-neutral-500 dark:text-neutral-400">MultiSig Tools will choose the signing or XDR handoff path from the account's current on-chain signing policy.</div></div></div>
                  </section>
                )}
                {directSubmission ? (
                  <section className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] p-5 sm:p-6">
                    <div className="flex gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /><div className="min-w-0"><h2 className="text-xl font-bold">Submitted to Stellar</h2><p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">The exact reviewed XDR was submitted without requesting another wallet signature.</p><div className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">Ledger {directSubmission.ledger.toLocaleString()}</div><div className="mt-1 break-all font-mono text-xs text-neutral-600 dark:text-neutral-300">{directSubmission.hash}</div><a href={transactionExplorerUrl(network, directSubmission.hash)} target="_blank" rel="noreferrer" className="mt-4 inline-flex text-sm font-semibold text-emerald-700 hover:underline dark:text-emerald-300">View on Stellar Expert</a></div></div>
                  </section>
                ) : directSubmitReady ? (
                  <section className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] p-5 sm:p-6">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">Authorization complete</div>
                    <h2 className="mt-2 text-xl font-bold">Ready to submit</h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">This XDR already satisfies the current on-chain signing policy. No additional wallet signature or Proposal is required to submit it.</p>
                    {!directSubmitArmed ? (
                      <div className="mt-4 flex flex-wrap gap-2"><ActionButton onClick={() => setDirectSubmitArmed(true)}><Send className="h-4 w-4" />Submit transaction</ActionButton><ActionButton variant="secondary" onClick={() => void copyMergedXdr()}><ClipboardCopy className="h-4 w-4" />{copied ? 'XDR copied' : 'Copy XDR'}</ActionButton></div>
                    ) : (
                      <div className="mt-4 rounded-xl border border-black/10 bg-white/60 p-4 dark:border-white/10 dark:bg-black/10">
                        <div className="text-sm font-semibold">Submit this signed XDR to Stellar {network === 'public' ? 'Mainnet' : 'Testnet'}?</div>
                        {network === 'public' && <label className="mt-3 flex items-start gap-2 text-sm text-neutral-600 dark:text-neutral-300"><input type="checkbox" checked={directMainnetConfirmed} onChange={(event) => setDirectMainnetConfirmed(event.target.checked)} className="mt-0.5" />I have reviewed this transaction and intend to submit it to Mainnet.</label>}
                        <div className="mt-4 flex flex-wrap gap-2"><ActionButton disabled={directSubmitting || (network === 'public' && !directMainnetConfirmed)} onClick={() => void submitReviewedXdr()}>{directSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{directSubmitting ? 'Submitting…' : 'Submit transaction'}</ActionButton><ActionButton variant="secondary" disabled={directSubmitting} onClick={() => { setDirectSubmitArmed(false); setDirectMainnetConfirmed(false); }}>Not now</ActionButton></div>
                      </div>
                    )}
                  </section>
                ) : !accountSigningAuthorityPending && (!hasSorobanInvocation || sorobanAuthorizationReady) && (
                  transactionSignerHandoffNeeded ? null : accountSigningExportFirst ? (
                    <section className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-5 sm:p-6">
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">Signing handoff</div>
                      <h2 className="mt-2 text-xl font-bold">XDR ready for an authorized signer</h2>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
                        {handoff.accountSigningIntent === 'offline'
                          ? 'This setup was opened in offline mode, so MultiSig Tools keeps signing outside this browser by default.'
                          : 'The selected wallet is not a current signer for this account, so MultiSig Tools will not create a Proposal under an unrelated identity.'}
                        {' '}Copy or scan the exact reviewed XDR. An authorized signer can open New → Import transaction, sign it, return the signed XDR, or submit it.
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <ActionButton onClick={() => void copyMergedXdr()}><ClipboardCopy className="h-4 w-4" />{copied ? 'XDR copied' : 'Copy XDR'}</ActionButton>
                        <ActionButton variant="secondary" aria-expanded={showReviewXdrQr} onClick={() => setShowReviewXdrQr((visible) => !visible)}><QrCode className="h-4 w-4" />{showReviewXdrQr ? 'Hide QR' : 'Show QR'}</ActionButton>
                        <ActionButton variant="secondary" aria-expanded={showReturnedSignedXdr} onClick={() => setShowReturnedSignedXdr((visible) => !visible)}>{showReturnedSignedXdr ? 'Hide signed XDR' : 'Add signed XDR'}</ActionButton>
                        {handoff.accountSigningIntent !== 'offline' && <ActionButton variant="secondary" onClick={() => void chooseAuthorizedSigner()}>Choose authorized signer</ActionButton>}
                        {handoff.accountSigningIntent === 'offline' && selectedWalletCanStartProposal && <ActionButton variant="secondary" onClick={() => void continueToSignatures()}>Continue here instead</ActionButton>}
                      </div>
                      {showReviewXdrQr && <div className="mt-4"><XdrQrCode xdr={effectiveXdr} /></div>}
                      {showReturnedSignedXdr && <form onSubmit={addReturnedSignedXdr} className="mt-4 rounded-xl border border-black/10 bg-white/60 p-4 dark:border-white/10 dark:bg-black/10"><label htmlFor="returned-signed-xdr" className="text-sm font-semibold">Signed XDR returned by a signer</label><p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Paste it here to merge the new signature into this same Review. You do not need to leave and start again from Import XDR.</p><textarea id="returned-signed-xdr" value={returnedSignedXdr} onChange={(event) => { setReturnedSignedXdr(event.target.value); setReturnedSignedXdrMessage(''); setError(''); }} rows={5} spellCheck={false} placeholder="AAAAAgAAA..." className="mt-3 w-full resize-y rounded-xl border border-black/10 bg-transparent p-3 font-mono text-xs leading-5 outline-none focus:border-emerald-500 dark:border-white/10" /><div className="mt-3 flex flex-wrap items-center gap-3"><ActionButton type="submit" disabled={!returnedSignedXdr.trim() || loading}>{loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}{loading ? 'Checking…' : 'Add signature'}</ActionButton>{returnedSignedXdrMessage && <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">{returnedSignedXdrMessage}</span>}</div></form>}
                    </section>
                  ) : (
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      {wallet.address && <div className="mr-auto text-xs text-neutral-500 dark:text-neutral-400">{wallet.networkSource === 'application' ? 'Selected hardware wallet' : 'Selected wallet'} · <span className="font-mono">{wallet.address.slice(0, 6)}…{wallet.address.slice(-6)}</span> <button type="button" onClick={() => void chooseAuthorizedSigner()} className="ml-2 font-semibold text-neutral-700 hover:underline dark:text-neutral-200">Choose another</button></div>}
                      <button type="button" disabled={reviewCannotStart || startingRequest} onClick={() => void continueToSignatures()} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-40">
                        {startingRequest && <LoaderCircle className="h-4 w-4 animate-spin" />}
                        {startingRequest ? 'Starting proposal…' : wallet.networkSource === 'application' ? 'Continue with hardware wallet' : 'Continue to signatures'}
                      </button>
                    </div>
                  )
                )}

                <details className="group rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5">
                  <summary className="cursor-pointer list-none text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"><span className="flex items-center justify-between gap-4"><span>Advanced</span><span className="text-xs font-normal text-neutral-500 group-open:hidden dark:text-neutral-400">XDR · fees · authorization</span><span className="hidden text-xs font-normal text-neutral-500 group-open:inline dark:text-neutral-400">Hide</span></span></summary>
                  <div className="mt-5 space-y-6">
                    <TransactionInspectorSummary inspection={effectiveInspection ?? inspection} status={status} />
                    <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div><div className="font-semibold">Current XDR</div><div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">The exact Stellar envelope being reviewed.</div></div>
                        <button type="button" onClick={() => void copyMergedXdr()} className="flex items-center gap-2 rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"><ClipboardCopy className="h-4 w-4" />{copied ? 'Copied' : 'Copy XDR'}</button>
                      </div>
                      <textarea value={effectiveXdr} readOnly rows={6} spellCheck={false} className="mt-4 w-full resize-y rounded-xl border border-black/10 bg-black/[0.02] p-3 font-mono text-xs leading-5 outline-none dark:border-white/10 dark:bg-white/[0.03]" />
                    </section>

                    <TransactionAuthorizationResults inspection={effectiveInspection ?? inspection} authorization={authorization} sourceAnalyses={sourceAnalyses} />
                    {preconditions && <div className="rounded-xl bg-black/[0.035] p-4 text-xs dark:bg-white/[0.04]"><div className="font-semibold">Network checks</div><div className="mt-2 space-y-1 text-neutral-600 dark:text-neutral-300">{preconditions.checks.map((check) => <div key={check.code}>{check.code.replaceAll('_', ' ')} — {check.detail}</div>)}</div></div>}
                  </div>
                </details>
              </div>
            </>
          )}

          {error && <div className="mt-5 flex gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm"><CircleAlert className="h-5 w-5 shrink-0 text-red-500" />{error}</div>}
        </div>
      </main>
    </StellarWorkspaceShell>
  );
}
