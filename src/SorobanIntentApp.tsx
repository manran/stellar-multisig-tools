import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, KeyRound, LoaderCircle, RefreshCw, Share2 } from 'lucide-react';
import { xdr } from '@stellar/stellar-sdk/base';
import { ActionButton, NetworkFact, StatusBadge, WorkflowProgress } from './MultiSigUi';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useStellarWallet } from './StellarWalletContext';
import {
  sorobanAuthorizationEntryPreimageXdr,
} from './stellar/sorobanAuthorization';
import type {
  SorobanIntentAuthorizationSnapshot,
  SorobanIntentContributionResponse,
  SorobanIntentExecutionResponse,
  SorobanIntentResponse,
  StoredSorobanIntentSnapshot,
} from './stellar/sorobanIntentApiTypes';
import { inspectSorobanAuthorizationEntry } from './stellar/sorobanInspection';
import { isValidStellarAccountId } from './stellar/horizon';
import { privateSessionAddressHeaders } from './stellar/privateSessionTransport';
import { writeReviewHandoff } from './stellar/reviewHandoff';
import { navigateWorkspace, stellarHref } from './workspaceNavigation';

const POLL_INTERVAL_MS = 15_000;

interface ApiError {
  error?: string;
  code?: string;
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
    throw new Error(error.error || `MultiSigTools returned HTTP ${response.status}.`);
  }
  return body as T;
}

