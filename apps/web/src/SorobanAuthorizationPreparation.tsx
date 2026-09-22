import { useEffect, useState } from 'react';
import { CircleAlert, KeyRound, LoaderCircle, Share2, ShieldCheck } from 'lucide-react';
import { ActionButton } from './MultiSigUi';
import { useStellarWallet } from './StellarWalletContext';
import { loadAccount } from '../../../packages/stellar-core/src/horizon';
import { analyzeSorobanGAccountAuthorization } from '../../../packages/stellar-core/src/sorobanAuthorization';
import type { SorobanGAccountAuthorizationStatus } from '../../../packages/stellar-core/src/sorobanAuthorization';
import { analyzeKnownSorobanContractAuthorization } from '../../../packages/stellar-core/src/sorobanContractAdapter';
import type { KnownSorobanContractAuthorizationStatus } from '../../../packages/stellar-core/src/sorobanContractAdapter';
import { privateSessionAddressHeaders } from '../../../packages/stellar-core/src/privateSessionTransport';
import type { StellarNetwork } from '../../../packages/stellar-core/src/types';
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
  | { status: 'contract'; xdr: string; authorization: KnownContractAuthorizer }
  | { status: 'blocked'; message: string };

function compactAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-8)}`;
}

export default function SorobanAuthorizationPreparation({ preparation, onPreparedXdrChange }: Props) {
  const wallet = useStellarWallet();
  const [state, setState] = useState<PreparationState>({ status: 'loading' });
  const [error, setError] = useState('');
  const [startingShared, setStartingShared] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError('');
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
      onPreparedXdrChange(analysis.ready ? preparation.xdr : null, analysis.ready);
    }).catch((cause) => {
      if (cancelled) return;
      const message = cause instanceof Error ? cause.message : 'Unable to load Soroban authorizer policies.';
      setState({ status: 'blocked', message });
      onPreparedXdrChange(null, false);
    });
    return () => { cancelled = true; };
  }, [preparation, onPreparedXdrChange]);

  async function startSharedAuthorization() {
    if ((state.status !== 'ready' && state.status !== 'contract') || startingShared) return;
    if (state.status === 'ready' && state.analysis.ready) return;
    setStartingShared(true);
    setError('');
    try {
      const verifiedAddress = wallet.privateUnlocked && wallet.unlockedNetwork === preparation.network
        ? wallet.unlockedAddress
        : await wallet.unlock(undefined, preparation.network);
      if (!verifiedAddress) throw new Error('Confirm a Stellar wallet before starting Intent authorization.');
      const response = await fetch('/api/intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...privateSessionAddressHeaders(verifiedAddress),
        },
        body: JSON.stringify({ network: preparation.network, preparedXdr: state.xdr }),
      });
      const body = await response.json() as { intent?: { id?: string }; error?: string };
      if (!response.ok) throw new Error(body.error || 'Unable to convert this prepared XDR into a Soroban Intent.');
      if (!body.intent?.id) throw new Error('MultiSigTools did not return a valid Soroban Intent.');
      navigateWorkspace('/a', { hash: body.intent.id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start Intent authorization.');
      setStartingShared(false);
    }
  }

  if (state.status === 'loading') {
    return <div className="mt-4 flex items-center gap-2 text-xs text-neutral-500"><LoaderCircle className="h-4 w-4 animate-spin" /> Preparing authorization requirements…</div>;
  }
  if (state.status === 'blocked') {
    return <div className="mt-4 flex gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] p-4 text-xs leading-5"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><div><div className="font-semibold">Authorization preparation blocked</div><div className="mt-1 text-neutral-600 dark:text-neutral-300">{state.message}</div></div></div>;
  }
  if (state.status === 'contract') {
    return (
      <div className="mt-5 border-t border-black/10 pt-5 dark:border-white/10">
        <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-violet-600" /><h3 className="font-semibold">Configured contract-account authorization</h3></div>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-neutral-500 dark:text-neutral-400">This C-account matches an explicit project adapter. MultiSig Tools will discard the imported transaction shell, preserve the detached authorization entry as an Intent AuthorizationPlan, and let the configured owner contribute its custom credential on the shared Intent page.</p>
        <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
          <div className="rounded-xl bg-black/[0.03] p-3 dark:bg-white/[0.04]"><div className="text-neutral-400">Adapter provenance</div><div className="mt-1 font-semibold">{state.authorization.adapter.label} · project configured</div></div>
          <div className="rounded-xl bg-black/[0.03] p-3 dark:bg-white/[0.04]"><div className="text-neutral-400">Authorization model</div><div className="mt-1 font-semibold">Intent-first · detached custom credential</div></div>
        </div>
        <div className="mt-3 rounded-xl border border-black/10 p-3 text-xs dark:border-white/10">
          <div className="text-neutral-400">Contract account</div><div className="mt-1 break-all font-mono text-[11px]">{state.authorization.adapter.contractAddress}</div>
          <div className="mt-3 text-neutral-400">Configured owner wallet</div><div className="mt-1 break-all font-mono text-[11px]">{state.authorization.adapter.ownerAddress}</div>
        </div>
        <div className="mt-4 rounded-xl bg-black/[0.03] p-4 dark:bg-white/[0.04]">
          <div className="flex items-center gap-2 text-xs font-semibold"><KeyRound className="h-4 w-4" /> Continue as source-free Intent</div>
          <p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">The configured owner signs the detached AUTH payload on the Intent page. RPC enforcing simulation happens only after AUTH is complete and a fresh executor/source is selected.</p>
          <ActionButton className="mt-3" variant="primary" size="sm" disabled={startingShared || wallet.authBusy} onClick={() => void startSharedAuthorization()}>{startingShared || wallet.authBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}{startingShared || wallet.authBusy ? 'Creating Intent…' : 'Continue as Soroban Intent'}</ActionButton>
        </div>
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
            <ActionButton variant="primary" size="sm" disabled={startingShared || wallet.authBusy} onClick={() => void startSharedAuthorization()}>{startingShared || wallet.authBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}{startingShared || wallet.authBusy ? 'Creating Intent…' : 'Continue as Soroban Intent'}</ActionButton>
          </div>
          <div className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Prepared transaction fields are discarded here. Authorization continues as a source-free Intent; the executor and final transaction are chosen only after detached authorization is complete.</div>
        </div>
      )}

      {state.analysis.ready && <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-4 text-sm"><div className="font-semibold text-emerald-800 dark:text-emerald-300">Detached authorization evidence found</div><div className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">Continue as an Intent. MultiSig Tools will preserve detached authorization evidence but discard the imported transaction shell before any final transaction is constructed.</div></div>}
      {error && <div className="mt-3 flex gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.08] p-3 text-xs"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />{error}</div>}
    </div>
  );
}
