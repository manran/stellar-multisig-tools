import { useEffect, useState } from 'react';
import { CircleAlert, KeyRound, LoaderCircle, Share2, ShieldCheck } from 'lucide-react';
import { ActionButton } from './MultiSigUi';
import { useStellarWallet } from './StellarWalletContext';
import { loadAccount, loadNetworkParameters } from './stellar/horizon';
import {
  DEFAULT_SOROBAN_AUTH_EXPIRATION_LEDGERS,
  analyzeSorobanGAccountAuthorization,
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
import { privateSessionAddressHeaders } from './stellar/privateSessionTransport';
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
      onPreparedXdrChange(null, false);
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
      setError(cause instanceof Error ? cause.message : 'Unable to start shared contract authorization.');
      setStartingShared(false);
    }
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
            <ActionButton variant="primary" size="sm" disabled={busy || startingShared || wallet.authBusy} onClick={() => void startSharedAuthorization()}>{startingShared || wallet.authBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}{startingShared || wallet.authBusy ? 'Creating Intent…' : 'Continue as Soroban Intent'}</ActionButton>
          </div>
          <div className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Prepared transaction fields are discarded here. Authorization continues as a source-free Intent; the executor and final transaction are chosen only after detached authorization is complete.</div>
        </div>
      )}

      {state.analysis.ready && <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-4 text-sm"><div className="font-semibold text-emerald-800 dark:text-emerald-300">Detached authorization evidence found</div><div className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">Continue as an Intent. MultiSig Tools will preserve detached authorization evidence but discard the imported transaction shell before any final transaction is constructed.</div></div>}
      {error && <div className="mt-3 flex gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.08] p-3 text-xs"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />{error}</div>}
    </div>
  );
}
