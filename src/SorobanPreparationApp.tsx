import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, ClipboardCopy, KeyRound, LoaderCircle, QrCode, Share2 } from 'lucide-react';
import { ActionButton, NetworkFact, StatusBadge, WorkflowProgress } from './MultiSigUi';
import ReviewTransactionSummary from './ReviewTransactionSummary';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useStellarWallet } from './StellarWalletContext';
import XdrQrCode from './XdrQrCode';
import { sorobanAuthorizationPreimageXdr } from './stellar/sorobanAuthorization';
import type {
  FreezeSorobanPreparationResponse,
  SorobanPreparationApiError,
  SorobanPreparationContributionResponse,
  SorobanPreparationSnapshot,
  SorobanPreparationViewerAction,
  SorobanPreparationResponse,
} from './stellar/sorobanPreparationTypes';
import { inspectTransactionXdr } from './stellar/transactionXdr';
import { navigateWorkspace, stellarHref } from './workspaceNavigation';

const REQUEST_ID_LENGTH = 16;
const CAPABILITY_LENGTH = 26;
const PRIVATE_LOCATOR_LENGTH = REQUEST_ID_LENGTH + CAPABILITY_LENGTH;
const POLL_INTERVAL_MS = 15_000;

function compactAddress(address: string) {
  return address.length <= 22 ? address : `${address.slice(0, 8)}…${address.slice(-8)}`;
}

function parseLocator(value: string) {
  const normalized = (value.includes('#') ? value.slice(value.lastIndexOf('#') + 1) : value).trim().toUpperCase();
  if (normalized.length === PRIVATE_LOCATOR_LENGTH) {
    return { id: normalized.slice(0, REQUEST_ID_LENGTH), capability: normalized.slice(REQUEST_ID_LENGTH) };
  }
  return { id: normalized, capability: '' };
}

