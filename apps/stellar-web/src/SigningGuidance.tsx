import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, LoaderCircle, Mail, Share2, WalletCards, X } from 'lucide-react';
import AddressAliasEditor from './AddressAliasEditor';
import AddressIdentity from './AddressIdentity';
import { ActionButton } from './MultiSigUi';
import { useAddressBook } from './AddressBookContext';
import { useStellarWallet } from './StellarWalletContext';
import { cachedTreasuryNames, loadSharedTreasuryNames } from './treasuryMetadataCache';
import { treasuryDisplayLabel } from './treasuryDisplay';
import { humanAuthorizationRequirement } from './stellar/authorizationPresentation';
import { proposalWalletSigningState, weightedProposalRequirements } from './stellar/proposalAuthorizationPresentation';
import type { SourceAnalysis } from '../../../packages/stellar-core/src/transactionReviewAnalysis';
import type { TransactionAuthorizationStatus } from '../../../packages/stellar-core/src/transactionAuthorization';
import type {
  SigningRequestAssignment,
  SigningRequestNotificationStatus,
  SigningRequestNotificationSummary,
} from '../../../packages/stellar-core/src/requestTypes';
import type { TransactionXdrInspection } from '../../../packages/stellar-core/src/transactionXdr';

interface Props {
  inspection: TransactionXdrInspection;
  authorization: TransactionAuthorizationStatus | null;
  sourceAnalyses: SourceAnalysis[];
  walletAddress: string;
  creatorAddress?: string;
  walletBusy: boolean;
  walletError: string;
  onConnectWallet: () => void;
  onSignWithWallet: () => void;
  onShare?: () => void | string | Promise<void | string>;
  onAsk?: (signerAddress: string) => Promise<{ channel: 'email'; status: SigningRequestNotificationStatus } | undefined>;
  onRemind?: (signerAddress: string) => Promise<{ channel: 'email'; status: Exclude<SigningRequestNotificationStatus, 'already_queued'> }>;
  assignments?: readonly SigningRequestAssignment[];
  notifications?: readonly SigningRequestNotificationSummary[];
  shareCreatesLink?: boolean;
  approvalPersisted?: boolean;
  knownComplete?: boolean;
}