function statusPresentation(authorization: SorobanIntentAuthorizationSnapshot) {
  if (authorization.status === 'authorization_ready') return { label: 'Contract authorization complete', tone: 'success' as const };
  if (authorization.status === 'awaiting_authorization') return { label: 'Collecting contract authorization', tone: 'warning' as const };
  if (authorization.status === 'expired') return { label: 'Authorization expired', tone: 'danger' as const };
  return { label: 'Authorization blocked', tone: 'danger' as const };
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

  async function prepareExecution() {
    if (!intent || !authorization || authorization.status !== 'authorization_ready' || busy) return;
    if (!isValidStellarAccountId(executionSource)) {
      setError('Enter a valid Stellar G... account to provide the final transaction sequence and fee.');
      return;
    }
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
        body: JSON.stringify({ executionSource }),
      });
      const body = await apiJson<SorobanIntentExecutionResponse>(response);
      writeReviewHandoff(sessionStorage, {
        xdr: body.execution.xdr,
        network: intent.network,
        privateNote: intent.privateContext?.initialPrivateNote?.text ?? null,
      });
      navigateWorkspace('/signing-room', {
        state: {
          returnTo: `${stellarHref('/a')}#${intent.id}`,
          returnLabel: 'Back to contract authorization',
          autoSorobanSimulation: false,
        },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to prepare the final transaction.');
      setBusy(false);
    }
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

  const status = statusPresentation(authorization);
  return (
    <StellarWorkspaceShell active="inbox" networkContext={intent.network}>
      <main className="px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-5xl">
          <WorkflowProgress current="review" />
          <div className="mt-6 flex flex-wrap items-start justify-between gap-4 border-b border-black/10 pb-5 dark:border-white/10">
            <div><a href={stellarHref('/inbox')} className="text-sm font-semibold text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white">← Inbox</a><h1 className="mt-2 text-3xl font-bold tracking-tight">Contract authorization</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">Authorize the contract Intent first. The final transaction source, sequence, fee and envelope signatures are chosen only after authorization is complete.</p></div>
            <NetworkFact network={intent.network} />
          </div>

          <div className="mt-6 space-y-5">
            <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3"><StatusBadge tone={status.tone}>{status.label}</StatusBadge><span className="font-mono text-xs text-neutral-400">{intent.id}</span></div>
              <div className="mt-3 break-all font-mono text-[11px] text-neutral-500">Intent {intent.intent.intentDigest}</div>
              {authorization.statusDetail && <p className="mt-3 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{authorization.statusDetail}</p>}
              <div className="mt-4 flex flex-wrap gap-2"><ActionButton variant="secondary" size="sm" onClick={() => void copyShareLink()}><Share2 className="h-4 w-4" />{copied ? 'Intent link copied' : 'Share with another signer'}</ActionButton><ActionButton variant="secondary" size="sm" onClick={() => void loadIntent(sessionAddress)}><RefreshCw className="h-4 w-4" />Refresh</ActionButton></div>
            </section>

            {intent.privateContext?.initialPrivateNote && <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5 sm:p-6"><div className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">Private Note</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-700 dark:text-neutral-200">{intent.privateContext.initialPrivateNote.text}</p></section>}

            {invocationFacts.length > 0 && <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5 sm:p-6"><h2 className="text-xl font-bold">Authorized invocation</h2><div className="mt-4 space-y-3">{invocationFacts.map((fact, index) => <div key={`${fact.label}-${index}`} className="rounded-xl bg-black/[0.03] p-4 text-sm dark:bg-white/[0.04]"><div className="font-semibold">{fact.label}</div>{fact.detail && <div className="mt-1 break-all font-mono text-xs text-neutral-500">{fact.detail}</div>}{fact.argumentPreviews.length > 0 && <div className="mt-2 text-xs text-neutral-500">{fact.argumentPreviews.join(' · ')}</div>}</div>)}</div></section>}

            <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5 sm:p-6">
              <h2 className="text-xl font-bold">Required authorization</h2>
              <div className="mt-4 space-y-3">{authorization.authorizers.map((authorizer) => <div key={authorizer.entryIndex} className="rounded-xl border border-black/10 p-4 text-sm dark:border-white/10"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold">{compactAddress(authorizer.authorizer)}</div><div className={authorizer.ready ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'font-semibold text-neutral-500'}>{authorizer.threshold === 0 ? (authorizer.ready ? 'Signature present' : 'Signature required') : `${authorizer.signedWeight} / ${authorizer.threshold} approval power`}</div></div><div className="mt-2 flex flex-wrap gap-2">{authorizer.signerEvidence.length ? authorizer.signerEvidence.map((signer) => <span key={signer.publicKey} className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300">{compactAddress(signer.publicKey)} · +{signer.weight}</span>) : <span className="text-xs text-neutral-500">Waiting for signer authorization.</span>}</div></div>)}</div>
              {authorization.status === 'awaiting_authorization' && <div className="mt-5 rounded-xl bg-black/[0.03] p-4 dark:bg-white/[0.04]"><div className="text-sm font-semibold">Your action</div><p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Selected verified wallet: {sessionAddress ? compactAddress(sessionAddress) : 'none'}.</p><div className="mt-3 flex flex-wrap gap-2">{targetsForSigner.length > 0 && wallet.networkSource !== 'application' && <ActionButton disabled={busy} onClick={() => void authorize()}><KeyRound className="h-4 w-4" />{busy ? 'Authorizing…' : 'Authorize contract Intent'}</ActionButton>}<ActionButton variant="secondary" disabled={busy || wallet.busy} onClick={() => void confirmSigner()}>{sessionAddress ? 'Choose another signer' : 'Choose signer'}</ActionButton></div>{targetsForSigner.length === 0 && sessionAddress && <p className="mt-2 text-xs text-neutral-500">This wallet has no remaining AUTH contribution. Share the Intent link with another current signer.</p>}{targetsForSigner.length > 0 && wallet.networkSource === 'application' && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Ledger and Trezor can sign the final transaction envelope but not detached Soroban AUTH entries. Choose another current signer for this step.</p>}</div>}
            </section>

            {authorization.status === 'authorization_ready' && <section className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] p-5 sm:p-6"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /><div><h2 className="text-xl font-bold">Authorization ready</h2><p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">AUTH collection is complete. Choose the account that should now provide the fresh transaction sequence and fee. This choice does not change the already-authorized contract invocation.</p></div></div><div className="mt-5"><label htmlFor="intent-execution-source" className="text-sm font-semibold">Transaction source / executor</label><div className="mt-2 flex flex-col gap-2 sm:flex-row"><input id="intent-execution-source" value={executionSource} onChange={(event) => setExecutionSource(event.target.value.trim())} placeholder="G... executor account" spellCheck={false} className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-4 py-3 font-mono text-sm outline-none dark:border-white/10 dark:bg-black/20" /><ActionButton disabled={busy || !isValidStellarAccountId(executionSource)} onClick={() => void prepareExecution()}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}{busy ? 'Preparing transaction…' : 'Prepare transaction'}</ActionButton></div>{sessionAddress && executionSource !== sessionAddress && <button type="button" className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300" onClick={() => setExecutionSource(sessionAddress)}>Use my verified wallet as executor</button>}<p className="mt-3 text-xs leading-5 text-neutral-500 dark:text-neutral-400">The prepared unsigned XDR goes to the ordinary Signing Room. A single-signature executor may sign it directly; a multisig executor continues through the existing Proposal flow; another operator can receive the XDR separately.</p></div></section>}

            {(authorization.status === 'expired' || authorization.status === 'blocked') && <section className="rounded-2xl border border-red-500/25 bg-red-500/[0.07] p-4"><div className="flex gap-3"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" /><div><div className="font-semibold">This Intent cannot continue</div><div className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{authorization.statusDetail || 'The current Soroban authorization is no longer usable.'}</div></div></div></section>}
          </div>
          {error && <div className="mt-5 flex gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />{error}</div>}
        </div>
      </main>
    </StellarWorkspaceShell>
  );
}
