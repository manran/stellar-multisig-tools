import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  ClipboardCopy,
  LoaderCircle,
  QrCode,
  RefreshCw,
  Send,
  Share2,
  X,
} from 'lucide-react';
import ActivityRetentionNotice from './ActivityRetentionNotice';
import PrivateNoteCard from './PrivateNoteCard';
import PrivateWorkspaceUnlock from './PrivateWorkspaceUnlock';
import { ActionButton, NetworkFact, PageHeader, RequestStatusBadge, WorkflowProgress } from './MultiSigUi';
import ReviewTransactionSummary from './ReviewTransactionSummary';
import SorobanEffectsDiffView from './SorobanEffectsDiffView';
import SigningGuidance from './SigningGuidance';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useStellarWallet } from './StellarWalletContext';
import TransactionAuthorizationResults from './TransactionAuthorizationResults';
import TransactionInspectorSummary from './TransactionInspectorSummary';
import XdrQrCode from './XdrQrCode';
import { horizonTransactionUrl } from './stellar/horizon';
import { isWalletUserRejected } from './stellar/walletKit';
import type { PrivateCommitmentRecord } from './stellar/privateCommitment';
import type { PrivateNoteRevision } from './stellar/privateNote';
import { privateSessionAddressHeaders } from './stellar/privateSessionTransport';
import {
  loadTransactionSourceAnalyses,
  projectTransactionReviewAuthorizationStatus,
} from './stellar/transactionReviewAnalysis';
import type { SourceAnalysis } from './stellar/transactionReviewAnalysis';
import { applyRequestLocalEffects } from './stellar/requestLocalEffects';
import { invalidateSignerAccountsCache } from './stellar/signerAccounts';
import type {
  ContributeSigningRequestResponse,
  CreateSigningRequestResponse,
  SigningRequestApiError,
  SigningRequestSnapshot,
  SigningRequestStatus,
  SubmitSigningRequestResponse,
} from './stellar/requestTypes';
import type { StellarNetwork } from './stellar/types';
import type { SorobanEffectsDiff } from './stellar/sorobanEffects';
import { analyzeTransactionAuthorization } from './stellar/transactionAuthorization';
import { inspectTransactionXdr } from './stellar/transactionXdr';
import { proposalWorkflowStage } from './stellar/humanWorkflow';
import type { TransactionXdrInspection } from './stellar/transactionXdr';
import { isCurrentWorkspaceNavigationState, navigateWorkspace, stellarHref } from './workspaceNavigation';

const REQUEST_POLL_INTERVAL_MS = 30_000;
const REQUEST_ID_LENGTH = 16;
const CAPABILITY_LENGTH = 26;
const PRIVATE_LOCATOR_LENGTH = REQUEST_ID_LENGTH + CAPABILITY_LENGTH;

type ClosedCapabilityStatus = Extract<SigningRequestStatus, 'submitted' | 'expired'>;

interface ClosedCapability {
  network: StellarNetwork | null;
  status: ClosedCapabilityStatus | null;
}

function isClosedCapabilityStatus(status: SigningRequestStatus): status is ClosedCapabilityStatus {
  return status === 'submitted' || status === 'expired';
}

interface ParsedRequestLocator {
  id: string;
  capability: string;
}

interface RequestNavigationState {
  requestPreview?: SigningRequestSnapshot;
  requestJustCreated?: boolean;
  requestActivityBound?: boolean;
  returnTo?: string;
  returnLabel?: string;
}

class RequestApiError extends Error {
  readonly code: string;
  readonly network?: StellarNetwork;
  readonly requestStatus?: SigningRequestStatus;

  readonly details?: SigningRequestApiError['details'];

  constructor(message: string, code: string, network?: StellarNetwork, requestStatus?: SigningRequestStatus, details?: SigningRequestApiError['details']) {
    super(message);
    this.name = 'RequestApiError';
    this.code = code;
    this.network = network;
    this.requestStatus = requestStatus;
    this.details = details;
  }
}

function parseRequestLocator(value: string): ParsedRequestLocator {
  const fragment = (value.includes('#') ? value.slice(value.lastIndexOf('#') + 1) : value).trim().toUpperCase();
  if (fragment.length === PRIVATE_LOCATOR_LENGTH) {
    return {
      id: fragment.slice(0, REQUEST_ID_LENGTH),
      capability: fragment.slice(REQUEST_ID_LENGTH),
    };
  }
  return { id: fragment, capability: '' };
}

function requestLocatorString(id: string, capability: string): string {
  return capability ? `${id}${capability}` : id;
}

function requestUrl(id: string, capability: string): string {
  const url = new URL(stellarHref('/s'));
  url.hash = requestLocatorString(id, capability);
  return url.toString();
}

function displayRequestId(id: string): string {
  return id.length === 16 ? id.match(/.{1,4}/g)?.join('-') ?? id : id;
}

function stellarExpertTransactionUrl(hash: string, network: StellarNetwork) {
  return `https://stellar.expert/explorer/${network === 'testnet' ? 'testnet' : 'public'}/tx/${encodeURIComponent(hash)}`;
}

