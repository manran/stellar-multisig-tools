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
import SaintSecurityTimeline from './SaintSecurityTimeline';
import SorobanEffectsDiffView from './SorobanEffectsDiffView';
import SigningGuidance from './SigningGuidance';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useStellarWallet } from './StellarWalletContext';
import TransactionAuthorizationResults from './TransactionAuthorizationResults';
import TransactionInspectorSummary from './TransactionInspectorSummary';
import XdrQrCode from './XdrQrCode';
import { horizonTransactionUrl } from '../../../packages/stellar-core/src/horizon';
import { isWalletUserRejected } from './stellar/walletKit';
import type { PrivateCommitmentRecord } from '../../../packages/stellar-core/src/privateCommitment';
import type { PrivateNoteRevision } from '../../../packages/stellar-core/src/privateNote';
import { privateSessionAddressHeaders } from '../../../packages/stellar-core/src/privateSessionTransport';
import {
  loadTransactionSourceAnalyses,
  projectTransactionReviewAuthorizationStatus,
} from '../../../packages/stellar-core/src/transactionReviewAnalysis';
import type { SourceAnalysis } from '../../../packages/stellar-core/src/transactionReviewAnalysis';
import { applyRequestLocalEffects } from './stellar/requestLocalEffects';
import { invalidateSignerAccountsCache } from '../../../packages/stellar-core/src/signerAccounts';
import type {
  AssignSigningRequestResponse,
  ContributeSigningRequestResponse,
  CreateSigningRequestResponse,
  RemindSigningRequestResponse,
  SigningRequestApiError,
  SigningRequestAssignment,
  SigningRequestNotificationSummary,
  SigningRequestSnapshot,
  SigningRequestStatus,
  SubmitSigningRequestResponse,
} from '../../../packages/stellar-core/src/requestTypes';
import type { StellarNetwork } from '../../../packages/stellar-core/src/types';
import type { SorobanEffectsDiff } from '../../../packages/stellar-core/src/sorobanEffects';
import { analyzeTransactionAuthorization } from '../../../packages/stellar-core/src/transactionAuthorization';
import { inspectTransactionXdr } from '../../../packages/stellar-core/src/transactionXdr';
import { proposalWorkflowStage } from './stellar/humanWorkflow';
import { describeInboxRequest, proposalNextStep } from './stellar/inboxRequestPresentation';
import { proposalWalletSigningState } from './stellar/proposalAuthorizationPresentation';
import type { TransactionXdrInspection } from '../../../packages/stellar-core/src/transactionXdr';
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
  requestReviewedByAddress?: string;
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
  reviewedByAddress: string;
} {
  const state = window.history.state as RequestNavigationState | null;
  if (!isCurrentWorkspaceNavigationState(state)) {
    return { preview: null, returnTarget: null, justCreated: false, activityBound: false, reviewedByAddress: '' };
  }
  const preview = state?.requestPreview?.id === requestId ? state.requestPreview : null;
  const reviewedByAddress = typeof state?.requestReviewedByAddress === 'string' ? state.requestReviewedByAddress : '';
  if (!state?.returnTo) {
    return { preview, returnTarget: null, justCreated: Boolean(state?.requestJustCreated), activityBound: Boolean(state?.requestActivityBound), reviewedByAddress };
  }
  try {
    const target = new URL(state.returnTo);
    if (target.origin !== window.location.origin) {
      return { preview, returnTarget: null, justCreated: Boolean(state?.requestJustCreated), activityBound: Boolean(state?.requestActivityBound), reviewedByAddress };
    }
    return {
      preview,
      returnTarget: { href: target.toString(), label: state.returnLabel?.trim() || 'Back' },
      justCreated: Boolean(state.requestJustCreated),
      activityBound: Boolean(state.requestActivityBound),
      reviewedByAddress,
    };
  } catch {
    return { preview, returnTarget: null, justCreated: Boolean(state?.requestJustCreated), activityBound: Boolean(state?.requestActivityBound), reviewedByAddress };
  }
}

