import { useEffect, useMemo, useState } from 'react';
import { CircleAlert, ClipboardCopy, KeyRound, LoaderCircle, QrCode, Share2, ShieldCheck } from 'lucide-react';
import { ActionButton } from './MultiSigUi';
import XdrQrCode from './XdrQrCode';
import { useStellarWallet } from './StellarWalletContext';
import { loadAccount, loadNetworkParameters } from './stellar/horizon';
import {
  DEFAULT_SOROBAN_AUTH_EXPIRATION_LEDGERS,
  analyzeSorobanGAccountAuthorization,
  mergeSorobanGAccountSignature,
  sorobanAuthorizationPreimageXdr,
} from './stellar/sorobanAuthorization';
import type { SorobanGAccountAuthorizationStatus } from './stellar/sorobanAuthorization';
import {
  analyzeKnownSorobanContractAuthorization,
  simpleEd25519ContractCredentialContribution,
} from './stellar/sorobanContractAdapter';
import type { KnownSorobanContractAuthorizationStatus } from './stellar/sorobanContractAdapter';
import {
  createSorobanContractAuthorizationChallenge,
  stageSorobanContractCredentialContribution,
} from './stellar/sorobanCustomAuthorization';
import { prepareEnforcedSorobanTransaction } from './stellar/sorobanRpc';
import type { SorobanPreparationResponse } from './stellar/sorobanPreparationTypes';
import type { StellarNetwork } from './stellar/types';
import { navigateWorkspace } from './workspaceNavigation';

export interface SorobanAuthorizationPreparationInput {
  xdr: string;
  network: StellarNetwork;
  currentLedger: number;
  endpointUrl: string;
  source: 'record-simulation' | 'imported-prepared';
}

interface Props {
  preparation: SorobanAuthorizationPreparationInput;
  onPreparedXdrChange: (xdr: string | null, ready: boolean) => void;
}

type KnownContractAuthorizer = NonNullable<KnownSorobanContractAuthorizationStatus['authorizer']>;

type PreparationState =
  | { status: 'loading' }
  | { status: 'ready'; xdr: string; analysis: SorobanGAccountAuthorizationStatus; currentLedger: number }
  | { status: 'contract'; xdr: string; authorization: KnownContractAuthorizer; currentLedger: number; enforced: boolean }
  | { status: 'blocked'; message: string };

function compactAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-8)}`;
}

export default function SorobanAuthorizationPreparation({ preparation, onPreparedXdrChange }: Props) {
  const wallet = useStellarWallet();
  const [state, setState] = useState<PreparationState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copiedHandoff, setCopiedHandoff] = useState(false);
  const [showHandoffQr, setShowHandoffQr] = useState(false);
  const [startingShared, setStartingShared] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError('');
    setCopiedHandoff(false);
    setShowHandoffQr(false);
    setState({ status: 'loading' });
    try {
      const contractAuthorization = analyzeKnownSorobanContractAuthorization({
        envelopeXdr: preparation.xdr,
        network: preparation.network,
        currentLedger: preparation.currentLedger,
      });
      if (contractAuthorization.supported && contractAuthorization.authorizer) {
        if (contractAuthorization.authorizer.signed) {
          const message = 'This imported contract-account authorization already contains custom credential evidence. Re-record authorization from an unsigned transaction so Review can establish adapter provenance before signing.';
          setState({ status: 'blocked', message });
          onPreparedXdrChange(null, false);
          return () => { cancelled = true; };
        }
        setState({
          status: 'contract',
          xdr: preparation.xdr,
          authorization: contractAuthorization.authorizer,
          currentLedger: preparation.currentLedger,
          enforced: false,
        });
        onPreparedXdrChange(null, false);
        return () => { cancelled = true; };
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to resolve the configured contract-account adapter.';
      setState({ status: 'blocked', message });
      onPreparedXdrChange(null, false);
      return () => { cancelled = true; };
    }
    void analyzeSorobanGAccountAuthorization({
      envelopeXdr: preparation.xdr,
      network: preparation.network,
      currentLedger: preparation.currentLedger,
      accountLoader: loadAccount,
    }).then((analysis) => {
      if (cancelled) return;
      if (!analysis.supported) {
        setState({ status: 'blocked', message: analysis.reason ?? 'This Soroban authorization shape is not supported yet.' });
        onPreparedXdrChange(null, false);
        return;
      }
      setState({ status: 'ready', xdr: preparation.xdr, analysis, currentLedger: preparation.currentLedger });
      onPreparedXdrChange(preparation.xdr, analysis.ready);
    }).catch((cause) => {
      if (cancelled) return;
      const message = cause instanceof Error ? cause.message : 'Unable to load Soroban authorizer policies.';
      setState({ status: 'blocked', message });
      onPreparedXdrChange(null, false);
    });
    return () => { cancelled = true; };
  }, [preparation, onPreparedXdrChange]);

  const hardwareWalletSelected = wallet.networkSource === 'application';
  const hardwareAuthEntryMessage = 'The selected hardware wallet can sign the final Stellar transaction envelope, but Ledger and Trezor do not support detached Soroban authorization-entry signing. Choose another current signer wallet for this authorization step.';

  const targetsForWallet = useMemo(() => {
    if (state.status !== 'ready' || !wallet.address) return [];
    return state.analysis.authorizers.filter((authorizer) =>
      !authorizer.ready
      && authorizer.activeSigners.some((signer) => signer.publicKey === wallet.address)
      && !authorizer.signerEvidence.some((signer) => signer.publicKey === wallet.address),
    );
  }, [state, wallet.address]);

  const selectedWalletCanFinishAuthorization = useMemo(() => {
    if (state.status !== 'ready' || state.analysis.ready || !wallet.address) return false;
    return state.analysis.authorizers.filter((authorizer) => !authorizer.ready).every((authorizer) => {
      const signer = authorizer.activeSigners.find((candidate) => candidate.publicKey === wallet.address);
      if (!signer || authorizer.signerEvidence.some((evidence) => evidence.publicKey === wallet.address)) return false;
      return authorizer.threshold === 0 || authorizer.signedWeight + signer.weight >= authorizer.threshold;
    });
  }, [state, wallet.address]);

  const preferSharedAuthorization = state.status === 'ready'
    && !state.analysis.ready
    && state.analysis.authorizers.some((authorizer) => !authorizer.ready)
    && !selectedWalletCanFinishAuthorization;

  const signerGuidance = useMemo(() => {
    if (state.status !== 'ready' || state.analysis.ready || !wallet.address) return '';
    if (hardwareWalletSelected && targetsForWallet.length > 0) return hardwareAuthEntryMessage;
    if (targetsForWallet.length > 0) return '';
    const remaining = state.analysis.authorizers.filter((authorizer) => !authorizer.ready);
    const activeFor = remaining.filter((authorizer) => authorizer.activeSigners.some((signer) => signer.publicKey === wallet.address));
    if (activeFor.some((authorizer) => authorizer.signerEvidence.some((signer) => signer.publicKey === wallet.address))) {
      return 'Your signature is already included. Another current signer can continue this authorization here or on another device.';
    }
    const account = remaining[0]?.authorizer;
    return account
      ? `The remaining authorization belongs to ${compactAddress(account)}. Choose one of that account's current signers.`
      : 'Choose a current signer for the remaining contract authorization.';
  }, [state, wallet.address, targetsForWallet, hardwareWalletSelected]);

  async function chooseSignerWallet() {
    setError('');
    try {
      await wallet.connect();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to select a signer wallet.');
    }
  }

  async function startSharedAuthorization() {
    if (state.status !== 'ready' || state.analysis.ready || busy || startingShared) return;
    setStartingShared(true);
    setError('');
    try {
      const verifiedAddress = wallet.privateUnlocked && wallet.unlockedNetwork === preparation.network
        ? wallet.unlockedAddress
        : await wallet.unlock(undefined, preparation.network);
      if (!verifiedAddress) throw new Error('Confirm a current signer wallet before starting shared authorization.');
      const response = await fetch('/api/preparation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ network: preparation.network, xdr: state.xdr }),
      });
      const body = await response.json() as SorobanPreparationResponse & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Unable to start shared contract authorization.');
      if (!body.preparation?.id || !body.capability) throw new Error('MultiSigTools did not return a valid private authorization request.');
      navigateWorkspace('/a', { hash: `${body.preparation.id}${body.capability}` });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start shared contract authorization.');
      setStartingShared(false);
    }
  }

  async function copyAuthorizationHandoff() {
    if (state.status !== 'ready') return;
    await navigator.clipboard.writeText(state.xdr);
    setCopiedHandoff(true);
  }

  async function authorizeContractAccountWithWallet() {
    if (state.status !== 'contract' || state.enforced || busy) return;
    setBusy(true);
    setError('');
    try {
      let signerAddress = wallet.address;
      if (!signerAddress) signerAddress = await wallet.connect();
      if (signerAddress !== state.authorization.adapter.ownerAddress) {
        throw new Error('Select the configured owner wallet for this contract-account adapter.');
      }
      const parameters = await loadNetworkParameters(preparation.network);
      const currentLedger = parameters.ledgerSequence;
      const expirationLedger = currentLedger + DEFAULT_SOROBAN_AUTH_EXPIRATION_LEDGERS;
      const challenge = createSorobanContractAuthorizationChallenge({
        envelopeXdr: state.xdr,
        network: preparation.network,
        entryIndex: state.authorization.entryIndex,
        expirationLedger,
      });
      const signed = await wallet.signAuthEntry(challenge.preimageXdr, preparation.network);
      const contribution = simpleEd25519ContractCredentialContribution({
        challenge,
        adapter: state.authorization.adapter,
        signerAddress: signed.signerAddress,
        signatureBase64: signed.signatureBase64,
      });
      const staged = await stageSorobanContractCredentialContribution({
        envelopeXdr: state.xdr,
        challenge,
        contribution,
      });
      const enforced = await prepareEnforcedSorobanTransaction({
        envelopeXdr: staged.envelopeXdr,
        network: preparation.network,
        endpointUrl: preparation.endpointUrl,
      });
      const analysis = analyzeKnownSorobanContractAuthorization({
        envelopeXdr: enforced.assembledXdr,
        network: preparation.network,
        currentLedger: enforced.latestLedger,
      });
      if (!analysis.supported || !analysis.ready || !analysis.authorizer) {
        throw new Error(analysis.reason ?? 'The contract-account credential did not become enforce-ready.');
      }
      setState({
        status: 'contract',
        xdr: enforced.assembledXdr,
        authorization: analysis.authorizer,
        currentLedger: enforced.latestLedger,
        enforced: true,
      });
      onPreparedXdrChange(enforced.assembledXdr, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to prepare this contract-account authorization.');
      onPreparedXdrChange(null, false);
    } finally {
      setBusy(false);
    }
  }

  async function authorizeWithWallet() {
    if (state.status !== 'ready' || busy) return;
    setBusy(true);
    setError('');
    try {
      if (hardwareWalletSelected) throw new Error(hardwareAuthEntryMessage);
      let signerAddress = wallet.address;
      if (!signerAddress) signerAddress = await wallet.connect();
      const parameters = await loadNetworkParameters(preparation.network);
      const currentLedger = parameters.ledgerSequence;
      let workingXdr = state.xdr;
      let analysis = await analyzeSorobanGAccountAuthorization({
        envelopeXdr: workingXdr,
        network: preparation.network,
        currentLedger,
        accountLoader: loadAccount,
      });
      if (!analysis.supported) throw new Error(analysis.reason ?? 'This Soroban authorization shape is not supported yet.');
      const targets = analysis.authorizers.filter((authorizer) =>
        !authorizer.ready
        && authorizer.activeSigners.some((signer) => signer.publicKey === signerAddress)
        && !authorizer.signerEvidence.some((signer) => signer.publicKey === signerAddress),
      );
      if (targets.length === 0) {
        throw new Error('Choose a current signer for the remaining contract authorization.');
      }
      for (const target of targets) {
        const expirationLedger = target.expirationLedger > currentLedger
          ? target.expirationLedger
          : currentLedger + DEFAULT_SOROBAN_AUTH_EXPIRATION_LEDGERS;
        const preimageXdr = sorobanAuthorizationPreimageXdr({
          envelopeXdr: workingXdr,
          network: preparation.network,
          entryIndex: target.entryIndex,
          expirationLedger,
        });
        const signed = await wallet.signAuthEntry(preimageXdr, preparation.network);
        if (!target.activeSigners.some((signer) => signer.publicKey === signed.signerAddress)) {
          throw new Error('The wallet that signed this authorization is not an active signer for the G-account authorizer.');
        }
        workingXdr = await mergeSorobanGAccountSignature({
          envelopeXdr: workingXdr,
          network: preparation.network,
          entryIndex: target.entryIndex,
          signerPublicKey: signed.signerAddress,
          signatureBase64: signed.signatureBase64,
          expirationLedger,
        });
      }
      analysis = await analyzeSorobanGAccountAuthorization({
        envelopeXdr: workingXdr,
        network: preparation.network,
        currentLedger,
        accountLoader: loadAccount,
      });
      if (!analysis.supported) throw new Error(analysis.reason ?? 'Unable to verify the updated Soroban authorization.');
      setState({ status: 'ready', xdr: workingXdr, analysis, currentLedger });
      onPreparedXdrChange(workingXdr, analysis.ready);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to add this Soroban authorization signature.');
    } finally {
      setBusy(false);
    }
  }

  if (state.status === 'loading') {
    return <div className="mt-4 flex items-center gap-2 text-xs text-neutral-500"><LoaderCircle className="h-4 w-4 animate-spin" /> Preparing authorization requirements…</div>;
  }
  if (state.status === 'blocked') {
    return <div className="mt-4 flex gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] p-4 text-xs leading-5"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><div><div className="font-semibold">Authorization preparation blocked</div><div className="mt-1 text-neutral-600 dark:text-neutral-300">{state.message}</div></div></div>;
  }
  if (state.status === 'contract') {
    const selectedOwner = wallet.address === state.authorization.adapter.ownerAddress;
    return (
      <div className="mt-5 border-t border-black/10 pt-5 dark:border-white/10">
        <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-violet-600" /><h3 className="font-semibold">Known contract-account adapter</h3></div>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-neutral-500 dark:text-neutral-400">Review matched this C-account to one explicit project configuration. The adapter only defines how the configured owner wallet's raw Ed25519 authorization signature is encoded for this account contract. Contract/network execution remains authoritative for validity.</p>
        <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
          <div className="rounded-xl bg-black/[0.03] p-3 dark:bg-white/[0.04]"><div className="text-neutral-400">Adapter provenance</div><div className="mt-1 font-semibold">{state.authorization.adapter.label} · project configured</div></div>
          <div className="rounded-xl bg-black/[0.03] p-3 dark:bg-white/[0.04]"><div className="text-neutral-400">Authorization state</div><div className={state.enforced ? 'mt-1 font-semibold text-emerald-700 dark:text-emerald-300' : 'mt-1 font-semibold'}>{state.enforced ? 'Credential enforced and resources refreshed' : 'Owner signature required'}</div></div>
        </div>
        <div className="mt-3 rounded-xl border border-black/10 p-3 text-xs dark:border-white/10">
          <div className="text-neutral-400">Contract account</div><div className="mt-1 break-all font-mono text-[11px]">{state.authorization.adapter.contractAddress}</div>
          <div className="mt-3 text-neutral-400">Configured owner wallet</div><div className="mt-1 break-all font-mono text-[11px]">{state.authorization.adapter.ownerAddress}</div>
        </div>
        {!state.enforced && (
          <div className="mt-4 rounded-xl bg-black/[0.03] p-4 dark:bg-white/[0.04]">
            <div className="flex items-center gap-2 text-xs font-semibold"><KeyRound className="h-4 w-4" /> Authorize with the configured owner</div>
            <div className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Selected wallet: {wallet.address ? compactAddress(wallet.address) : 'none'}. MultiSig Tools signs the exact Review-owned Soroban authorization challenge, stages one contract-defined ScVal credential, then immediately runs RPC enforce-and-reprepare before allowing Proposal freeze.</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedOwner && !hardwareWalletSelected && <ActionButton variant="primary" size="sm" disabled={busy} onClick={() => void authorizeContractAccountWithWallet()}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}{busy ? 'Authorizing…' : 'Authorize contract account'}</ActionButton>}
              <ActionButton variant={selectedOwner && hardwareWalletSelected ? 'primary' : 'secondary'} size="sm" disabled={busy || wallet.busy} onClick={() => void chooseSignerWallet()}>Choose owner wallet</ActionButton>
            </div>
            {wallet.address && !selectedOwner && <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">This wallet is not the configured owner for this C-account.</div>}
            {selectedOwner && hardwareWalletSelected && <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">{hardwareAuthEntryMessage}</div>}
          </div>
        )}
        {state.enforced && <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-4 text-sm"><div className="font-semibold text-emerald-800 dark:text-emerald-300">Contract authorization enforced</div><div className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">The custom credential passed RPC enforce and the transaction was re-prepared with the enforcing simulation's resource output. This exact XDR can now cross the ordinary Proposal freeze boundary.</div></div>}
        {error && <div className="mt-3 flex gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.08] p-3 text-xs"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />{error}</div>}
      </div>
    );
  }

  return (
    <div className="mt-5 border-t border-black/10 pt-5 dark:border-white/10">
      <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-violet-600" /><h3 className="font-semibold">Authorization preparation</h3></div>
      <p className="mt-2 max-w-3xl text-xs leading-5 text-neutral-500 dark:text-neutral-400">{preparation.source === 'imported-prepared' ? 'This imported prepared XDR keeps its existing Soroban authorization evidence. Detached G-account authorizers can continue adding signatures without running recording simulation again.' : 'Simulation has assembled the execution resources. Detached G-account authorizers must provide at least one current signer signature and meet their current medium threshold before the final transaction XDR can be frozen for envelope signing.'}</p>

      {state.analysis.authorizers.length === 0 ? (
        <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-4 text-sm"><div className="font-semibold text-emerald-800 dark:text-emerald-300">Ready for envelope signing</div><div className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">All Soroban authorization is covered by the transaction source. No detached auth-entry signature is required.</div></div>
      ) : (
        <div className="mt-4 space-y-3">
          {state.analysis.authorizers.map((authorizer) => (
            <div key={authorizer.entryIndex} className="rounded-xl border border-black/10 p-4 text-xs dark:border-white/10">
              <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold">G-account authorizer · {compactAddress(authorizer.authorizer)}</div><div className={authorizer.ready ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'font-semibold text-neutral-500'}>{authorizer.threshold === 0 ? (authorizer.ready ? 'Signature present · medium threshold 0' : 'Signature required · medium threshold 0') : `${authorizer.signedWeight} / ${authorizer.threshold} approval power`}</div></div>
              <div className="mt-1 break-all font-mono text-[11px] text-neutral-500">{authorizer.authorizer}</div>
              <div className="mt-3 flex flex-wrap gap-2">{authorizer.signerEvidence.length > 0 ? authorizer.signerEvidence.map((signer) => <span key={signer.publicKey} className="rounded-full bg-emerald-500/10 px-2.5 py-1 font-semibold text-emerald-800 dark:text-emerald-300">{compactAddress(signer.publicKey)} · +{signer.weight}</span>) : <span className="text-neutral-500">No detached signatures yet.</span>}</div>
              {authorizer.expirationLedger > state.currentLedger && <div className="mt-3 text-neutral-500">Authorization valid through ledger {authorizer.expirationLedger}.</div>}
            </div>
          ))}
        </div>
      )}

      {!state.analysis.ready && (
        <div className="mt-4 rounded-xl bg-black/[0.03] p-4 dark:bg-white/[0.04]">
          <div className="flex items-center gap-2 text-xs font-semibold"><KeyRound className="h-4 w-4" /> Sign with a current G-account signer</div>
          <div className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Selected wallet: {wallet.address ? compactAddress(wallet.address) : 'none'}. Each wallet signature is verified against the exact CAP-71 authorization payload and current Horizon signer weights before it is retained.</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {preferSharedAuthorization ? (
              <>
                <ActionButton variant="primary" size="sm" disabled={busy || startingShared || wallet.authBusy} onClick={() => void startSharedAuthorization()}>{startingShared || wallet.authBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}{startingShared || wallet.authBusy ? 'Starting…' : 'Share authorization request'}</ActionButton>
                <ActionButton variant="secondary" size="sm" disabled={busy || startingShared || wallet.busy} onClick={() => void chooseSignerWallet()}>Choose another signer</ActionButton>
              </>
            ) : targetsForWallet.length > 0 && !hardwareWalletSelected ? (
              <>
                <ActionButton variant="primary" size="sm" disabled={busy} onClick={() => void authorizeWithWallet()}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}{busy ? 'Authorizing…' : 'Authorize contract call'}</ActionButton>
                <ActionButton variant="secondary" size="sm" disabled={busy || wallet.busy} onClick={() => void chooseSignerWallet()}>Choose another signer</ActionButton>
              </>
            ) : (
              <ActionButton variant="primary" size="sm" disabled={busy || wallet.busy} onClick={() => void chooseSignerWallet()}>{wallet.address ? 'Choose another signer' : 'Choose signer'}</ActionButton>
            )}
          </div>
          {preferSharedAuthorization && <div className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Another signer is needed. Create a private authorization request so another signer can review and authorize from their own device; MultiSig Tools combines the valid contributions.</div>}
          {!preferSharedAuthorization && signerGuidance && <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">{signerGuidance}</div>}
          <details className="mt-4 border-t border-black/10 pt-4 dark:border-white/10">
            <summary className="cursor-pointer text-xs font-semibold text-neutral-500 dark:text-neutral-400">Offline / XDR fallback</summary>
            <p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Use XDR only for an offline signer, an external signing tool, or recovery. Online signers should use the shared authorization request instead.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <ActionButton variant="secondary" size="sm" onClick={() => void copyAuthorizationHandoff()}><ClipboardCopy className="h-4 w-4" />{copiedHandoff ? 'Authorization XDR copied' : 'Copy authorization XDR'}</ActionButton>
              <ActionButton variant="secondary" size="sm" aria-expanded={showHandoffQr} onClick={() => setShowHandoffQr((visible) => !visible)}><QrCode className="h-4 w-4" />{showHandoffQr ? 'Hide authorization QR' : 'Show authorization QR'}</ActionButton>
            </div>
            {showHandoffQr && <div className="mt-4"><XdrQrCode xdr={state.xdr} /></div>}
          </details>
        </div>
      )}

      {state.analysis.ready && state.analysis.authorizers.length > 0 && <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-4 text-sm"><div className="font-semibold text-emerald-800 dark:text-emerald-300">Soroban authorization complete</div><div className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">Every detached G-account authorization meets its current medium threshold. This exact XDR can now be frozen before transaction-envelope signatures are collected.</div></div>}
      {state.analysis.ready && <p className="mt-3 text-[11px] leading-5 text-neutral-500 dark:text-neutral-400">When you continue to signatures, the server sends this exact frozen XDR to its configured Stellar RPC provider once in enforce mode to verify contract authorization before creating the Proposal. The same enforce check runs again immediately before Submit.</p>}
      {error && <div className="mt-3 flex gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.08] p-3 text-xs"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />{error}</div>}
    </div>
  );
}