function requestHeaders(id: string, capability: string, selectedAddress: string, json = false): HeadersInit {
  return {
    'X-MultiSig-Request-Id': id,
    ...(capability ? { 'X-MultiSig-Capability': capability } : {}),
    ...privateSessionAddressHeaders(selectedAddress),
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function apiJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T | SigningRequestApiError;
  if (!response.ok) {
    const error = body as SigningRequestApiError;
    throw new RequestApiError(
      error.error || `MultiSigTools returned HTTP ${response.status}.`,
      error.code || 'request_failed',
      error.network,
      error.requestStatus,
      error.details,
    );
  }
  return body as T;
}

function sameOriginReturnTarget(): { href: string; label: string } | null {
  if (!document.referrer) return null;
  try {
    const referrer = new URL(document.referrer);
    if (referrer.origin !== window.location.origin) return null;
    const inboxPath = referrer.pathname.endsWith('/inbox');
    const label = referrer.pathname.endsWith('/activity')
      ? 'Back to Activity'
      : inboxPath
        ? 'Back to Inbox'
        : 'Back';
    return { href: referrer.toString(), label };
  } catch {
    return null;
  }
}

function requestNavigationState(requestId: string): {
  preview: SigningRequestSnapshot | null;
  returnTarget: { href: string; label: string } | null;
  justCreated: boolean;
  activityBound: boolean;
} {
  const state = window.history.state as RequestNavigationState | null;
  if (!isCurrentWorkspaceNavigationState(state)) {
    return { preview: null, returnTarget: null, justCreated: false, activityBound: false };
  }
  const preview = state?.requestPreview?.id === requestId ? state.requestPreview : null;
  if (!state?.returnTo) {
    return { preview, returnTarget: null, justCreated: Boolean(state?.requestJustCreated), activityBound: Boolean(state?.requestActivityBound) };
  }
  try {
    const target = new URL(state.returnTo);
    if (target.origin !== window.location.origin) {
      return { preview, returnTarget: null, justCreated: Boolean(state?.requestJustCreated), activityBound: Boolean(state?.requestActivityBound) };
    }
    return {
      preview,
      returnTarget: { href: target.toString(), label: state.returnLabel?.trim() || 'Back' },
      justCreated: Boolean(state.requestJustCreated),
      activityBound: Boolean(state.requestActivityBound),
    };
  } catch {
    return { preview, returnTarget: null, justCreated: Boolean(state?.requestJustCreated), activityBound: Boolean(state?.requestActivityBound) };
  }
}

export default function RequestApp() {
  const initialLocator = window.location.hash.slice(1);
  const initialRequest = parseRequestLocator(initialLocator);
  const navigation = useMemo(() => requestNavigationState(initialRequest.id), []);
  const returnTarget = useMemo(() => navigation.returnTarget ?? sameOriginReturnTarget(), [navigation]);
  const initialPreview = navigation.preview;
  const didStart = useRef(false);
  const [requestLocator, setRequestLocator] = useState(initialLocator);
  const [capability, setCapability] = useState(initialRequest.capability);
  const [shareable, setShareable] = useState(Boolean(initialRequest.capability));
  const [activityBound, setActivityBound] = useState(navigation.activityBound);
  const [shareJustCreated, setShareJustCreated] = useState(navigation.justCreated);
  const [snapshot, setSnapshot] = useState<SigningRequestSnapshot | null>(initialPreview);
  const [privateNote, setPrivateNote] = useState<PrivateNoteRevision | null>(null);
  const [privateCommitment, setPrivateCommitment] = useState<PrivateCommitmentRecord | null>(null);
  const [inspection, setInspection] = useState<TransactionXdrInspection | null>(() =>
    initialPreview ? inspectTransactionXdr(initialPreview.mergedXdr, initialPreview.network) : null,
  );
  const [sourceAnalyses, setSourceAnalyses] = useState<SourceAnalysis[]>([]);
  const [signedXdr, setSignedXdr] = useState('');
  const [showXdrQr, setShowXdrQr] = useState(false);
  const [reviewComplete, setReviewComplete] = useState(() => Boolean(
    navigation.justCreated || (initialPreview && initialPreview.status !== 'awaiting_signatures'),
  ));
  const [loading, setLoading] = useState(Boolean(initialRequest.capability));
  const [requestNeedsUnlock, setRequestNeedsUnlock] = useState(Boolean(
    initialRequest.id && !initialRequest.capability && !initialPreview,
  ));
  const [contributing, setContributing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitArmed, setSubmitArmed] = useState(false);
  const [mainnetConfirmed, setMainnetConfirmed] = useState(false);
  const [submissionEffectsDiff, setSubmissionEffectsDiff] = useState<SorobanEffectsDiff | null>(null);
  const [requestAccessDenied, setRequestAccessDenied] = useState(false);
  const [closedCapability, setClosedCapability] = useState<ClosedCapability | null>(null);
  const [error, setError] = useState('');
  const [contributionMessage, setContributionMessage] = useState('');
  const [contributionGrantExpiresAt, setContributionGrantExpiresAt] = useState<number | null>(null);
  const [copied, setCopied] = useState<'link' | 'xdr' | null>(null);
  const {
    address: walletAddress,
    network: walletNetwork,
    networkSource: walletNetworkSource,
    busy: walletBusy,
    error: walletError,
    connect: connectWallet,
    sign: signWithWallet,
    privateUnlocked,
    unlock,
  } = useStellarWallet();

  const authorization = useMemo(() => {
    if (!snapshot || !inspection) return null;
    return analyzeTransactionAuthorization(snapshot.mergedXdr, snapshot.network, inspection, sourceAnalyses);
  }, [snapshot, inspection, sourceAnalyses]);
  const walletAlreadySigned = Boolean(walletAddress && authorization?.sources.some((source) =>
    source.matchedSigners.some((signer) => !signer.automatic && signer.signerKey === walletAddress),
  ));
  const signaturesComplete = Boolean(
    authorization?.coreAuthorizationValid
    || snapshot?.status === 'ready'
    || snapshot?.status === 'waiting_preconditions'
    || snapshot?.status === 'submitted',
  );
  const authorizationStatus = projectTransactionReviewAuthorizationStatus(authorization);
  const isSorobanTransaction = Boolean(inspection?.operations.some((operation) => operation.type === 'invokeHostFunction'));
  const executionAlreadyRoutedToMst = snapshot?.execution?.mode === 'multisigtools' || isSorobanTransaction;
  const workflowStage = snapshot
    ? proposalWorkflowStage(snapshot.status, { reviewComplete, signaturesComplete })
    : 'sign';
  const requestNetwork = snapshot?.network ?? closedCapability?.network ?? null;
  const walletNetworkMismatch = Boolean(
    snapshot
    && walletAddress
    && walletNetwork
    && walletNetworkSource === 'wallet'
    && walletNetwork !== snapshot.network,
  );
  const reviewContinueLabel = snapshot?.status === 'submitted'
    ? 'Back to submitted transaction'
    : signaturesComplete
      ? 'Back to signature status'
      : 'Continue to signatures';
  const privateReadyForRequest = Boolean(privateUnlocked && requestNetwork && walletNetwork === requestNetwork);
  const activeCapabilityNeedsActivity = Boolean(
    snapshot
    && capability
    && shareable
    && !activityBound
    && !walletAlreadySigned
    && !isClosedCapabilityStatus(snapshot.status),
  );
  const terminalCapability = Boolean(
    snapshot
    && capability
    && isClosedCapabilityStatus(snapshot.status),
  );

  async function applySnapshot(next: SigningRequestSnapshot) {
    const parsed = inspectTransactionXdr(next.mergedXdr, next.network);
    const sameRequest = snapshot?.id === next.id;
    if (next.status !== 'awaiting_signatures') setReviewComplete(true);
    else if (!sameRequest) setReviewComplete(false);
    setSnapshot(next);
    setInspection(parsed);
    if (!sameRequest) setSourceAnalyses([]);
    window.history.replaceState({
      ...(window.history.state ?? {}),
      requestPreview: next,
    }, '');
    const analyses = await loadTransactionSourceAnalyses(parsed, next.network);
    setSourceAnalyses(analyses);
  }

  function clearPrivateRequestView() {
    setSnapshot(null);
    setInspection(null);
    setPrivateNote(null);
    setPrivateCommitment(null);
    setSourceAnalyses([]);
  }

  function applyClosedCapabilityError(cause: RequestApiError) {
    const status = cause.requestStatus && isClosedCapabilityStatus(cause.requestStatus)
      ? cause.requestStatus
      : null;
    setClosedCapability({ network: cause.network ?? null, status });
    setRequestAccessDenied(false);
    setRequestNeedsUnlock(false);
    clearPrivateRequestView();
    setShareable(false);
    setError('');
  }

  async function load(locatorValue = requestLocator) {
    const locator = parseRequestLocator(locatorValue);
    if (!locator.id) return;
    if (snapshot?.id && snapshot.id !== locator.id) setContributionGrantExpiresAt(null);
    if (!locator.capability && !privateUnlocked) {
      setRequestLocator(locator.id);
      setCapability('');
      setShareable(false);
      setActivityBound(false);
      setRequestAccessDenied(false);
      setClosedCapability(null);
      setRequestNeedsUnlock(true);
      clearPrivateRequestView();
      setLoading(false);
      setError('');
      setContributionMessage('');
      return;
    }
    setRequestNeedsUnlock(false);
    setLoading(true);
    setRequestAccessDenied(false);
    setClosedCapability(null);
    setError('');
    setContributionMessage('');
    try {
      const body = await apiJson<CreateSigningRequestResponse>(await fetch('/api/request', {
        cache: 'no-store',
        headers: requestHeaders(locator.id, locator.capability, walletAddress),
      }));
      if (
        locator.capability
        && body.access?.activityBound
        && isClosedCapabilityStatus(body.request.status)
      ) {
        navigateWorkspace('/activity');
        return;
      }
      await applySnapshot(body.request);
      setPrivateNote(body.context?.privateNote ?? null);
      setPrivateCommitment(body.context?.privateCommitment ?? null);
      const normalized = requestLocatorString(body.request.id, locator.capability);
      setRequestLocator(normalized);
      setCapability(locator.capability);
      setShareable(body.access?.shareable ?? Boolean(locator.capability));
      setActivityBound(body.access?.activityBound ?? false);
      setContributionGrantExpiresAt(body.access?.contributionGrantExpiresAt ?? null);
      window.history.replaceState(window.history.state ?? {}, '', requestUrl(body.request.id, locator.capability));
    } catch (cause) {
      if (cause instanceof RequestApiError && cause.code === 'request_capability_closed') {
        applyClosedCapabilityError(cause);
        return;
      }
      const accessDenied = cause instanceof RequestApiError && cause.code === 'request_access_denied';
      setRequestNeedsUnlock(false);
      setRequestAccessDenied(accessDenied);
      if (!initialPreview || accessDenied) {
        setSnapshot(null);
        setInspection(null);
      }
      setPrivateNote(null);
      setPrivateCommitment(null);
      setSourceAnalyses([]);
      if (!accessDenied) {
        setError(cause instanceof Error ? cause.message : 'Unable to open this shared transaction.');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (didStart.current) return;
    didStart.current = true;
    if (initialLocator) void load(initialLocator);
  }, []);

  useEffect(() => {
    if (!requestNeedsUnlock || !privateUnlocked || !requestLocator.trim()) return;
    void load(requestLocator);
  }, [requestNeedsUnlock, privateUnlocked]);

  useEffect(() => {
    if (!snapshot || capability || privateUnlocked) return;
    clearPrivateRequestView();
    setShareable(false);
    setActivityBound(false);
    setRequestAccessDenied(false);
    setRequestNeedsUnlock(true);
    setLoading(false);
    setError('');
    setContributionMessage('');
  }, [snapshot?.id, capability, privateUnlocked]);

  useEffect(() => {
    setSubmitArmed(false);
    setMainnetConfirmed(false);
    setSubmissionEffectsDiff(null);
    setShowXdrQr(false);
  }, [snapshot?.transactionHash, snapshot?.network]);

  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.status !== 'awaiting_signatures' || walletAlreadySigned) setReviewComplete(true);
  }, [snapshot?.id, snapshot?.status, walletAlreadySigned]);

  useEffect(() => {
    if (!snapshot || snapshot.status !== 'submitted') return;
    applyRequestLocalEffects(sessionStorage, localStorage, snapshot.id, snapshot.network);
  }, [snapshot?.id, snapshot?.status, snapshot?.network]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 2_000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!snapshot || (!capability && !privateUnlocked) || (
      snapshot.status !== 'awaiting_signatures'
      && snapshot.status !== 'waiting_preconditions'
    )) return;
    const id = snapshot.id;
    const currentMergedXdr = snapshot.mergedXdr;
    const currentStatus = snapshot.status;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void (async () => {
        try {
          const body = await apiJson<CreateSigningRequestResponse>(await fetch('/api/request', {
            cache: 'no-store',
            headers: requestHeaders(id, capability, walletAddress),
          }));
          const requestChanged = body.request.mergedXdr !== currentMergedXdr
            || body.request.status !== currentStatus;
          if (requestChanged) await applySnapshot(body.request);
          else setSnapshot(body.request);
          setPrivateNote(body.context?.privateNote ?? null);
          setPrivateCommitment(body.context?.privateCommitment ?? null);
          if (body.access) {
            setShareable(body.access.shareable);
            setActivityBound(body.access.activityBound ?? false);
            setContributionGrantExpiresAt(body.access.contributionGrantExpiresAt ?? null);
          }
        } catch (cause) {
          if (cause instanceof RequestApiError && cause.code === 'request_capability_closed') {
            applyClosedCapabilityError(cause);
          }
          // Keep the last known state for transient failures; explicit refresh surfaces them.
        }
      })();
    }, REQUEST_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [snapshot?.id, snapshot?.status, snapshot?.mergedXdr, capability, privateUnlocked, walletAddress]);

  function submitLookup(event: FormEvent) {
    event.preventDefault();
    setShareJustCreated(false);
    void load();
  }

  async function saveToActivity() {
    if (!snapshot || !walletAddress) return;
    setLoading(true);
    setError('');
    try {
      const body = await apiJson<CreateSigningRequestResponse>(await fetch('/api/request', {
        method: 'PATCH',
        headers: requestHeaders(snapshot.id, capability, walletAddress, true),
        body: JSON.stringify({ retainActivity: true }),
      }));
      await applySnapshot(body.request);
      setShareable(body.access?.shareable ?? shareable);
      setActivityBound(body.access?.activityBound ?? false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save this proposal to Activity.');
    } finally {
      setLoading(false);
    }
  }

  async function addSignatureContribution(signedCopy: string) {
    if (!snapshot) return;
    const body = await apiJson<ContributeSigningRequestResponse>(await fetch('/api/request', {
      method: 'PATCH',
      headers: requestHeaders(snapshot.id, capability, walletAddress, true),
      body: JSON.stringify({ signedXdr: signedCopy.trim() }),
    }));
    await applySnapshot(body.request);
    if (body.access?.contributionGrantExpiresAt) setContributionGrantExpiresAt(body.access.contributionGrantExpiresAt);
    setContributionMessage(body.addedSignatureCount > 0
      ? `Added ${body.addedSignatureCount} signature${body.addedSignatureCount === 1 ? '' : 's'}.`
      : 'No new signature was added; this signed copy was already represented.');
  }

  async function contribute(event: FormEvent) {
    event.preventDefault();
    if (!snapshot || !signedXdr.trim()) return;
    setContributing(true);
    setError('');
    setContributionMessage('');
    try {
      await addSignatureContribution(signedXdr);
      setSignedXdr('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to add this signed copy.');
    } finally {
      setContributing(false);
    }
  }

  async function signRequestWithWallet() {
    if (!snapshot) return;
    setContributing(true);
    setError('');
    setContributionMessage('');
    try {
      const signedCopy = await signWithWallet(snapshot.mergedXdr, snapshot.network);
      await addSignatureContribution(signedCopy);
      setContributionMessage('');
    } catch (cause) {
      if (!walletError) setError(cause instanceof Error ? cause.message : 'The wallet could not sign this transaction.');
    } finally {
      setContributing(false);
    }
  }

async function submitRequest(acceptedEffectsDigest?: string) {
    if (!snapshot || snapshot.status !== 'ready' || !submitArmed) return;
    if (snapshot.network === 'public' && !mainnetConfirmed) return;
    setSubmitting(true);
    setError('');
    try {
      const body = await apiJson<SubmitSigningRequestResponse>(await fetch('/api/request', {
        method: 'PUT',
        headers: requestHeaders(snapshot.id, capability, walletAddress, Boolean(acceptedEffectsDigest)),
        ...(acceptedEffectsDigest ? { body: JSON.stringify({ acceptedEffectsDigest }) } : {}),
      }));
      await applySnapshot(body.request);
      if (
        body.request.status === 'submitted'
        && inspection?.operations.some((operation) => operation.type === 'setOptions' && operation.threshold === 'high')
      ) {
        invalidateSignerAccountsCache(body.request.network);
      }
      setShareable(false);
      setSubmitArmed(false);
      setMainnetConfirmed(false);
      setSubmissionEffectsDiff(null);
    } catch (cause) {
      if (cause instanceof RequestApiError
        && (cause.code === 'soroban_effects_review_required' || cause.code === 'soroban_effects_reauthorization_required')
        && cause.details?.effectsDiff) {
        setSubmissionEffectsDiff(cause.details.effectsDiff);
        if (cause.code === 'soroban_effects_reauthorization_required') setSubmitArmed(false);
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Unable to submit this transaction.');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink() {
    if (!snapshot || !shareable) return;
    await navigator.clipboard.writeText(requestUrl(snapshot.id, capability));
    setCopied('link');
  }

  async function copyXdr() {
    if (!snapshot) return;
    await navigator.clipboard.writeText(snapshot.mergedXdr);
    setCopied('xdr');
  }

  async function openTransactionReceipt() {
    if (!snapshot) return;
    setError('');
    try {
      const contributionGrantActive = Boolean(contributionGrantExpiresAt && contributionGrantExpiresAt * 1000 > Date.now());
      if (!privateReadyForRequest && !contributionGrantActive) await unlock(undefined, snapshot.network);
      const search = new URLSearchParams({
        request: snapshot.id,
        network: snapshot.network,
      }).toString();
      navigateWorkspace('/receipt', {
        search,
        state: { returnTo: window.location.href, returnLabel: 'Back to transaction' },
      });
    } catch (cause) {
      if (!isWalletUserRejected(cause)) setError(cause instanceof Error ? cause.message : 'Unable to confirm this wallet.');
    }
  }

  async function openActivity() {
    setError('');
    try {
      if (!privateReadyForRequest) await unlock(undefined, snapshot.network);
      navigateWorkspace('/activity');
    } catch (cause) {
      if (!isWalletUserRejected(cause)) setError(cause instanceof Error ? cause.message : 'Unable to confirm this wallet.');
    }
  }

  return (
    <StellarWorkspaceShell active="detail" networkContext={requestNetwork}>
      <main className="px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-5xl">

          {!snapshot && loading && Boolean(initialLocator) && !closedCapability && !requestNeedsUnlock && (
            <section className="py-16 text-center sm:py-24">
              <LoaderCircle className="mx-auto h-7 w-7 animate-spin text-emerald-600" />
              <h1 className="mt-4 text-2xl font-bold">Opening transaction…</h1>
              <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Loading the latest signing progress.</p>
            </section>
          )}

          {!snapshot && closedCapability && (
            privateReadyForRequest ? (
              <section className="mx-auto max-w-xl py-12 sm:py-20">
                <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-300" />
                <h1 className="mt-5 text-4xl font-bold tracking-tight">{closedCapability.status === 'expired' ? 'This private link has expired' : 'Transaction confirmed'}</h1>
                <p className="mt-3 text-lg leading-8 text-neutral-600 dark:text-neutral-300">{closedCapability.status === 'expired' ? 'For privacy, this share link no longer opens transaction details. Associated wallets can continue in Activity.' : 'Confirmed on Stellar. For privacy, this private share link no longer exposes proposal details; associated wallets can open the permanent on-chain receipt from Activity.'}</p>
                <button type="button" onClick={() => navigateWorkspace('/activity')} className="mt-7 rounded-xl bg-emerald-600 px-5 py-3 text-base font-semibold text-white">View Activity</button>
              </section>
            ) : (
              <PrivateWorkspaceUnlock
                title={closedCapability.status === 'expired' ? 'This private link has expired' : 'Transaction confirmed'}
                description={closedCapability.status === 'expired' ? 'For privacy, this share link no longer opens transaction details. Confirm an associated wallet to continue in Activity; this expired link grants no additional access.' : 'Confirmed on Stellar. This private share link no longer exposes proposal details. Confirm an associated wallet to open the permanent on-chain receipt in Activity; this finished link grants no additional access.'}
                buttonLabel="Open Activity"
                onUnlocked={() => navigateWorkspace('/activity')}
              />
            )
          )}

          {!snapshot && (requestNeedsUnlock || requestAccessDenied) && !privateUnlocked && (
            <PrivateWorkspaceUnlock
              title="Confirm your wallet"
              description="Confirm a current signer wallet to open this transaction. This does not sign or submit anything."
              buttonLabel="Open transaction"
              onUnlocked={() => load(requestLocator)}
            />
          )}

          {!snapshot && requestAccessDenied && privateUnlocked && (
            <section className="mx-auto max-w-xl py-12 sm:py-20">
              <CircleAlert className="h-8 w-8 text-amber-600 dark:text-amber-300" />
              <h1 className="mt-5 text-4xl font-bold tracking-tight">This wallet cannot open this proposal</h1>
              <p className="mt-3 text-lg leading-8 text-neutral-600 dark:text-neutral-300">The confirmed wallet is not a current signer for this transaction. Use the private share link, or choose another current signer wallet and confirm it.</p>
              <button type="button" disabled={walletBusy} onClick={() => void connectWallet()} className="mt-7 rounded-xl bg-emerald-600 px-5 py-3 text-base font-semibold text-white disabled:opacity-50">{walletBusy ? 'Opening wallets…' : 'Choose another signer wallet'}</button>
            </section>
          )}

          {!closedCapability && !requestAccessDenied && !requestNeedsUnlock && !snapshot && (!loading || !initialLocator) && (
            <section className="mx-auto max-w-2xl py-8 sm:py-14">
              <Share2 className="h-7 w-7 text-emerald-600 dark:text-emerald-300" />
              <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">Open a shared transaction</h1>
              <p className="mt-2 text-base leading-7 text-neutral-600 dark:text-neutral-300">Paste a private MultiSigTools link, or a proposal ID and confirm one of its current signer wallets.</p>

              <form onSubmit={submitLookup} className="mt-7 rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5 sm:p-6">
                <label htmlFor="request-locator" className="text-sm font-semibold">Private link or proposal ID</label>
                <input id="request-locator" value={requestLocator} onChange={(event) => setRequestLocator(event.target.value)} placeholder="Paste shared transaction link" spellCheck={false} className="mt-2 w-full rounded-xl border border-black/10 bg-transparent px-3 py-3 text-sm outline-none focus:border-emerald-500 dark:border-white/10" />
                <button disabled={loading || !requestLocator.trim()} className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{loading && <LoaderCircle className="h-4 w-4 animate-spin" />}Open transaction</button>
              </form>
              <p className="mt-5 text-sm text-neutral-500 dark:text-neutral-400">Have XDR instead? Use <a href={stellarHref('/new/import')} className="font-semibold text-emerald-700 dark:text-emerald-300">New → Import transaction</a>.</p>
            </section>
          )}

          {error && <div className="mt-5 flex gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm"><CircleAlert className="h-5 w-5 shrink-0 text-red-500" />{error}</div>}

          {snapshot && inspection && (
            <div className="space-y-5">
              {returnTarget && (
                <a href={returnTarget.href} className="inline-flex text-sm font-semibold text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white">← {returnTarget.label}</a>
              )}

              <PageHeader
                eyebrow={<div className="flex flex-wrap items-center gap-2"><RequestStatusBadge status={snapshot.status} /><NetworkFact network={snapshot.network} /></div>}
                title="Proposal"
                description="Review the exact transaction, collect signatures, then follow its configured execution route once authorization is complete."
                actions={<><button type="button" onClick={() => void load(requestLocatorString(snapshot.id, capability))} disabled={loading} className="flex items-center gap-2 rounded-xl border border-black/10 px-3 py-2.5 text-sm font-semibold disabled:opacity-50 dark:border-white/10"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>{shareable && <button type="button" onClick={() => void copyLink()} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white"><ClipboardCopy className="h-4 w-4" />{copied === 'link' ? 'Copied' : 'Copy private link'}</button>}</>}
              />

              <WorkflowProgress current={workflowStage} />

              {walletNetworkMismatch && (
                <section className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.08] p-4 text-sm">
                  <div className="flex gap-3">
                    <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                    <div>
                      <div className="font-semibold">Wallet and proposal are on different networks</div>
                      <div className="mt-1 leading-6 text-neutral-600 dark:text-neutral-300">Your connected wallet is on {walletNetwork === 'public' ? 'Mainnet' : 'Testnet'}, while this proposal is on {snapshot.network === 'public' ? 'Mainnet' : 'Testnet'}. The proposal network is authoritative here; confirm the network shown by your wallet before signing.</div>
                    </div>
                  </div>
                </section>
              )}

              {shareJustCreated && shareable && (
                <section className="flex items-start justify-between gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-4 py-3">
                  <div className="flex min-w-0 gap-3">
                    <Share2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
                    <div><div className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">Private link ready</div><p className="mt-0.5 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Anyone with this private link can view the active Proposal. The link never grants Stellar signing authority.</p></div>
                  </div>
                  <button type="button" onClick={() => setShareJustCreated(false)} className="rounded-lg p-1.5 text-neutral-500 hover:bg-black/5 hover:text-black dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white" aria-label="Dismiss private link reminder"><X className="h-4 w-4" /></button>
                </section>
              )}

              {activeCapabilityNeedsActivity && (
                privateReadyForRequest ? (
                  <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 bg-white/55 px-4 py-3 text-sm dark:border-white/10 dark:bg-white/[0.03]">
                    <div className="text-neutral-600 dark:text-neutral-300">Not saved to Activity. Private links close after submission or expiry.</div>
                    <button type="button" disabled={loading} onClick={() => void saveToActivity()} className="font-semibold text-emerald-700 disabled:opacity-50 dark:text-emerald-300">Save to Activity</button>
                  </section>
                ) : (
                  <ActivityRetentionNotice status={snapshot.status} network={snapshot.network} onUnlocked={saveToActivity} />
                )
              )}

              {copied === 'link' && <div className="fixed bottom-6 right-6 z-[90] rounded-xl border border-emerald-500/25 bg-white px-4 py-3 text-sm font-semibold text-emerald-800 shadow-lg dark:bg-[#151515] dark:text-emerald-200">Private link copied.</div>}

              {!reviewComplete ? (
                <>
                  <ReviewTransactionSummary inspection={inspection} xdr={snapshot.mergedXdr} sourceAccount={sourceAnalyses.find((analysis) => analysis.accountId === inspection.transactionSourceAccount)?.account ?? null} privateCommitment={privateCommitment} />
                  {!privateCommitment && privateNote && <PrivateNoteCard note={privateNote} busy={false} locked />}
                  <div className="flex justify-end">
                    <button type="button" onClick={() => setReviewComplete(true)} className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-700">{reviewContinueLabel}</button>
                  </div>
                </>
              ) : (
                <>
                  <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] px-4 py-3 sm:px-5">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                      <div><div className="text-sm font-semibold">Review complete</div><div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">Receipt details are collapsed while signatures are collected.</div></div>
                    </div>
                    <button type="button" onClick={() => setReviewComplete(false)} className="text-sm font-semibold text-emerald-700 underline decoration-emerald-500/30 underline-offset-4 dark:text-emerald-300">Review details</button>
                  </section>

                  {contributionMessage && <div className="flex gap-2 rounded-xl bg-emerald-500/10 p-4 text-sm text-emerald-800 dark:text-emerald-200"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{contributionMessage}</div>}

                  <SigningGuidance
                    inspection={inspection}
                    authorization={authorization}
                    sourceAnalyses={sourceAnalyses}
                    walletAddress={walletAddress}
                    walletBusy={walletBusy || contributing}
                    walletError={walletError}
                    onConnectWallet={() => void connectWallet()}
                    onSignWithWallet={() => void signRequestWithWallet()}
                    onShare={shareable ? () => requestUrl(snapshot.id, capability) : undefined}
                    shareCreatesLink={shareable}
                    knownComplete={signaturesComplete}
                  />

                  {snapshot.status === 'ready' && (
                    <section className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.08] p-5 sm:p-6">
                      <div className="font-semibold text-emerald-800 dark:text-emerald-200">Authorization complete</div>
                      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">{snapshot.execution?.mode === 'external'
                        ? `All required signatures are present. ${snapshot.execution.executor.label ?? snapshot.execution.executor.id} owns final execution; MultiSigTools will not broadcast this transaction.`
                        : executionAlreadyRoutedToMst
                          ? 'All required signatures are present. This work is already routed through MultiSigTools execution.'
                          : 'All required signatures are present. Choose how this exact authorized transaction should be executed.'}</p>
                      {snapshot.execution?.mode === 'external' ? (
                        <div className="mt-4 rounded-xl border border-violet-500/25 bg-violet-500/[0.07] p-4 text-sm">
                          <div className="font-semibold text-violet-800 dark:text-violet-200">Waiting for external execution</div>
                          <p className="mt-1 leading-6 text-neutral-600 dark:text-neutral-300">The originating service will re-check its business state and submit after its own execution conditions are satisfied.</p>
                        </div>
                      ) : (
                        <>
                          {submissionEffectsDiff && <div className="mt-4"><SorobanEffectsDiffView diff={submissionEffectsDiff} /></div>}
                          {submissionEffectsDiff?.requiresReauthorization ? (
                            <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/[0.07] p-4 text-sm">
                              <div className="font-semibold text-red-700 dark:text-red-300">Submission stopped: contract effects changed structurally.</div>
                              <p className="mt-1 leading-6 text-neutral-600 dark:text-neutral-300">The existing signatures cannot approve a different effect shape. Return to the original Soroban Intent, refresh authorization, and create a fresh Proposal.</p>
                            </div>
                          ) : !submitArmed && !executionAlreadyRoutedToMst ? (
                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                              <button type="button" onClick={() => setSubmitArmed(true)} className="rounded-xl border border-emerald-500/35 bg-white/70 p-4 text-left hover:border-emerald-500/60 dark:bg-black/15">
                                <div className="flex items-center gap-2 text-sm font-semibold"><Send className="h-4 w-4 text-emerald-600" />MultiSigTools submits</div>
                                <p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Re-check final conditions, then broadcast this exact authorized transaction through MultiSigTools.</p>
                              </button>
                              <button type="button" onClick={() => void copyXdr()} className="rounded-xl border border-black/10 bg-white/70 p-4 text-left hover:border-emerald-500/40 dark:border-white/10 dark:bg-black/15">
                                <div className="flex items-center gap-2 text-sm font-semibold"><ClipboardCopy className="h-4 w-4" />Handle outside MultiSigTools</div>
                                <p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Copy the fully authorized XDR for another wallet, CLI, service, or operator to submit. Copying is not handoff or submission evidence.</p>
                                <div className="mt-3 text-xs font-semibold text-emerald-700 dark:text-emerald-300">{copied === 'xdr' ? 'Authorized XDR copied' : 'Copy authorized XDR'}</div>
                              </button>
                            </div>
                          ) : (
                            <div className={`mt-4 rounded-xl border p-4 ${snapshot.network === 'public' ? 'border-red-500/30 bg-red-500/10' : 'border-amber-500/30 bg-amber-500/10'}`}>
                              <div className="text-sm font-semibold">Submit this transaction to Stellar {snapshot.network === 'public' ? 'Mainnet' : 'Testnet'}?</div>
                              <p className="mt-1 text-sm opacity-70">Once Stellar confirms it, this transaction cannot be withdrawn.</p>
                              {submissionEffectsDiff?.requiresExplicitReview && <p className="mt-3 text-sm font-semibold text-red-700 dark:text-red-300">The final simulation found a material numeric change. Continuing accepts this exact effects digest; the server will simulate again before broadcast and stop if it changes again.</p>}
                              {snapshot.network === 'public' && (
                                <label className="mt-3 flex cursor-pointer items-start gap-3">
                                  <input type="checkbox" checked={mainnetConfirmed} onChange={(event) => setMainnetConfirmed(event.target.checked)} className="mt-1" />
                                  <span className="text-sm font-semibold">I intend to submit this transaction on Mainnet.</span>
                                </label>
                              )}
                              <div className="mt-4 flex flex-wrap gap-2">
                                <button type="button" onClick={() => void submitRequest(submissionEffectsDiff?.requiresExplicitReview ? submissionEffectsDiff.currentDigest : undefined)} disabled={submitting || (snapshot.network === 'public' && !mainnetConfirmed)} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{submitting ? 'Checking and submitting…' : submissionEffectsDiff?.requiresExplicitReview ? 'Accept current effects and submit' : 'Submit transaction'}</button>
                                {!executionAlreadyRoutedToMst && <button type="button" disabled={submitting} onClick={() => { setSubmitArmed(false); setMainnetConfirmed(false); }} className="rounded-xl border border-black/10 px-4 py-3 text-sm font-semibold dark:border-white/10">Choose another route</button>}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </section>
                  )}

                  {snapshot.status === 'waiting_preconditions' && (
                    <section className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.08] p-5 text-sm">
                      <div className="flex gap-3"><CircleAlert className="h-5 w-5 shrink-0 text-amber-500" /><div><div className="font-semibold">Signatures are complete, but this transaction is still waiting.</div><div className="mt-1 opacity-65">{snapshot.statusDetail}</div></div></div>
                    </section>
                  )}

                  {snapshot.submission && (
                    <section className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.08] p-5">
                      <div className="flex items-center gap-2 font-semibold text-emerald-800 dark:text-emerald-200"><CheckCircle2 className="h-5 w-5" />Transaction confirmed</div>
                      <div className="mt-2 text-sm opacity-65">Confirmed in ledger {snapshot.submission.ledger} · {new Date(snapshot.submission.submittedAt).toLocaleString()}</div>
                      <div className="mt-2 break-all font-mono text-xs text-neutral-500 dark:text-neutral-400">{snapshot.submission.transactionHash}</div>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold">
                        <button type="button" onClick={() => void openTransactionReceipt()} className="underline decoration-black/20 underline-offset-4 dark:decoration-white/20">Transaction receipt</button>
                        <a href={horizonTransactionUrl(snapshot.submission.transactionHash, snapshot.network)} target="_blank" rel="noreferrer" className="underline decoration-black/20 underline-offset-4 dark:decoration-white/20">View network record</a>
                        <a href={stellarExpertTransactionUrl(snapshot.submission.transactionHash, snapshot.network)} target="_blank" rel="noreferrer" className="underline decoration-black/20 underline-offset-4 dark:decoration-white/20">View on StellarExpert</a>
                      </div>
                    </section>
                  )}

                  {(snapshot.status === 'expired' || snapshot.status === 'stale' || snapshot.status === 'blocked') && (
                    <section className="rounded-2xl border border-red-500/25 bg-red-500/[0.07] p-5 text-sm">
                      <div className="flex gap-3"><CircleAlert className="h-5 w-5 shrink-0 text-red-500" /><div><div className="font-semibold">This transaction cannot continue in its current state.</div><div className="mt-1 opacity-65">{snapshot.statusDetail}</div></div></div>
                    </section>
                  )}

                  {terminalCapability && (
                    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 bg-white/55 px-4 py-3 text-sm dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="text-neutral-600 dark:text-neutral-300"><span className="font-semibold text-neutral-900 dark:text-white">Private link closed.</span> Finished proposals use retained wallet history instead of the old share link.</div>
                      <button type="button" onClick={() => void openActivity()} className="font-semibold text-emerald-700 dark:text-emerald-300">View Activity</button>
                    </section>
                  )}
                </>
              )}

              <details className="group mst-advanced-panel">
                <summary className="cursor-pointer list-none text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"><span className="flex items-center justify-between gap-4"><span>Advanced</span><span className="text-sm font-normal opacity-55 group-open:hidden">Request id · XDR · Stellar authorization</span><span className="hidden text-sm font-normal opacity-55 group-open:inline">Hide details</span></span></summary>
                <div className="mt-5 space-y-6 border-t border-black/10 pt-5 dark:border-white/10">
                  <div className="rounded-xl bg-black/[0.035] p-4 text-xs dark:bg-white/[0.04]">
                    <div><span className="font-semibold">Request id:</span> <span className="break-all font-mono">{displayRequestId(snapshot.id)}</span></div>
                    {snapshot.sorobanOrigin && <div className="mt-2"><span className="font-semibold">Soroban origin:</span> Intent <span className="font-mono">{displayRequestId(snapshot.sorobanOrigin.intentId)}</span> · plan revision {snapshot.sorobanOrigin.authorizationPlanRevision} · prepared {new Date(snapshot.sorobanOrigin.executionPreparedAt).toLocaleString()}</div>}
                    <div className="mt-2">Created {new Date(snapshot.createdAt).toLocaleString()} · signing closes {new Date(snapshot.expiresAt).toLocaleString()}</div>
                    <div className="mt-2">{snapshot.contributionCount} contribution{snapshot.contributionCount === 1 ? '' : 's'} · {snapshot.signatureCount} signature{snapshot.signatureCount === 1 ? '' : 's'}</div>
                    <div className="mt-2 break-all font-mono opacity-60">{snapshot.transactionHash}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <ActionButton variant="secondary" size="sm" onClick={() => void copyXdr()}><ClipboardCopy className="h-3.5 w-3.5" />{copied === 'xdr' ? 'XDR copied' : 'Copy XDR'}</ActionButton>
                      {snapshot.status === 'awaiting_signatures' && <ActionButton variant="secondary" size="sm" aria-expanded={showXdrQr} onClick={() => setShowXdrQr((visible) => !visible)}><QrCode className="h-3.5 w-3.5" />{showXdrQr ? 'Hide QR' : 'Show QR'}</ActionButton>}
                    </div>
                    {snapshot.status === 'awaiting_signatures' && showXdrQr && <div className="mt-4"><XdrQrCode xdr={snapshot.mergedXdr} /></div>}
                  </div>

                  <TransactionInspectorSummary inspection={inspection} status={authorizationStatus} />
                  <TransactionAuthorizationResults inspection={inspection} authorization={authorization} sourceAnalyses={sourceAnalyses} />

                  {snapshot.status === 'awaiting_signatures' && (
                    <div>
                      <div className="text-sm font-semibold">Add a signed XDR manually</div>
                      <p className="mt-1 text-sm opacity-65">Use this for a CLI, hardware signer, or another external signing tool.</p>
                      <form onSubmit={contribute} className="mt-3">
                        <textarea value={signedXdr} onChange={(event) => setSignedXdr(event.target.value)} rows={6} spellCheck={false} placeholder="Signed XDR of this exact transaction..." className="w-full resize-y rounded-xl border border-black/10 bg-transparent p-3 font-mono text-xs leading-5 outline-none focus:border-emerald-500 dark:border-white/10" />
                        <ActionButton type="submit" disabled={contributing || !signedXdr.trim()} className="mt-3">{contributing && <LoaderCircle className="h-4 w-4 animate-spin" />}Add signed XDR</ActionButton>
                      </form>
                    </div>
                  )}
                </div>
              </details>
            </div>
          )}
        </div>
      </main>
    </StellarWorkspaceShell>
  );
}