function requestHeaders(id: string, capability: string, json = false): HeadersInit {
  return {
    'X-MultiSig-Request-Id': id,
    ...(capability ? { 'X-MultiSig-Capability': capability } : {}),
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function apiJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T | SorobanPreparationApiError;
  if (!response.ok) {
    const error = body as SorobanPreparationApiError;
    throw new Error(error.error || `MultiSigTools returned HTTP ${response.status}.`);
  }
  return body as T;
}

function viewerActionFor(address: string, preparation: SorobanPreparationSnapshot): SorobanPreparationViewerAction {
  if (!address) return 'waiting';
  if (preparation.status === 'ready_to_freeze' && preparation.transactionSignerKeys.includes(address)) return 'freeze';
  if (preparation.status !== 'awaiting_authorization') return 'waiting';
  return preparation.authorizers.some((authorizer) =>
    !authorizer.ready
    && authorizer.activeSigners.some((signer) => signer.publicKey === address)
    && !authorizer.signerEvidence.some((signer) => signer.publicKey === address),
  ) ? 'authorize' : 'waiting';
}

function statusPresentation(preparation: SorobanPreparationSnapshot) {
  if (preparation.status === 'awaiting_authorization') return { label: 'Collecting contract authorization', tone: 'warning' as const };
  if (preparation.status === 'ready_to_freeze') return { label: 'Contract authorization complete', tone: 'success' as const };
  if (preparation.status === 'frozen') return { label: 'Proposal created', tone: 'success' as const };
  if (preparation.status === 'expired') return { label: 'Authorization expired', tone: 'danger' as const };
  return { label: 'Needs review', tone: 'danger' as const };
}

export default function SorobanPreparationApp() {
  const initialLocator = useMemo(() => parseLocator(window.location.hash.slice(1)), []);
  const wallet = useStellarWallet();
  const [preparation, setPreparation] = useState<SorobanPreparationSnapshot | null>(null);
  const [shareable, setShareable] = useState(Boolean(initialLocator.capability));
  const [loading, setLoading] = useState(Boolean(initialLocator.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<'link' | 'xdr' | null>(null);
  const [showQr, setShowQr] = useState(false);
  const didLoad = useRef(false);

  const inspection = useMemo(() => {
    if (!preparation) return null;
    try { return inspectTransactionXdr(preparation.preparedXdr, preparation.network); } catch { return null; }
  }, [preparation]);
  const viewerAction = preparation ? viewerActionFor(wallet.address, preparation) : 'waiting';
  const eligibleAuthorizers = preparation && wallet.address
    ? preparation.authorizers.filter((authorizer) =>
        !authorizer.ready
        && authorizer.activeSigners.some((signer) => signer.publicKey === wallet.address)
        && !authorizer.signerEvidence.some((signer) => signer.publicKey === wallet.address))
    : [];
  const hardwareWalletSelected = wallet.networkSource === 'application';

  async function loadPreparation(quiet = false) {
    if (!initialLocator.id) return;
    if (!quiet) setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/preparation', {
        cache: 'no-store',
        headers: requestHeaders(initialLocator.id, initialLocator.capability),
      });
      const body = await apiJson<SorobanPreparationResponse>(response);
      setPreparation(body.preparation);
      setShareable(Boolean(body.access?.shareable || initialLocator.capability));
    } catch (cause) {
      if (!quiet) setPreparation(null);
      setError(cause instanceof Error ? cause.message : 'Unable to load this authorization request.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => {
    if (didLoad.current || !initialLocator.id) return;
    didLoad.current = true;
    void loadPreparation();
    const timer = window.setInterval(() => void loadPreparation(true), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  async function chooseWallet() {
    setError('');
    try { await wallet.connect(); } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to choose a wallet.');
    }
  }

  async function authorize() {
    if (!preparation || busy) return;
    if (hardwareWalletSelected) {
      setError('Ledger and Trezor can sign the final transaction envelope, but they cannot sign detached Soroban authorization entries. Choose another current signer wallet for this step.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      let signerAddress = wallet.address;
      if (!signerAddress) signerAddress = await wallet.connect();
      let current = preparation;
      const targets = current.authorizers.filter((authorizer) =>
        !authorizer.ready
        && authorizer.activeSigners.some((signer) => signer.publicKey === signerAddress)
        && !authorizer.signerEvidence.some((signer) => signer.publicKey === signerAddress));
      if (targets.length === 0) throw new Error('Choose a current signer for the remaining contract authorization.');
      for (const target of targets) {
        const preimageXdr = sorobanAuthorizationPreimageXdr({
          envelopeXdr: current.preparedXdr,
          network: current.network,
          entryIndex: target.entryIndex,
          expirationLedger: target.expirationLedger,
        });
        const signed = await wallet.signAuthEntry(preimageXdr, current.network);
        if (signed.signerAddress !== signerAddress) throw new Error('The selected wallet changed while authorization was being signed.');
        const response = await fetch('/api/preparation', {
          method: 'PATCH',
          headers: requestHeaders(initialLocator.id, initialLocator.capability, true),
          body: JSON.stringify({
            entryIndex: target.entryIndex,
            signerAddress: signed.signerAddress,
            signatureBase64: signed.signatureBase64,
          }),
        });
        const body = await apiJson<SorobanPreparationContributionResponse>(response);
        current = body.preparation;
      }
      setPreparation(current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to add this contract authorization signature.');
    } finally {
      setBusy(false);
    }
  }

  async function refreshAuthorizationWindow() {
    if (!preparation || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/preparation', {
        method: 'PATCH',
        headers: requestHeaders(initialLocator.id, initialLocator.capability, true),
        body: JSON.stringify({ action: 'refresh' }),
      });
      const body = await apiJson<SorobanPreparationResponse>(response);
      setPreparation(body.preparation);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to refresh authorization window.');
    } finally {
      setBusy(false);
    }
  }

  async function freezeToProposal() {
    if (!preparation || busy) return;
    setBusy(true);
    setError('');
    try {
      let signerAddress = wallet.address;
      if (!signerAddress || !preparation.transactionSignerKeys.includes(signerAddress)) {
        signerAddress = await wallet.connect();
      }
      if (!preparation.transactionSignerKeys.includes(signerAddress)) {
        throw new Error(`Choose a current signer for transaction source ${compactAddress(preparation.transactionSourceAccount)}.`);
      }
      if (!wallet.privateUnlocked || wallet.unlockedAddress !== signerAddress || wallet.unlockedNetwork !== preparation.network) {
        await wallet.unlock(undefined, preparation.network);
      }
      const response = await fetch('/api/preparation', {
        method: 'PUT',
        headers: requestHeaders(initialLocator.id, initialLocator.capability),
      });
      const body = await apiJson<FreezeSorobanPreparationResponse>(response);
      navigateWorkspace('/s', {
        replace: true,
        hash: `${body.proposal.id}${body.capability ?? initialLocator.capability}`,
        state: {
          requestPreview: body.proposal,
          requestJustCreated: true,
          returnTo: stellarHref('/inbox'),
          returnLabel: 'Back to Inbox',
        },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create the transaction Proposal.');
      setBusy(false);
    }
  }

  async function copyShareLink() {
    if (!preparation || !initialLocator.capability) return;
    const url = new URL(stellarHref('/a'));
    url.hash = `${preparation.id}${initialLocator.capability}`;
    await navigator.clipboard.writeText(url.toString());
    setCopied('link');
  }

  async function copyXdr() {
    if (!preparation) return;
    await navigator.clipboard.writeText(preparation.preparedXdr);
    setCopied('xdr');
  }

  if (!initialLocator.id) {
    return <StellarWorkspaceShell active="inbox"><main className="mx-auto max-w-2xl px-4 py-14"><h1 className="text-3xl font-bold">Authorization request</h1><p className="mt-3 text-neutral-600 dark:text-neutral-300">Open this page from a private authorization link or from Inbox.</p><a href={stellarHref('/inbox')} className="mt-6 inline-flex font-semibold text-emerald-700 dark:text-emerald-300">Open Inbox</a></main></StellarWorkspaceShell>;
  }

  if (loading && !preparation) {
    return <StellarWorkspaceShell active="inbox"><main className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-14 text-neutral-500"><LoaderCircle className="h-5 w-5 animate-spin" />Loading contract authorization…</main></StellarWorkspaceShell>;
  }

  if (!preparation || !inspection) {
    return <StellarWorkspaceShell active="inbox"><main className="mx-auto max-w-2xl px-4 py-14"><h1 className="text-3xl font-bold">Authorization request unavailable</h1><p className="mt-3 text-neutral-600 dark:text-neutral-300">{error || 'This request could not be opened.'}</p><a href={stellarHref('/inbox')} className="mt-6 inline-flex font-semibold text-emerald-700 dark:text-emerald-300">Back to Inbox</a></main></StellarWorkspaceShell>;
  }

  const status = statusPresentation(preparation);
  return (
    <StellarWorkspaceShell active="inbox" networkContext={preparation.network}>
      <main className="px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-5xl">
          <WorkflowProgress current={preparation.status === 'frozen' ? 'sign' : 'review'} />
          <div className="mt-6 flex flex-wrap items-start justify-between gap-4 border-b border-black/10 pb-5 dark:border-white/10">
            <div><a href={stellarHref('/inbox')} className="text-sm font-semibold text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white">← Inbox</a><h1 className="mt-2 text-3xl font-bold tracking-tight">Contract authorization</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">Authorized signers can contribute from their own wallet and device. MultiSig Tools combines valid authorization evidence before the final transaction Proposal is frozen.</p></div>
            <NetworkFact network={preparation.network} />
          </div>

          <div className="mt-6 space-y-5">
            <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3"><StatusBadge tone={status.tone}>{status.label}</StatusBadge><span className="font-mono text-xs text-neutral-400">{preparation.id}</span></div>
              <p className="mt-3 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{preparation.statusDetail}</p>
              {shareable && initialLocator.capability && preparation.status !== 'frozen' && <div className="mt-4"><ActionButton variant="secondary" size="sm" onClick={() => void copyShareLink()}><Share2 className="h-4 w-4" />{copied === 'link' ? 'Private link copied' : 'Share authorization request'}</ActionButton></div>}
            </section>

            <ReviewTransactionSummary inspection={inspection} />

            <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5 sm:p-6">
              <h2 className="text-xl font-bold">Contract authorization</h2>
              <div className="mt-4 space-y-3">
                {preparation.authorizers.map((authorizer) => (
                  <div key={authorizer.entryIndex} className="rounded-xl border border-black/10 p-4 text-sm dark:border-white/10">
                    <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold">Authorization account · {compactAddress(authorizer.authorizer)}</div><div className={authorizer.ready ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'font-semibold text-neutral-500'}>{authorizer.signedWeight} / {authorizer.threshold} approval power</div></div>
                    <div className="mt-3 flex flex-wrap gap-2">{authorizer.signerEvidence.length ? authorizer.signerEvidence.map((signer) => <span key={signer.publicKey} className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300">{compactAddress(signer.publicKey)} · +{signer.weight}</span>) : <span className="text-xs text-neutral-500">Waiting for signer authorization.</span>}</div>
                  </div>
                ))}
              </div>

              {preparation.status === 'awaiting_authorization' && (
                <div className="mt-5 rounded-xl bg-black/[0.03] p-4 dark:bg-white/[0.04]">
                  <div className="text-sm font-semibold">Your action</div>
                  <p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Selected wallet: {wallet.address ? compactAddress(wallet.address) : 'none'}. Each signer approves the same stable Soroban authorization challenge; the platform combines valid contributions.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {viewerAction === 'authorize' && !hardwareWalletSelected && <ActionButton disabled={busy} onClick={() => void authorize()}><KeyRound className="h-4 w-4" />{busy ? 'Authorizing…' : 'Authorize contract call'}</ActionButton>}
                    <ActionButton variant={viewerAction === 'authorize' && hardwareWalletSelected ? 'primary' : 'secondary'} disabled={busy || wallet.busy} onClick={() => void chooseWallet()}>{wallet.address ? 'Choose another signer' : 'Choose signer'}</ActionButton>
                  </div>
                  {viewerAction !== 'authorize' && wallet.address && eligibleAuthorizers.length === 0 && <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">{preparation.authorizers.some((authorizer) => authorizer.signerEvidence.some((signer) => signer.publicKey === wallet.address)) ? 'Your authorization is already recorded. Waiting for another signer.' : 'This wallet is not needed for the remaining contract authorization.'}</p>}
                  {viewerAction === 'authorize' && hardwareWalletSelected && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Ledger and Trezor can sign the final transaction envelope but not detached Soroban authorization entries. Choose another current signer for this step.</p>}
                </div>
              )}
            </section>

            {preparation.status === 'ready_to_freeze' && (
              <section className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] p-5 sm:p-6">
                <div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /><div><h2 className="text-xl font-bold">Ready for transaction signing</h2><p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">Contract authorization is complete. A current signer for transaction source <span className="font-mono text-xs">{compactAddress(preparation.transactionSourceAccount)}</span> can now freeze this exact prepared transaction into the ordinary Proposal.</p></div></div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {viewerAction === 'freeze' && <ActionButton disabled={busy} onClick={() => void freezeToProposal()}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}{busy ? 'Creating Proposal…' : 'Continue to transaction signing'}</ActionButton>}
                  <ActionButton variant={viewerAction === 'freeze' ? 'secondary' : 'primary'} disabled={busy || wallet.busy} onClick={() => void chooseWallet()}>{wallet.address ? 'Choose transaction signer' : 'Choose transaction signer'}</ActionButton>
                </div>
              </section>
            )}

            {preparation.status === 'frozen' && (
              <section className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] p-5 sm:p-6"><h2 className="text-xl font-bold">Proposal created</h2><p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">Contract authorization is frozen. Transaction-envelope signatures now use the ordinary Proposal flow.</p><ActionButton className="mt-4" onClick={() => navigateWorkspace('/s', { hash: `${preparation.proposalId ?? preparation.id}${initialLocator.capability}` })}>Open Proposal</ActionButton></section>
            )}

            {(preparation.status === 'expired' || preparation.status === 'blocked') && <section className="rounded-2xl border border-red-500/25 bg-red-500/[0.07] p-4"><div className="flex gap-3"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" /><div><div className="font-semibold">This authorization request cannot continue</div><div className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{preparation.statusDetail}</div>{preparation.status === 'expired' && <ActionButton className="mt-3" disabled={busy} onClick={() => void refreshAuthorizationWindow()}>{busy ? 'Refreshing…' : 'Refresh authorization window'}</ActionButton>}</div></div></section>}

            <details className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5"><summary className="cursor-pointer text-sm font-semibold">Advanced · XDR / offline</summary><p className="mt-3 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Online signers normally use this authorization request directly. Export the prepared XDR only for an offline signer, external tool, or recovery path.</p><div className="mt-3 flex flex-wrap gap-2"><ActionButton variant="secondary" size="sm" onClick={() => void copyXdr()}><ClipboardCopy className="h-4 w-4" />{copied === 'xdr' ? 'XDR copied' : 'Copy prepared XDR'}</ActionButton><ActionButton variant="secondary" size="sm" onClick={() => setShowQr((value) => !value)}><QrCode className="h-4 w-4" />{showQr ? 'Hide QR' : 'Show QR'}</ActionButton></div>{showQr && <div className="mt-4"><XdrQrCode xdr={preparation.preparedXdr} /></div>}</details>
          </div>
          {error && <div className="mt-5 flex gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />{error}</div>}
        </div>
      </main>
    </StellarWorkspaceShell>
  );
}