export default function RequestApp() {
  const initialLocator = window.location.hash.slice(1);
  const initialRequest = parseRequestLocator(initialLocator);
  const navigation = useMemo(() => requestNavigationState(initialRequest.id), []);
  const returnTarget = useMemo(() => navigation.returnTarget ?? sameOriginReturnTarget(), [navigation]);
  const initialPreview = navigation.preview;
  const activeLoad = useRef<AbortController | null>(null);
  const activePoll = useRef<AbortController | null>(null);
  const snapshotRevision = useRef(0);
  const accessScopeRef = useRef({});
  const accessScope = accessScopeRef.current;
  const [requestLocator, setRequestLocator] = useState(initialLocator);
  const [capability, setCapability] = useState(initialRequest.capability);
  const [shareable, setShareable] = useState(Boolean(initialRequest.capability));
  const [activityBound, setActivityBound] = useState(navigation.activityBound);
  const [shareJustCreated, setShareJustCreated] = useState(navigation.justCreated);
  const [assignmentApiAvailable, setAssignmentApiAvailable] = useState(false);
  const [assignments, setAssignments] = useState<SigningRequestAssignment[]>([]);
  const [notifications, setNotifications] = useState<SigningRequestNotificationSummary[]>([]);
  const [storedSnapshot, setSnapshot] = useState<SigningRequestSnapshot | null>(initialPreview);
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
  const [focusSection, setFocusSection] = useState<'review' | 'signatures' | 'submission' | 'issue' | null>(null);
  const [pendingRetention, setPendingRetention] = useState<{ id: string; address: string } | null>(null);
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
    lock,
  } = useStellarWallet();

  const viewerRef = useRef({ address: walletAddress, network: walletNetwork, unlocked: privateUnlocked });
  if (viewerRef.current.address !== walletAddress || viewerRef.current.network !== walletNetwork || viewerRef.current.unlocked !== privateUnlocked) {
    viewerRef.current = { address: walletAddress, network: walletNetwork, unlocked: privateUnlocked };
  }
  const viewer = viewerRef.current;
  const [loadedViewer, setLoadedViewer] = useState<typeof viewer | null>(null);
  const snapshot = loadedViewer === viewer && (capability || privateUnlocked) ? storedSnapshot : null;

  function isCurrentView() {
    return viewerRef.current === viewer && accessScopeRef.current === accessScope;
  }

  const authorization = useMemo(() => {
    if (!snapshot || !inspection) return null;
    return analyzeTransactionAuthorization(snapshot.mergedXdr, snapshot.network, inspection, sourceAnalyses);
  }, [snapshot, inspection, sourceAnalyses]);
  const walletSigningState = proposalWalletSigningState(authorization, sourceAnalyses, walletAddress);
  const walletAlreadySigned = walletSigningState === 'signed';
  const signaturesComplete = Boolean(
    authorization?.coreAuthorizationValid
    || snapshot?.status === 'ready'
    || snapshot?.status === 'waiting_preconditions'
    || snapshot?.status === 'submitted',
  );
  const proposalDescription = useMemo(() => snapshot ? describeInboxRequest(snapshot) : null, [snapshot]);
  const authorizationStatus = projectTransactionReviewAuthorizationStatus(authorization);
  const isSorobanTransaction = Boolean(inspection?.operations.some((operation) => operation.type === 'invokeHostFunction'));
  const executionAlreadyRoutedToMst = snapshot?.execution?.mode === 'multisigtools' || isSorobanTransaction;
  const workflowStage = snapshot
    ? proposalWorkflowStage(snapshot.status, { reviewComplete, signaturesComplete })
    : 'sign';
  const nextStep = snapshot ? proposalNextStep(snapshot.status, {
    reviewComplete,
    walletAlreadySigned,
    walletSigningState,
    executionMode: snapshot.execution?.mode,
    executionRoutedToMst: executionAlreadyRoutedToMst,
    statusReason: snapshot.statusReason,
  }) : null;
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
    : snapshot?.status === 'ready'
      ? 'Back to submission'
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
    if (!isCurrentView()) return false;
    const revision = ++snapshotRevision.current;
    const parsed = inspectTransactionXdr(next.mergedXdr, next.network);
    const sameRequest = snapshot?.id === next.id;
    const reviewedAtCreation = navigation.justCreated && viewer.unlocked
      && navigation.reviewedByAddress === viewer.address
      && viewer.network === next.network
      && initialPreview?.transactionHash === next.transactionHash
      && initialPreview.network === next.network;
    if (next.status !== 'awaiting_signatures') setReviewComplete(true);
    else if (!sameRequest) setReviewComplete(reviewedAtCreation);
    if (next.status !== 'awaiting_signatures' || !sameRequest) setContributionMessage('');
    setSnapshot(next);
    setLoadedViewer(viewer);
    setInspection(parsed);
    if (!sameRequest) setSourceAnalyses([]);
    window.history.replaceState({
      ...(window.history.state ?? {}),
      requestPreview: next,
    }, '');
    const analyses = await loadTransactionSourceAnalyses(parsed, next.network);
    if (!isCurrentView() || snapshotRevision.current !== revision) return false;
    setSourceAnalyses(analyses);
    return true;
  }

  function clearPrivateRequestView(invalidateAccess = true) {
    if (invalidateAccess) {
      accessScopeRef.current = {};
      activeLoad.current?.abort();
    }
    snapshotRevision.current += 1;
    activePoll.current?.abort();
    setLoading(false);
    setSnapshot(null);
    setInspection(null);
    setPrivateNote(null);
    setPrivateCommitment(null);
    setAssignmentApiAvailable(false);
    setAssignments([]);
    setNotifications([]);
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
    activeLoad.current?.abort();
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
    const controller = new AbortController();
    activeLoad.current = controller;
    try {
      const body = await apiJson<CreateSigningRequestResponse>(await fetch('/api/request', {
        cache: 'no-store',
        headers: requestHeaders(locator.id, locator.capability, walletAddress),
        signal: controller.signal,
      }));
      if (controller.signal.aborted || !isCurrentView()) return;
      if (
        locator.capability
        && body.access?.activityBound
        && isClosedCapabilityStatus(body.request.status)
      ) {
        navigateWorkspace('/activity');
        return;
      }
      if (!await applySnapshot(body.request) || controller.signal.aborted) return;
      setPrivateNote(body.context?.privateNote ?? null);
      setPrivateCommitment(body.context?.privateCommitment ?? null);
      setAssignmentApiAvailable(Boolean(body.coordination));
      setAssignments(body.coordination?.assignments ?? []);
      setNotifications(body.coordination?.notifications ?? []);
      const normalized = requestLocatorString(body.request.id, locator.capability);
      setRequestLocator(normalized);
      setCapability(locator.capability);
      setShareable(body.access?.shareable ?? Boolean(locator.capability));
      setActivityBound(body.access?.activityBound ?? false);
      setContributionGrantExpiresAt(body.access?.contributionGrantExpiresAt ?? null);
      window.history.replaceState(window.history.state ?? {}, '', requestUrl(body.request.id, locator.capability));
    } catch (cause) {
      if (controller.signal.aborted || !isCurrentView()) return;
      if (cause instanceof RequestApiError && cause.code === 'request_capability_closed') {
        applyClosedCapabilityError(cause);
        return;
      }
      const accessDenied = cause instanceof RequestApiError && cause.code === 'request_access_denied';
      setRequestNeedsUnlock(false);
      setRequestAccessDenied(accessDenied);
      if (accessDenied) {
        clearPrivateRequestView();
      } else if (!initialPreview) {
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
      if (activeLoad.current === controller && isCurrentView()) {
        setLoading(false);
        activeLoad.current = null;
      }
    }
  }

  useEffect(() => {
    if (loadedViewer !== viewer) {
      clearPrivateRequestView(false);
      setContributing(false);
      setSubmitting(false);
      setSubmitArmed(false);
      setMainnetConfirmed(false);
      setContributionMessage('');
      setSubmissionEffectsDiff(null);
    }
    if (requestLocator.trim()) void load(requestLocator);
    return () => activeLoad.current?.abort();
  }, [viewer]);

  useEffect(() => {
    if (!focusSection) return;
    const section = document.getElementById(`proposal-${focusSection}`);
    section?.focus({ preventScroll: true });
    section?.scrollIntoView({ block: 'start' });
    setFocusSection(null);
  }, [focusSection, reviewComplete]);

  useEffect(() => {
    if (!pendingRetention || !privateReadyForRequest || !snapshot) return;
    setPendingRetention(null);
    if (pendingRetention.id === snapshot.id && pendingRetention.address === walletAddress) void saveToActivity();
  }, [pendingRetention, privateReadyForRequest, snapshot?.id, walletAddress]);

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
    const controller = new AbortController();
    activePoll.current = controller;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void (async () => {
        try {
          const body = await apiJson<CreateSigningRequestResponse>(await fetch('/api/request', {
            cache: 'no-store',
            headers: requestHeaders(id, capability, walletAddress),
            signal: controller.signal,
          }));
          if (controller.signal.aborted || !isCurrentView()) return;
          const requestChanged = body.request.mergedXdr !== currentMergedXdr
            || body.request.status !== currentStatus;
          if (requestChanged) {
            if (!await applySnapshot(body.request) || controller.signal.aborted) return;
          }
          else setSnapshot(body.request);
          setPrivateNote(body.context?.privateNote ?? null);
          setPrivateCommitment(body.context?.privateCommitment ?? null);
          setAssignmentApiAvailable(Boolean(body.coordination));
          setAssignments(body.coordination?.assignments ?? []);
          setNotifications(body.coordination?.notifications ?? []);
          if (body.access) {
            setShareable(body.access.shareable);
            setActivityBound(body.access.activityBound ?? false);
            setContributionGrantExpiresAt(body.access.contributionGrantExpiresAt ?? null);
          }
        } catch (cause) {
          if (controller.signal.aborted || !isCurrentView()) return;
          if (cause instanceof RequestApiError && cause.code === 'request_capability_closed') {
            applyClosedCapabilityError(cause);
          } else if (cause instanceof RequestApiError && cause.code === 'request_access_denied') {
            clearPrivateRequestView();
            setRequestAccessDenied(true);
            setRequestNeedsUnlock(false);
          }
          // Keep the last known state for transient failures; explicit refresh surfaces them.
        }
      })();
    }, REQUEST_POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      controller.abort();
      if (activePoll.current === controller) activePoll.current = null;
    };
  }, [snapshot?.id, snapshot?.status, snapshot?.mergedXdr, capability, viewer]);

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
      if (!await applySnapshot(body.request)) return;
      setShareable(body.access?.shareable ?? shareable);
      setActivityBound(body.access?.activityBound ?? false);
    } catch (cause) {
      if (isCurrentView()) setError(cause instanceof Error ? cause.message : 'Unable to save this proposal to Activity.');
    } finally {
      if (isCurrentView()) setLoading(false);
    }
  }

  async function addSignatureContribution(signedCopy: string) {
    if (!snapshot || !isCurrentView()) return;
    const body = await apiJson<ContributeSigningRequestResponse>(await fetch('/api/request', {
      method: 'PATCH',
      headers: requestHeaders(snapshot.id, capability, walletAddress, true),
      body: JSON.stringify({ signedXdr: signedCopy.trim() }),
    }));
    if (!await applySnapshot(body.request)) return;
    if (body.access?.contributionGrantExpiresAt) setContributionGrantExpiresAt(body.access.contributionGrantExpiresAt);
    setContributionMessage(body.request.status === 'awaiting_signatures'
      ? body.addedSignatureCount > 0
        ? `Added ${body.addedSignatureCount} signature${body.addedSignatureCount === 1 ? '' : 's'}.`
        : 'No new signature was added; this signed copy was already represented.'
      : '');
  }

  async function contribute(event: FormEvent) {
    event.preventDefault();
    if (!snapshot || snapshot.status !== 'awaiting_signatures' || contributing || !signedXdr.trim()) return;
    setContributing(true);
    setError('');
    setContributionMessage('');
    try {
      await addSignatureContribution(signedXdr);
      setSignedXdr('');
    } catch (cause) {
      if (isCurrentView()) setError(cause instanceof Error ? cause.message : 'Unable to add this signed copy.');
    } finally {
      if (isCurrentView()) setContributing(false);
    }
  }

  async function signRequestWithWallet() {
    if (!snapshot || snapshot.status !== 'awaiting_signatures' || contributing || walletBusy) return;
    setContributing(true);
    setError('');
    setContributionMessage('');
    try {
      const signedCopy = await signWithWallet(snapshot.mergedXdr, snapshot.network);
      await addSignatureContribution(signedCopy);
    } catch (cause) {
      if (isCurrentView() && !isWalletUserRejected(cause)) setError(cause instanceof Error ? cause.message : 'The wallet could not sign this transaction.');
    } finally {
      if (isCurrentView()) setContributing(false);
    }
  }

  async function submitRequest(acceptedEffectsDigest?: string) {
    if (!snapshot || snapshot.status !== 'ready' || submitting) return;
    if (snapshot.execution?.mode === 'external' || submissionEffectsDiff?.requiresReauthorization) return;
    if (!submitArmed && !executionAlreadyRoutedToMst) return;
    if (snapshot.network === 'public' && !mainnetConfirmed) return;
    setSubmitting(true);
    setError('');
    try {
      const body = await apiJson<SubmitSigningRequestResponse>(await fetch('/api/request', {
        method: 'PUT',
        headers: requestHeaders(snapshot.id, capability, walletAddress, Boolean(acceptedEffectsDigest)),
        ...(acceptedEffectsDigest ? { body: JSON.stringify({ acceptedEffectsDigest }) } : {}),
      }));
      if (!await applySnapshot(body.request)) return;
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
      if (!isCurrentView()) return;
      if (cause instanceof RequestApiError
        && (cause.code === 'soroban_effects_review_required' || cause.code === 'soroban_effects_reauthorization_required')
        && cause.details?.effectsDiff) {
        setSubmissionEffectsDiff(cause.details.effectsDiff);
        if (cause.code === 'soroban_effects_reauthorization_required') setSubmitArmed(false);
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Unable to submit this transaction.');
    } finally {
      if (isCurrentView()) setSubmitting(false);
    }
  }

  async function askSignerToSign(signerAddress: string): Promise<AssignSigningRequestResponse['notification']> {
    if (!snapshot || !shareable || !walletAddress || !privateReadyForRequest) {
      throw new Error('Confirm your current signer wallet before asking someone to sign.');
    }
    const body = await apiJson<AssignSigningRequestResponse>(await fetch('/api/request', {
      method: 'PATCH',
      headers: requestHeaders(snapshot.id, capability, walletAddress, true),
      body: JSON.stringify({ assignSigner: signerAddress }),
    }));
    if (!isCurrentView()) return undefined;
    setAssignments(body.coordination.assignments);
    setNotifications(body.coordination.notifications);
    return body.notification;
  }

  async function remindSignerToSign(signerAddress: string): Promise<RemindSigningRequestResponse['notification']> {
    if (!snapshot || !shareable || !walletAddress || !privateReadyForRequest) {
      throw new Error('Confirm the signer wallet that sent the original request before sending a reminder.');
    }
    const body = await apiJson<RemindSigningRequestResponse>(await fetch('/api/request', {
      method: 'PATCH',
      headers: requestHeaders(snapshot.id, capability, walletAddress, true),
      body: JSON.stringify({ remindSigner: signerAddress }),
    }));
    if (!isCurrentView()) throw new Error('The wallet changed. Open the proposal with the current signer to check the reminder.');
    setAssignments(body.coordination.assignments);
    setNotifications(body.coordination.notifications);
    return body.notification;
  }

  async function copyLink() {
    if (!snapshot || !shareable) return;
    setCopied(null);
    setError('');
    try {
      await navigator.clipboard.writeText(requestUrl(snapshot.id, capability));
      setCopied('link');
    } catch {
      setError('Could not copy the private link. Allow clipboard access, then try again.');
    }
  }

  async function copyXdr() {
    if (!snapshot) return;
    setCopied(null);
    setError('');
    try {
      await navigator.clipboard.writeText(snapshot.mergedXdr);
      setCopied('xdr');
    } catch {
      setError('Could not copy the transaction. Allow clipboard access, then try again.');
    }
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
      if (!privateReadyForRequest) await unlock(undefined, requestNetwork ?? undefined);
      navigateWorkspace('/activity');
    } catch (cause) {
      if (!isWalletUserRejected(cause)) setError(cause instanceof Error ? cause.message : 'Unable to confirm this wallet.');
    }
  }

  async function chooseSignerWallet() {
    setError('');
    try {
      if (requestAccessDenied && privateUnlocked) await lock();
      await connectWallet();
    } catch (cause) {
      if (!isWalletUserRejected(cause)) setError(cause instanceof Error ? cause.message : 'Unable to choose a signer wallet.');
    }
  }

  function openCurrentStep() {
    if (!nextStep) return;
    if (nextStep.action.target === 'receipt') {
      void openTransactionReceipt();
      return;
    }
    setReviewComplete(nextStep.action.target !== 'review');
    setFocusSection(nextStep.action.target);
  }

  const closedLinkTitle = closedCapability?.status === 'submitted'
    ? 'Transaction confirmed'
    : closedCapability?.status === 'expired' ? 'This private link has expired' : 'This private link is closed';
  const closedLinkDescription = closedCapability?.status === 'submitted'
    ? 'Confirmed on Stellar. This private link is closed. An associated wallet can open the transaction receipt in Activity.'
    : 'This link no longer opens private details. An associated wallet can check the proposal and its latest network result in Activity.';

  return (
    <StellarWorkspaceShell active="detail" networkContext={requestNetwork}>
      <main className="mst-workbench-page">
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
                {closedCapability.status === 'submitted' ? <CheckCircle2 className="h-8 w-8 text-[var(--color-success)]" /> : <CircleAlert className="h-8 w-8 text-[var(--color-muted)]" />}
                <h1 className="mt-5 text-4xl font-bold tracking-tight">{closedLinkTitle}</h1>
                <p className="mt-3 text-lg leading-8 text-neutral-600 dark:text-neutral-300">{closedLinkDescription}</p>
                <ActionButton onClick={() => navigateWorkspace('/activity')} className="mt-7">View Activity</ActionButton>
              </section>
            ) : (
              <PrivateWorkspaceUnlock
                title={closedLinkTitle}
                description={closedLinkDescription}
                buttonLabel="Open Activity"
                network={requestNetwork ?? undefined}
                onUnlocked={() => navigateWorkspace('/activity')}
              />
            )
          )}

          {!snapshot && (requestNeedsUnlock || requestAccessDenied) && !privateUnlocked && (
            <PrivateWorkspaceUnlock
              title="Open your proposal"
              description="Use a current signer wallet to open this private proposal. You can review the transaction before deciding whether to sign."
              buttonLabel="Open proposal"
              network={requestNetwork ?? undefined}
              context={<span className="break-all font-mono">Proposal {displayRequestId(parseRequestLocator(requestLocator).id)}</span>}
            />
          )}

          {!snapshot && requestAccessDenied && privateUnlocked && (
            <section className="mx-auto max-w-xl py-12 sm:py-20">
              <CircleAlert className="h-8 w-8 text-amber-600 dark:text-amber-300" />
              <h1 className="mt-5 text-4xl font-bold tracking-tight">This wallet cannot open this proposal</h1>
              <p className="mt-3 text-lg leading-8 text-neutral-600 dark:text-neutral-300">The current wallet session could not open this proposal. Confirm a current signer wallet again, or choose another signer.</p>
              <ActionButton disabled={walletBusy} onClick={() => void chooseSignerWallet()} className="mt-7">{walletBusy ? 'Opening wallets…' : 'Choose another signer wallet'}</ActionButton>
            </section>
          )}

          {!closedCapability && !requestAccessDenied && !requestNeedsUnlock && !snapshot && (!loading || !initialLocator) && (
            <section className="mx-auto max-w-2xl py-8 sm:py-14">
              <Share2 className="h-7 w-7 text-emerald-600 dark:text-emerald-300" />
              <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">Open a shared transaction</h1>
              <p className="mt-2 text-base leading-7 text-neutral-600 dark:text-neutral-300">Paste a private MultiSigTools link, or a proposal ID and confirm one of its current signer wallets.</p>

              <form onSubmit={submitLookup} className="mst-request-lookup-form mt-7">
                <label htmlFor="request-locator" className="text-sm font-semibold">Private link or proposal ID</label>
                <input id="request-locator" value={requestLocator} onChange={(event) => setRequestLocator(event.target.value)} placeholder="Paste shared transaction link" spellCheck={false} className="mst-request-control mt-2 w-full" />
                <ActionButton type="submit" disabled={loading || !requestLocator.trim()} className="mt-3">{loading && <LoaderCircle className="h-4 w-4 animate-spin" />}Open transaction</ActionButton>
              </form>
              <p className="mt-5 text-sm text-neutral-500 dark:text-neutral-400">Have XDR instead? Use <a href={stellarHref('/new/import')} className="whitespace-nowrap font-semibold text-emerald-700 dark:text-emerald-300">New → Import transaction</a>.</p>
            </section>
          )}

          {error && <div role="alert" className="mt-5 flex gap-3 rounded-2xl border border-[var(--color-danger)] p-4 text-sm text-[var(--color-danger)]"><CircleAlert className="h-5 w-5 shrink-0" />{error}</div>}

          {snapshot && inspection && (
            <div className="mst-proposal-workbench space-y-5">
              {returnTarget && (
                <a href={returnTarget.href} className="inline-flex text-sm font-semibold text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white">← {returnTarget.label}</a>
              )}

              <PageHeader
                eyebrow={<div className="flex flex-wrap items-center gap-2"><span className="text-[var(--color-muted)]">Proposal</span><RequestStatusBadge status={snapshot.status} /><NetworkFact network={snapshot.network} /></div>}
                title={proposalDescription?.title ?? 'Proposal'}
                description={proposalDescription?.summary}
                meta={<><span className="font-mono">ID {displayRequestId(snapshot.id)}</span>{!['submitted', 'expired', 'stale', 'blocked'].includes(snapshot.status) && <span>Signing closes <time dateTime={snapshot.expiresAt}>{new Date(snapshot.expiresAt).toLocaleString()}</time></span>}</>}
                actions={
                  <>
                    <ActionButton variant="secondary" size="sm" className="min-h-11" onClick={() => void load(requestLocatorString(snapshot.id, capability))} disabled={loading}>
                      <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh
                    </ActionButton>
                    {shareable && (
                      <ActionButton variant="secondary" size="sm" className="min-h-11" onClick={() => void copyLink()}>
                        <ClipboardCopy className="h-4 w-4" />{copied === 'link' ? 'Copied' : 'Copy private link'}
                      </ActionButton>
                    )}
                  </>
                }
              />

              {nextStep && (
                <section aria-label="Current proposal step" className="mst-proposal-task">
                  <div className="mst-proposal-task__text">
                    <p className="mst-proposal-task__label">{nextStep.heading}</p>
                    <h2>{nextStep.title}</h2>
                    <p className="mst-proposal-task__detail">{nextStep.detail}</p>
                  </div>
                  <div className="mst-proposal-task__actions">
                    <ActionButton variant={nextStep.heading === 'Next step' ? 'primary' : 'secondary'} onClick={openCurrentStep}>{nextStep.action.label}</ActionButton>
                    {walletAlreadySigned && <a href={stellarHref('/inbox')} className="mst-proposal-task__back">Back to Inbox</a>}
                  </div>
                </section>
              )}

              <div className="mst-proposal-progress" aria-label="Transaction workflow">
                <WorkflowProgress current={workflowStage} />
              </div>

              {import.meta.env.VITE_SAINT_SECURITY_TIMELINE_ENABLED === 'true'
                && snapshot.network === 'testnet'
                && privateReadyForRequest
                && inspection.transactionSourceAccount.startsWith('G')
                && <SaintSecurityTimeline
                  key={snapshot.id + ':' + inspection.transactionSourceAccount}
                  address={inspection.transactionSourceAccount}
                  createdAt={snapshot.createdAt}
                />}

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
                  <button type="button" onClick={() => setShareJustCreated(false)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--color-muted)] hover:bg-[var(--color-paper-3)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]" aria-label="Dismiss private link reminder"><X className="h-4 w-4" /></button>
                </section>
              )}

              {activeCapabilityNeedsActivity && (
                privateReadyForRequest ? (
                  <section className="mst-request-context-row">
                    <div className="text-neutral-600 dark:text-neutral-300">Not saved to Activity. Private links close after submission or expiry.</div>
                    <button type="button" disabled={loading} onClick={() => void saveToActivity()} className="font-semibold text-emerald-700 disabled:opacity-50 dark:text-emerald-300">Save to Activity</button>
                  </section>
                ) : (
                  <ActivityRetentionNotice status={snapshot.status} network={snapshot.network} onUnlocked={(address) => setPendingRetention({ id: snapshot.id, address })} />
                )
              )}

              {!reviewComplete ? (
                <section id="proposal-review" tabIndex={-1} className="scroll-mt-24 space-y-5 focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]">
                  <ReviewTransactionSummary inspection={inspection} xdr={snapshot.mergedXdr} sourceAccount={sourceAnalyses.find((analysis) => analysis.accountId === inspection.transactionSourceAccount)?.account ?? null} privateCommitment={privateCommitment} />
                  {!privateCommitment && privateNote && <PrivateNoteCard note={privateNote} busy={false} locked />}
                  <div className="flex justify-end">
                    <ActionButton onClick={() => setReviewComplete(true)}>{reviewContinueLabel}</ActionButton>
                  </div>
                </section>
              ) : (
                <>
                  <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--color-rule)] bg-[var(--color-paper-2)] px-4 py-3 sm:px-5">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-5 w-5 text-[var(--color-ink-2)]" />
                      <div><div className="text-sm font-semibold">Transaction details</div><div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">Open the exact transaction at any time.</div></div>
                    </div>
                    <button type="button" onClick={() => setReviewComplete(false)} className="min-h-11 text-sm font-semibold text-[var(--color-accent)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]">Review details</button>
                  </section>

                  {contributionMessage && <div role="status" className="flex gap-2 rounded-xl border border-[var(--color-success)] p-4 text-sm text-[var(--color-success)]"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{contributionMessage}</div>}

                  {!['ready', 'waiting_preconditions', 'submitted', 'expired', 'stale', 'blocked'].includes(snapshot.status) && <section id="proposal-signatures" tabIndex={-1} className="scroll-mt-24 focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]">
                  <SigningGuidance
                    inspection={inspection}
                    authorization={authorization}
                    sourceAnalyses={sourceAnalyses}
                    walletAddress={walletAddress}
                    creatorAddress={snapshot.creatorAddress}
                    walletBusy={walletBusy || contributing}
                    walletError={walletError}
                    onConnectWallet={() => void chooseSignerWallet()}
                    onSignWithWallet={() => void signRequestWithWallet()}
                    onShare={shareable ? () => requestUrl(snapshot.id, capability) : undefined}
                    onAsk={snapshot.status === 'awaiting_signatures' && shareable && privateReadyForRequest && assignmentApiAvailable ? askSignerToSign : undefined}
                    onRemind={snapshot.status === 'awaiting_signatures' && shareable && privateReadyForRequest && assignmentApiAvailable ? remindSignerToSign : undefined}
                    assignments={assignments}
                    notifications={notifications}