export default function SigningGuidance({
  inspection,
  authorization,
  sourceAnalyses,
  walletAddress,
  creatorAddress,
  walletBusy,
  walletError,
  onConnectWallet,
  onSignWithWallet,
  onShare,
  onAsk,
  onRemind,
  assignments = [],
  notifications = [],
  shareCreatesLink = false,
  approvalPersisted = true,
  knownComplete = false,
}: Props) {
  const { labelFor, emailFor } = useAddressBook();
  const { sessionAddress, privateUnlocked } = useStellarWallet();
  const [shareBusy, setShareBusy] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [shareError, setShareError] = useState('');
  const [shareCopied, setShareCopied] = useState(false);
  const [askBusy, setAskBusy] = useState('');
  const [inviteSelection, setInviteSelection] = useState<string[]>([]);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteFeedback, setInviteFeedback] = useState('');
  const [askError, setAskError] = useState<{ address: string; message: string } | null>(null);
  const allowNaming = Boolean(sessionAddress);
  const requirementAccountIds = inspection.sourceRequirements.map((requirement) => requirement.accountId);
  const requirementAccountKey = requirementAccountIds.join('|');
  const [treasuryNames, setTreasuryNames] = useState<Record<string, string>>(() =>
    cachedTreasuryNames(sessionStorage, inspection.network, requirementAccountIds),
  );

  useEffect(() => {
    const cached = cachedTreasuryNames(sessionStorage, inspection.network, requirementAccountIds);
    setTreasuryNames(cached);
    if (!privateUnlocked || !sessionAddress || requirementAccountIds.length === 0) return;
    const controller = new AbortController();
    void loadSharedTreasuryNames(requirementAccountIds, inspection.network, sessionAddress, controller.signal)
      .then((names) => { if (!controller.signal.aborted) setTreasuryNames(names); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [inspection.network, privateUnlocked, sessionAddress, requirementAccountKey]);

  const isSigningSetup = inspection.operations.length > 0
    && inspection.operations.every((operation) => operation.type === 'setOptions')
    && inspection.operations.some((operation) => operation.fields.some((field) => ['Signer weight', 'Master weight', 'Medium threshold', 'High threshold'].includes(field.label)));

  const entries = inspection.sourceRequirements.map((requirement) => {
    const loaded = sourceAnalyses.find((item) => item.accountId === requirement.accountId);
    const auth = authorization?.sources.find((item) =>
      item.accountId === requirement.accountId && item.scope === requirement.scope,
    );
    const policy = loaded?.analysis?.thresholds[requirement.threshold];
    const eligibleSignerKeys = (loaded?.account?.signers ?? [])
      .filter((signer) => signer.weight > 0 && signer.type === 'ed25519_public_key')
      .map((signer) => signer.key);
    const matchedKeys = new Set(
      (auth?.matchedSigners ?? [])
        .filter((signer) => !signer.automatic)
        .map((signer) => signer.signerKey),
    );
    const matchedSignerKeys = eligibleSignerKeys.filter((key) => matchedKeys.has(key));
    const remainingSignerKeys = eligibleSignerKeys.filter((key) => !matchedKeys.has(key));
    const signaturesRemaining = policy?.exactNOfM
      ? Math.max(0, policy.exactNOfM.required - matchedSignerKeys.length)
      : null;

    return {
      requirement,
      auth,
      policy,
      eligibleSignerKeys,
      matchedSignerKeys,
      remainingSignerKeys,
      signaturesRemaining,
      error: loaded?.error,
    };
  });

  const incomplete = entries.filter((entry) => entry.auth?.satisfied !== true);
  const missingExtraSigners = (authorization?.extraSigners ?? []).filter((signer) => !signer.satisfied);
  const neededWalletKeys = new Set([
    ...incomplete.flatMap((entry) => entry.remainingSignerKeys),
    ...missingExtraSigners.filter((signer) => signer.signerType === 'ed25519_public_key').map((signer) => signer.signerKey),
  ]);
  const walletSigningState = proposalWalletSigningState(authorization, sourceAnalyses, walletAddress);
  const walletCanSign = walletSigningState === 'can_sign';
  const walletAlreadySigned = walletSigningState === 'signed';
  const weightedRequirements = weightedProposalRequirements(authorization, sourceAnalyses);
  const authorizationComplete = knownComplete || authorization?.coreAuthorizationValid === true;
  const hasAuthorizationError = !knownComplete
    && authorization?.signatureRequirementsSatisfied === true
    && authorization.coreAuthorizationValid === false;
  const exactSignaturesRemaining = missingExtraSigners.length === 0 && incomplete.every((entry) => entry.signaturesRemaining !== null)
    ? incomplete.reduce((total, entry) => total + (entry.signaturesRemaining ?? 0), 0)
    : null;
  const shareTargets = [...neededWalletKeys].filter((key) => key !== walletAddress);
  const inviteCandidates = shareTargets.filter((key) =>
    Boolean(emailFor(key))
    && !assignments.some((assignment) => assignment.signerAddress === key));
  const inviteSelectedNow = inviteSelection.filter((key) => inviteCandidates.includes(key));
  const isCreator = Boolean(sessionAddress && creatorAddress === sessionAddress);
  const unaskedTargets = shareTargets.filter((key) =>
    !assignments.some((assignment) => assignment.signerAddress === key));

  const shouldShowShare = shareTargets.length > 0 || (!walletAddress && neededWalletKeys.size > 0);
  const remainingSignatureCopy = exactSignaturesRemaining === null
    ? 'More signatures are still needed.'
    : exactSignaturesRemaining === 1
      ? '1 more signer needs to sign.'
      : `${exactSignaturesRemaining} more signatures are needed.`;
  const signedStateCopy = authorizationComplete ? 'Signed' : 'Signed · ' + remainingSignatureCopy;

  useEffect(() => {
    if (!shareCopied) return;
    const timer = window.setTimeout(() => setShareCopied(false), 2_000);
    return () => window.clearTimeout(timer);
  }, [shareCopied]);

  async function copyShareLink() {
    if (!shareLink) return;
    await navigator.clipboard.writeText(shareLink);
    setShareCopied(true);
  }

  async function askSigner(signerAddress: string) {
    if (!onAsk || !emailFor(signerAddress)) return;
    setAskBusy(signerAddress);
    setAskError(null);
    try {
      const notification = await onAsk(signerAddress);
      if (notification?.status === 'enqueue_failed') {
        setAskError({
          address: signerAddress,
          message: 'Assignment saved, but the email notification could not be queued. Retry email.',
        });
      } else if (notification?.status === 'no_contact_email') {
        setAskError({
          address: signerAddress,
          message: 'The server could not find this contact email. Re-save the contact and retry.',
        });
      }
    } catch (cause) {
      setAskError({
        address: signerAddress,
        message: cause instanceof Error ? cause.message : 'Unable to ask this signer.',
      });
    } finally {
      setAskBusy('');
    }
  }

  async function inviteSelectedSigners() {
    if (!onAsk || inviteBusy || inviteSelectedNow.length === 0) return;
    setInviteBusy(true);
    setInviteFeedback('');
    let invited = 0;
    const remaining: string[] = [];
    for (const address of inviteSelectedNow) {
      try {
        const result = await onAsk(address);
        if (!result || result.status === 'enqueue_failed' || result.status === 'no_contact_email') {
          remaining.push(address);
        } else {
          invited += 1;
        }
      } catch {
        remaining.push(address);
      }
    }
    setInviteSelection(remaining);
    setInviteFeedback(
      remaining.length > 0
        ? invited + ' invited. ' + remaining.length + ' could not be notified. Check the contact email and try again.'
        : invited + ' signer' + (invited === 1 ? '' : 's') + ' invited. Follow their progress below.',
    );
    setInviteBusy(false);
  }

  async function remindSigner(signerAddress: string) {
    if (!onRemind) return;
    setAskBusy(signerAddress);
    setAskError(null);
    try {
      const notification = await onRemind(signerAddress);
      if (notification.status === 'enqueue_failed') {
        setAskError({
          address: signerAddress,
          message: 'The reminder could not be queued. Try again.',
        });
      } else if (notification.status === 'no_contact_email') {
        setAskError({
          address: signerAddress,
          message: 'The saved contact no longer has an email address.',
        });
      }
    } catch (cause) {
      setAskError({
        address: signerAddress,
        message: cause instanceof Error ? cause.message : 'Unable to remind this signer.',
      });
    } finally {
      setAskBusy('');
    }
  }

  function signerContactControl(signerAddress: string) {
    if (signerAddress === walletAddress || !neededWalletKeys.has(signerAddress)) return null;
    const email = emailFor(signerAddress);
    const alias = labelFor(signerAddress, 'signer');
    const askLabel = alias && alias.length <= 18 ? `Ask ${alias} to sign` : 'Ask to sign';
    const assignment = assignments.find((item) => item.signerAddress === signerAddress);
    const assigned = Boolean(assignment);
    const viewed = Boolean(assignment?.viewedAt);
    const assignedByMe = Boolean(assignment && sessionAddress && assignment.assignedByAddress === sessionAddress);
    const canRemindAsCreator = Boolean(assignment && sessionAddress && creatorAddress === sessionAddress);
    const notification = notifications.reduce<SigningRequestNotificationSummary | undefined>((latest, item) => {
      if (item.signerAddress !== signerAddress) return latest;
      return !latest || Date.parse(item.createdAt) >= Date.parse(latest.createdAt) ? item : latest;
    }, undefined);
    const notificationChannel = notification?.automatic ? 'Automatic reminder' : notification?.eventType === 'signature_reminder' ? 'Reminder' : 'Email';
    const statusLabel = notification?.state === 'delivered'
      ? notificationChannel + ' delivered'
      : notification?.state === 'bounced'
        ? notificationChannel + ' bounced'
        : notification?.state === 'provider_accepted'
          ? notificationChannel + ' accepted'
          : notification?.state === 'queued'
            ? notificationChannel + ' queued'
            : notification?.state === 'failed'
              ? notificationChannel + ' failed'
              : assigned && !viewed ? 'Assigned' : '';
    const viewedBadge = viewed ? (
      <span
        className="shrink-0 rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-300"
        title={assignment?.viewedAt ? `Proposal viewed ${new Date(assignment.viewedAt).toLocaleString()}` : undefined}
      >
        Viewed
      </span>
    ) : null;

    if (!email) {
      if (!privateUnlocked) return assigned
        ? viewedBadge ?? <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">{statusLabel}</span>
        : null;
      return (
        <div className="mst-signer-contact mt-2">
          {statusLabel && <span className="shrink-0 rounded-full bg-neutral-500/10 px-2 py-0.5 text-[11px] font-semibold text-neutral-600 dark:text-neutral-300">{statusLabel}</span>}
          {viewedBadge}
          <AddressAliasEditor address={signerAddress} subjectType="signer" allowNotificationEmail />
          <span className="text-xs text-neutral-500 dark:text-neutral-400">Add a private name and email to notify this signer.</span>
        </div>
      );
    }

    const canRepairInitialEmail = assignedByMe && !notification;
    const canRemind = (assignedByMe || canRemindAsCreator) && (
      notification?.state === 'provider_accepted'
      || notification?.state === 'delivered'
    );
    const canRetryFailed = (assignedByMe || canRemindAsCreator) && (
      notification?.state === 'failed'
      || notification?.state === 'bounced'
    );

    return (
      <div className="mst-signer-contact mt-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          <Mail className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate" title={email}>{email}</span>
        </div>
        {statusLabel && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            notification?.state === 'provider_accepted' || notification?.state === 'delivered'
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : notification?.state === 'failed' || notification?.state === 'bounced'
                ? 'bg-red-500/10 text-red-700 dark:text-red-300'
                : 'bg-neutral-500/10 text-neutral-600 dark:text-neutral-300'
          }`}>
            {statusLabel}
          </span>
        )}
        {viewedBadge}
        {onAsk && (canRepairInitialEmail || (!assigned && !inviteCandidates.includes(signerAddress))) && (
          <ActionButton
            variant="secondary"
            size="sm"
            disabled={askBusy === signerAddress}
            onClick={() => void askSigner(signerAddress)}
            className="min-h-11 shrink-0"
          >
            {askBusy === signerAddress
              ? assigned ? 'Notifying…' : 'Asking…'
              : assigned ? 'Notify by email' : askLabel}
          </ActionButton>
        )}
        {onRemind && (canRemind || canRetryFailed) && (
          <ActionButton
            variant="secondary"
            size="sm"
            disabled={askBusy === signerAddress}
            onClick={() => void remindSigner(signerAddress)}
            className="min-h-11 shrink-0"
          >
            {askBusy === signerAddress ? 'Sending…' : canRetryFailed ? 'Retry email' : 'Remind'}
          </ActionButton>
        )}
        {askError?.address === signerAddress && <span className="basis-full text-xs text-red-600 dark:text-red-400">{askError.message}</span>}
      </div>
    );
  }

  async function createShareLink() {
    if (!onShare) return;
    setShareBusy(true);
    setShareError('');
    setShareCopied(false);
    setShareModalOpen(true);
    try {
      const result = await onShare();
      if (typeof result === 'string' && result) {
        setShareLink(result);
      } else {
        setShareModalOpen(false);
      }
    } catch (cause) {
      setShareError(cause instanceof Error ? cause.message : 'Unable to create a private link.');
    } finally {
      setShareBusy(false);
    }
  }

  function invokeShare() {
    if (!onShare) return;
    if (shareCreatesLink) void createShareLink();
    else void onShare();
  }

  if (sourceAnalyses.length === 0 && !knownComplete) {
    return (
      <section className="mst-signing-guidance">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] opacity-40">Signatures</div>
        <div className="mst-signing-loading mt-4">
          <LoaderCircle className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-neutral-500" />
          <div>
            <div className="font-semibold">Checking signing requirements…</div>
            <p className="mt-1 text-sm leading-6 opacity-60">Receipt details are ready while the current Stellar signer rules load.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mst-signing-guidance">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] opacity-40">Signatures</div>
          <h2 className="mt-2 text-2xl font-bold">{authorizationComplete ? 'All required signatures are present' : walletAlreadySigned ? 'Waiting for other signatures' : 'Who needs to sign?'}</h2>
          {!authorizationComplete && !hasAuthorizationError && walletAlreadySigned && (
            <p className="mt-2 text-sm leading-6 text-[var(--color-ink-2)]">
              {remainingSignatureCopy}
              {shareTargets.length > 0 && ' ' + shareTargets.length + ' eligible unsigned signer' + (shareTargets.length === 1 ? ' is' : 's are') + ' listed below.'}
            </p>
          )}
        </div>
        {authorizationComplete && <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />}
      </div>

      {authorizationComplete && !approvalPersisted && !walletAlreadySigned && shareCreatesLink && onShare && (
        <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-4 text-sm sm:flex sm:items-center sm:justify-between sm:gap-4">
          <div>
            <div className="font-semibold">Not saved as a shared proposal</div>
            <p className="mt-1 leading-6 opacity-65">Submit this transaction or save a private link if others need access to it.</p>
          </div>
          {shareLink ? (
            <ActionButton variant="secondary" onClick={() => void copyShareLink()} className="mt-3 shrink-0 sm:mt-0">
              <Share2 className="h-4 w-4" />{shareCopied ? 'Copied' : 'Copy private link'}
            </ActionButton>
          ) : (
            <ActionButton variant="secondary" disabled={shareBusy} onClick={invokeShare} className="mt-3 shrink-0 sm:mt-0">
              {shareBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}Save private link
            </ActionButton>
          )}
        </div>
      )}

      {hasAuthorizationError && (
        <div className="mt-4 flex gap-3 rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-sm">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <div><span className="font-semibold">The signatures need technical attention.</span> Open Advanced details below to see which signature Stellar cannot use.</div>
        </div>
      )}

      {!authorizationComplete && !hasAuthorizationError && onAsk && privateUnlocked && (inviteCandidates.length > 0 || inviteFeedback || (walletAlreadySigned && isCreator && shareTargets.length > 0)) && (
        <section className="mt-5 rounded-[var(--radius-panel)] border border-[var(--color-rule)] bg-[var(--color-paper-2)] p-4 sm:p-5" aria-label="Invite and follow up with signers">
          <div className="flex items-center gap-2 text-[var(--color-ink)]">
            <Mail className="h-4 w-4 shrink-0 text-[var(--color-accent)]" />
            <h3 className="text-base font-semibold">{inviteCandidates.length > 0 ? 'Invite signers' : 'Follow up with signers'}</h3>
          </div>
          <p className="mt-1 text-sm leading-6 text-[var(--color-ink-2)]">
            {inviteCandidates.length > 0
              ? 'Choose who to ask. Invitations do not reserve signing slots or change Stellar authorization.'
              : unaskedTargets.length > 0
                ? 'Add a contact email to an eligible signer below, or share the private link.'
                : 'Invitations are recorded. Check delivery and viewing status below; reminders are available when permitted.'}
          </p>
          {inviteCandidates.length > 0 && <div className="mt-3 divide-y divide-[var(--color-rule)] border-y border-[var(--color-rule)]">
            {inviteCandidates.map((address) => (
              <label key={address} className="flex min-w-0 cursor-pointer items-center gap-3 py-3">
                <input
                  type="checkbox"
                  aria-label={'Invite ' + (labelFor(address, 'signer') || address)}
                  checked={inviteSelectedNow.includes(address)}
                  disabled={inviteBusy}
                  onChange={(event) => setInviteSelection((current) =>
                    event.target.checked ? [...new Set([...current, address])] : current.filter((item) => item !== address))}
                  className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[var(--color-ink)]">{labelFor(address, 'signer') || 'Signer'}</span>
                  <span className="block truncate text-xs text-[var(--color-muted)]">{emailFor(address)}</span>
                </span>
              </label>
            ))}
          </div>}
          {inviteCandidates.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-3">
            <ActionButton
              variant="secondary"
              disabled={inviteBusy || inviteSelectedNow.length === 0}
              onClick={() => void inviteSelectedSigners()}
              className="min-h-11"
            >
              {inviteBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              {inviteBusy ? 'Sending invitations…' : inviteSelectedNow.length === 0 ? 'Select signers above' : 'Send ' + inviteSelectedNow.length + ' invitation' + (inviteSelectedNow.length === 1 ? '' : 's')}
            </ActionButton>
            <span className="text-xs text-[var(--color-muted)]">People not selected can still sign if authorized.</span>
          </div>}
          {inviteFeedback && <p role="status" className="mt-3 text-sm text-[var(--color-ink-2)]">{inviteFeedback}</p>}
        </section>
      )}

      {!authorizationComplete && !hasAuthorizationError && (
        <div className="mst-signing-requirements mt-5">
          {incomplete.map((entry) => {
            const { requirement, auth, policy, eligibleSignerKeys, matchedSignerKeys, remainingSignerKeys, signaturesRemaining, error } = entry;
            const accountAlias = labelFor(requirement.accountId, 'account');
            const accountDisplay = treasuryDisplayLabel(treasuryNames[requirement.accountId], accountAlias);
            const currentAccountKeyOnly = remainingSignerKeys.length === 1
              && remainingSignerKeys[0] === requirement.accountId
              && policy?.exactNOfM?.required === 1;

            return (
              <div key={`${requirement.scope}:${requirement.accountId}`} className="mst-signing-requirement">
                {isSigningSetup && requirement.threshold === 'high' && policy && <div className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">Current account-control authorization · Core account control · {humanAuthorizationRequirement(policy)}</div>}
                {!error && !auth?.error && policy?.exactNOfM && !currentAccountKeyOnly && (
                  <div className="mst-signer-ledger">
                    <div className="mst-signer-ledger__header">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400">Signing progress</div>
                        {accountDisplay && <div className="mt-0.5 truncate text-xs font-semibold text-neutral-700 dark:text-neutral-200">{accountDisplay}</div>}
                      </div>
                      <span className="font-mono text-xs font-semibold tabular-nums text-neutral-600 dark:text-neutral-300">{matchedSignerKeys.length} / {policy.exactNOfM.required} required</span>
                    </div>
                    <div className="mst-signer-ledger__list">
                      {eligibleSignerKeys.map((key) => {
                        const signed = matchedSignerKeys.includes(key);
                        const currentSigner = !signed && key === walletAddress;
                        return (
                          <div key={key} className="mst-signer-ledger__row">
                            {signed
                              ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
                              : <span className={`h-3 w-3 shrink-0 rounded-sm border ${currentSigner ? 'border-amber-500 bg-amber-500/15' : 'border-neutral-300 dark:border-neutral-600'}`} aria-hidden="true" />}
                            <div className="min-w-0 flex-1">
                              <AddressIdentity address={key} subjectType="signer" />
                              {!signed && !currentSigner && signerContactControl(key)}
                            </div>
                            <span className={`shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] ${signed ? 'text-emerald-700 dark:text-emerald-300' : currentSigner ? 'text-amber-700 dark:text-amber-300' : 'text-neutral-400'}`}>{signed ? 'Signed' : currentSigner ? 'You can sign' : 'Can sign'}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {weightedRequirements.filter((item) => item.accountId === requirement.accountId && item.scope === requirement.scope).map((item) => (
                  <div key={item.accountId + ':' + item.scope} className="mb-4 border-b border-[var(--color-rule)] pb-4">
                    <div className="text-xs font-semibold text-[var(--color-muted)]">Approval power required</div>
                    <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <strong className="text-xl font-semibold tabular-nums text-[var(--color-ink)]">{item.matchedWeight} / {item.requiredWeight}</strong>
                      <span className="text-sm text-[var(--color-ink-2)]">Needs {item.missingWeight} more approval power</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--color-muted)]">Signers may have different weights. Signature count alone does not determine authorization.</p>
                  </div>
                ))}
                {error || auth?.error ? (
                  <>
                    <div className="text-sm text-amber-700 dark:text-amber-300">We could not load the current signing rules for this account.</div>
                    <AddressIdentity className="mt-2" address={requirement.accountId} subjectType="account" allowNaming={allowNaming} labelOverride={accountDisplay} />
                  </>
                ) : currentAccountKeyOnly && isSigningSetup ? (
                  <>
                    <div className="font-semibold">Sign the new signing setup{accountDisplay ? ` for ${accountDisplay}` : ''}</div>
                    <p className="mt-2 text-sm leading-6 opacity-60">The account's current signing key must sign these changes before the new multisig rules take effect. The new signer keys do not need to sign this setup transaction.</p>
                    <AddressIdentity className="mt-3" address={remainingSignerKeys[0]} subjectType="signer" allowNaming={allowNaming} />
                    {signerContactControl(remainingSignerKeys[0])}
                  </>
                ) : currentAccountKeyOnly ? (
                  <>
                    <div className="font-semibold">Signature needed from {accountDisplay || 'this account'}</div>
                    <p className="mt-2 text-sm opacity-60">This transaction currently needs this account's signing key.</p>
                    <AddressIdentity className="mt-3" address={remainingSignerKeys[0]} subjectType="signer" allowNaming={allowNaming} />
                    {signerContactControl(remainingSignerKeys[0])}
                  </>
                ) : policy?.exactNOfM ? null : signaturesRemaining !== null ? (
                  <>
                    <div className="font-semibold">Need {signaturesRemaining} more signature{signaturesRemaining === 1 ? '' : 's'}{accountDisplay ? ` for ${accountDisplay}` : ''}</div>
                    <p className="mt-1 text-sm opacity-60">Any {signaturesRemaining} of these signers can sign this transaction:</p>
                    <div className="mst-signer-candidates mt-3">
                      {remainingSignerKeys.map((key) => (
                        <div key={key} className="mst-signer-candidate-row">
                          <AddressIdentity address={key} subjectType="signer" allowNaming={allowNaming} />
                          {signerContactControl(key)}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-semibold">{policy && !policy.exactNOfM ? 'More approval power is needed' : 'Another signature is needed'}{accountDisplay ? ` for ${accountDisplay}` : ''}</div>
                    <p className="mt-1 text-sm opacity-60">One or more of these signers can sign:</p>
                    <div className="mst-signer-candidates mt-3">
                      {remainingSignerKeys.map((key) => (
                        <div key={key} className="mst-signer-candidate-row">
                          <AddressIdentity address={key} subjectType="signer" allowNaming={allowNaming} />
                          {signerContactControl(key)}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
          {missingExtraSigners.map((signer) => (
            <div key={'extra:' + signer.signerKey} className="mst-signing-requirement">
              <div className="font-semibold">Additional required signer</div>
              <p className="mt-1 text-sm leading-6 text-[var(--color-ink-2)]">This signer is required in addition to the account approval thresholds.</p>
              <div className="mt-3"><AddressIdentity address={signer.signerKey} subjectType="signer" allowNaming={allowNaming} /></div>
              {signerContactControl(signer.signerKey)}
            </div>
          ))}
        </div>
      )}

      {!authorizationComplete && !hasAuthorizationError && (
        <div className="mst-signing-action-strip mt-5">
          <div className="text-sm">
            <div className="font-semibold">Sign proposal</div>
            <div className="mt-2">
              {walletAddress
                ? <AddressIdentity address={walletAddress} subjectType="signer" />
                : <div className="text-neutral-500 dark:text-neutral-400">No signer connected.</div>}
            </div>

            <div className={`mst-signing-action-grid mt-4 ${shouldShowShare && onShare ? 'mst-signing-action-grid--split' : ''}`}>
              {walletAddress ? (
                walletCanSign || walletAlreadySigned ? (
                  <ActionButton variant={walletAlreadySigned ? 'secondary' : 'primary'} disabled={!walletCanSign || walletBusy} aria-busy={walletBusy} onClick={onSignWithWallet} className="min-h-12 w-full px-4">
                    {walletAlreadySigned ? <CheckCircle2 className="h-4 w-4" /> : <WalletCards className="h-4 w-4" />}{walletBusy ? 'Signing…' : walletAlreadySigned ? 'Signed' : 'Sign'}
                  </ActionButton>
                ) : (
                  <ActionButton variant="secondary" disabled={walletBusy} aria-busy={walletBusy} onClick={onConnectWallet} className="min-h-12 w-full px-4">
                    <WalletCards className="h-4 w-4" />{walletBusy ? 'Opening wallets…' : 'Choose an authorized signer'}
                  </ActionButton>
                )
              ) : (
                <ActionButton disabled={walletBusy} aria-busy={walletBusy} onClick={onConnectWallet} className="min-h-12 w-full px-4">
                  <WalletCards className="h-4 w-4" />{walletBusy ? 'Opening wallets…' : 'Connect signer'}
                </ActionButton>
              )}

              {shouldShowShare && onShare && (
                <ActionButton variant="secondary" disabled={shareBusy} aria-busy={shareBusy} onClick={invokeShare} className="min-h-12 w-full px-4">
                  {shareBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                  Share private link
                </ActionButton>
              )}
            </div>

            {walletAddress && walletAlreadySigned && <div className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{signedStateCopy}</div>}
            {walletAddress && !walletCanSign && !walletAlreadySigned && <div className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">This wallet is not an authorized signer for this Proposal. Choose another signer wallet, ask a saved Contact, or share the private link.</div>}
            {walletError && <div className="mt-3 flex gap-2 text-sm text-red-600 dark:text-red-400"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{walletError}</div>}
            {shareError && <div className="mt-3 flex gap-2 text-sm text-red-600 dark:text-red-400"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{shareError}</div>}
          </div>
        </div>
      )}

      {shareCreatesLink && shareModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Private link">
          <div className="mst-share-dialog">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold">{shareBusy ? 'Preparing private link' : shareError ? 'Could not prepare link' : 'Private link ready'}</h3>
                {!shareBusy && !shareError && <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">Anyone with this link can view the active Proposal. The link never grants Stellar signing authority.</p>}
                <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
                  {shareBusy ? 'You can stay on this transaction while we prepare the link.' : shareError ? shareError : 'Send it only to the signer you want to review and sign this transaction.'}
                </p>
              </div>
              {!shareBusy && <button type="button" onClick={() => setShareModalOpen(false)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--color-muted)] hover:bg-[var(--color-paper-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]" aria-label="Close"><X className="h-5 w-5" /></button>}
            </div>

            {shareBusy ? (
              <div className="mst-share-dialog__state mt-7"><LoaderCircle className="h-5 w-5 animate-spin" />Preparing…</div>
            ) : shareError ? (
              <div className="mt-6 flex gap-2">
                <ActionButton onClick={() => void createShareLink()}>Try again</ActionButton>
                <ActionButton variant="secondary" onClick={() => setShareModalOpen(false)}>Close</ActionButton>
              </div>
            ) : (
              <div className="mt-6 flex flex-wrap gap-2">
                <ActionButton onClick={() => void copyShareLink()}><Share2 className="h-4 w-4" />{shareCopied ? 'Copied' : 'Copy private link'}</ActionButton>
                <ActionButton variant="secondary" onClick={() => setShareModalOpen(false)}>Done</ActionButton>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
