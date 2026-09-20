import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, LoaderCircle, Share2, WalletCards, X } from 'lucide-react';
import AddressIdentity from './AddressIdentity';
import { useAddressBook } from './AddressBookContext';
import { useStellarWallet } from './StellarWalletContext';
import { cachedTreasuryNames, loadSharedTreasuryNames } from './treasuryMetadataCache';
import { treasuryDisplayLabel } from './treasuryDisplay';
import { humanAuthorizationRequirement } from './stellar/authorizationPresentation';
import type { SourceAnalysis } from './stellar/transactionReviewAnalysis';
import type { TransactionAuthorizationStatus } from './stellar/transactionAuthorization';
import type { TransactionXdrInspection } from './stellar/transactionXdr';

interface Props {
  inspection: TransactionXdrInspection;
  authorization: TransactionAuthorizationStatus | null;
  sourceAnalyses: SourceAnalysis[];
  walletAddress: string;
  walletBusy: boolean;
  walletError: string;
  onConnectWallet: () => void;
  onSignWithWallet: () => void;
  onShare?: () => void | string | Promise<void | string>;
  shareCreatesLink?: boolean;
  approvalPersisted?: boolean;
  knownComplete?: boolean;
}

export default function SigningGuidance({
  inspection,
  authorization,
  sourceAnalyses,
  walletAddress,
  walletBusy,
  walletError,
  onConnectWallet,
  onSignWithWallet,
  onShare,
  shareCreatesLink = false,
  approvalPersisted = true,
  knownComplete = false,
}: Props) {
  const { labelFor } = useAddressBook();
  const { sessionAddress, privateUnlocked } = useStellarWallet();
  const [shareBusy, setShareBusy] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [shareError, setShareError] = useState('');
  const [shareCopied, setShareCopied] = useState(false);
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
  const neededWalletKeys = new Set(incomplete.flatMap((entry) => entry.remainingSignerKeys));
  const walletCanSign = Boolean(walletAddress && neededWalletKeys.has(walletAddress));
  const walletAlreadySigned = Boolean(walletAddress && authorization?.sources.some((source) =>
    source.matchedSigners.some((signer) => !signer.automatic && signer.signerKey === walletAddress),
  ));
  const authorizationComplete = knownComplete || authorization?.coreAuthorizationValid === true;
  const hasAuthorizationError = !knownComplete
    && authorization?.signatureRequirementsSatisfied === true
    && authorization.coreAuthorizationValid === false;
  const exactSignaturesRemaining = incomplete.every((entry) => entry.signaturesRemaining !== null)
    ? incomplete.reduce((total, entry) => total + (entry.signaturesRemaining ?? 0), 0)
    : null;
  const shareTargets = [...neededWalletKeys].filter((key) => key !== walletAddress);
  const shouldShowShare = shareTargets.length > 0 || (!walletAddress && neededWalletKeys.size > 0);
  const singleShareAlias = shareTargets.length === 1 ? labelFor(shareTargets[0], 'signer') : '';
  const shareActionLabel = singleShareAlias ? `Ask ${singleShareAlias} to sign` : 'Ask someone to sign';
  const remainingSignatureCopy = exactSignaturesRemaining === null
    ? 'More signatures are still needed.'
    : exactSignaturesRemaining === 1
      ? '1 more signer needs to sign.'
      : `${exactSignaturesRemaining} more signatures are needed.`;
  const signedStateCopy = `Signed${exactSignaturesRemaining ? ` · ${remainingSignatureCopy}` : ''}`;

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
          <h2 className="mt-2 text-2xl font-bold">{authorizationComplete ? 'All required signatures are present' : 'Who needs to sign?'}</h2>
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
            <button type="button" onClick={() => void copyShareLink()} className="mt-3 flex shrink-0 items-center gap-2 rounded-xl border border-emerald-500/30 bg-white px-4 py-2.5 font-semibold text-emerald-700 hover:bg-emerald-500/5 dark:bg-black/10 dark:text-emerald-300 sm:mt-0">
              <Share2 className="h-4 w-4" />{shareCopied ? 'Copied' : 'Copy private link'}
            </button>
          ) : (
            <button type="button" disabled={shareBusy} onClick={invokeShare} className="mt-3 flex shrink-0 items-center gap-2 rounded-xl border border-emerald-500/30 bg-white px-4 py-2.5 font-semibold text-emerald-700 hover:bg-emerald-500/5 disabled:opacity-50 dark:bg-black/10 dark:text-emerald-300 sm:mt-0">
              {shareBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}Save private link
            </button>
          )}
        </div>
      )}

      {hasAuthorizationError && (
        <div className="mt-4 flex gap-3 rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-sm">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <div><span className="font-semibold">The signatures need technical attention.</span> Open Advanced details below to see which signature Stellar cannot use.</div>
        </div>
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
                            <div className="min-w-0 flex-1"><AddressIdentity address={key} subjectType="signer" /></div>
                            <span className={`shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] ${signed ? 'text-emerald-700 dark:text-emerald-300' : currentSigner ? 'text-amber-700 dark:text-amber-300' : 'text-neutral-400'}`}>{signed ? 'Signed' : currentSigner ? 'You can sign' : 'Can sign'}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
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
                  </>
                ) : currentAccountKeyOnly ? (
                  <>
                    <div className="font-semibold">Signature needed from {accountDisplay || 'this account'}</div>
                    <p className="mt-2 text-sm opacity-60">This transaction currently needs this account's signing key.</p>
                    <AddressIdentity className="mt-3" address={remainingSignerKeys[0]} subjectType="signer" allowNaming={allowNaming} />
                  </>
                ) : policy?.exactNOfM ? null : signaturesRemaining !== null ? (
                  <>
                    <div className="font-semibold">Need {signaturesRemaining} more signature{signaturesRemaining === 1 ? '' : 's'}{accountDisplay ? ` for ${accountDisplay}` : ''}</div>
                    <p className="mt-1 text-sm opacity-60">Any {signaturesRemaining} of these signers can sign this transaction:</p>
                    <div className="mst-signer-candidates mt-3">
                      {remainingSignerKeys.map((key) => (
                        <div key={key} className="mst-signer-candidate-row">
                          <AddressIdentity address={key} subjectType="signer" allowNaming={allowNaming} />
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-semibold">Another signature is needed{accountDisplay ? ` for ${accountDisplay}` : ''}</div>
                    <p className="mt-1 text-sm opacity-60">One or more of these signers can sign:</p>
                    <div className="mst-signer-candidates mt-3">
                      {remainingSignerKeys.map((key) => (
                        <div key={key} className="mst-signer-candidate-row">
                          <AddressIdentity address={key} subjectType="signer" allowNaming={allowNaming} />
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
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
                  <button type="button" disabled={!walletCanSign || walletBusy} onClick={onSignWithWallet} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:opacity-100 dark:disabled:bg-white/10 dark:disabled:text-neutral-500">
                    <WalletCards className="h-4 w-4" />{walletBusy ? 'Signing…' : walletAlreadySigned ? 'Signed' : 'Sign'}
                  </button>
                ) : (
                  <button type="button" disabled={walletBusy} onClick={onConnectWallet} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900">
                    <WalletCards className="h-4 w-4" />{walletBusy ? 'Opening wallets…' : 'Choose an authorized signer'}
                  </button>
                )
              ) : (
                <button type="button" disabled={walletBusy} onClick={onConnectWallet} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
                  <WalletCards className="h-4 w-4" />{walletBusy ? 'Opening wallets…' : 'Connect signer'}
                </button>
              )}

              {shouldShowShare && onShare && (
                <button type="button" disabled={shareBusy} onClick={invokeShare} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 px-4 py-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-500/5 disabled:opacity-50 dark:text-emerald-300">
                  {shareBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                  {shareActionLabel}
                </button>
              )}
            </div>

            {walletAddress && walletAlreadySigned && <div className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{signedStateCopy}</div>}
            {walletAddress && !walletCanSign && !walletAlreadySigned && <div className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">This wallet is not an authorized signer for this Proposal. Choose another signer wallet, or send the private link to someone who can sign.</div>}
            {walletError && <div className="mt-3 flex gap-2 text-sm text-red-600 dark:text-red-400"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{walletError}</div>}
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
              {!shareBusy && <button type="button" onClick={() => setShareModalOpen(false)} className="rounded-lg p-1.5 text-neutral-500 hover:bg-black/5 dark:hover:bg-white/10" aria-label="Close"><X className="h-5 w-5" /></button>}
            </div>

            {shareBusy ? (
              <div className="mst-share-dialog__state mt-7"><LoaderCircle className="h-5 w-5 animate-spin" />Preparing…</div>
            ) : shareError ? (
              <div className="mt-6 flex gap-2">
                <button type="button" onClick={() => void createShareLink()} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white">Try again</button>
                <button type="button" onClick={() => setShareModalOpen(false)} className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold dark:border-white/10">Close</button>
              </div>
            ) : (
              <div className="mt-6 flex flex-wrap gap-2">
                <button type="button" onClick={() => void copyShareLink()} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white"><Share2 className="h-4 w-4" />{shareCopied ? 'Copied' : 'Copy private link'}</button>
                <button type="button" onClick={() => setShareModalOpen(false)} className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold dark:border-white/10">Done</button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
