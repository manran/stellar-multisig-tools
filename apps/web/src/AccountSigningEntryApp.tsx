import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowRight, CircleAlert, KeyRound, ShieldCheck, Snowflake } from 'lucide-react';
import { ActionButton, NetworkFallbackChoice } from './MultiSigUi';
import type { NetworkFallbackChoiceSource } from './MultiSigUi';
import { useStellarWallet } from './StellarWalletContext';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { accountSigningIntentForRoute } from './stellar/accountSigningFlow';
import { isValidStellarAccountId, loadAccount } from '../../../packages/stellar-core/src/horizon';
import { resolveStellarNetwork } from './stellar/networkPreference';
import type { StellarNetwork } from '../../../packages/stellar-core/src/types';
import { navigateWorkspace } from './workspaceNavigation';

const OFFLINE_SETUP_STEPS = ['Public address', 'Signing policy', 'Review', 'Sign elsewhere', 'Return XDR or submit'] as const;

export default function AccountSigningEntryApp() {
  const wallet = useStellarWallet();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const requestedNetwork = params.get('network');
  const intent = accountSigningIntentForRoute(window.location.pathname, params.get('intent'), params.get('mode'));
  const offline = intent === 'offline';
  const [network, setNetwork] = useState<StellarNetwork>(() => resolveStellarNetwork(requestedNetwork, wallet.network));
  const [networkSource, setNetworkSource] = useState<NetworkFallbackChoiceSource>(() =>
    requestedNetwork === 'public' || requestedNetwork === 'testnet'
      ? 'human'
      : wallet.network
        ? wallet.networkSource === 'wallet' ? 'wallet' : 'context'
        : 'default',
  );
  const [accountId, setAccountId] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  async function continueToDesigner(event: FormEvent) {
    event.preventDefault();
    const account = accountId.trim();
    if (!isValidStellarAccountId(account)) {
      setError('Enter a valid Stellar G-address.');
      return;
    }
    setChecking(true);
    setError('');
    try {
      await loadAccount(account, network);
      const search = new URLSearchParams({ account, network, intent }).toString();
      navigateWorkspace('/account/signing/edit', { search });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load this Stellar account.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <StellarWorkspaceShell active="detail" networkContext={network}>
      <main className="px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <div className="mx-auto max-w-3xl">
          <div className={`mst-signing-entry-icon ${offline ? 'mst-signing-entry-icon--offline' : ''}`}>
            {offline ? <Snowflake className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
          </div>
          <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">{offline ? 'Set up multisig offline' : 'Set up or change multisig'}</h1>
          <p className="mt-3 text-base leading-7 text-neutral-600 dark:text-neutral-300">
            {offline
              ? 'Build the account-signing transaction here without using the account signing key in this browser. Review the exact XDR, then move it to an authorized signer.'
              : 'Choose any Stellar account and configure its signers and approval rules. If your connected wallet can authorize the account, you can continue to signing here; otherwise MultiSig Tools gives you the exact XDR for an authorized signer.'}
          </p>

          {offline && (
            <section className="mst-signing-path-section mt-7">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">Offline signing path</div>
              <ol className="mst-signing-path">
                {OFFLINE_SETUP_STEPS.map((label, index) => (
                  <li key={label} className="mst-signing-path__step">
                    <span className="mst-signing-path__number">{String(index + 1).padStart(2, '0')}</span>
                    <span className="font-semibold">{label}</span>
                  </li>
                ))}
              </ol>
              <div className="mst-signing-security-note"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><div><span className="font-semibold">Keep the signing secret offline.</span> Only the public G-address and transaction XDR need to move between environments.</div></div>
            </section>
          )}

          {!offline && (
            <section className="mst-signing-route-list mt-7">
              <div className="mst-signing-route-row"><div className="text-sm font-semibold">If you can authorize the account</div><p className="text-sm leading-6 text-neutral-500 dark:text-neutral-400">Review the change, create the Proposal, and sign with an authorized wallet.</p></div>
              <div className="mst-signing-route-row"><div className="text-sm font-semibold">If you are preparing it for someone else</div><p className="text-sm leading-6 text-neutral-500 dark:text-neutral-400">Review the same transaction and export its XDR. The authorized signer can import, sign, return the signed XDR, or submit it.</p></div>
            </section>
          )}

          <form onSubmit={continueToDesigner} className="mst-signing-entry-form mt-6">
            <NetworkFallbackChoice network={network} source={networkSource} context="this account" disabled={checking} onChange={(value) => { setNetwork(value); setNetworkSource('human'); setError(''); }} />
            <p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">The same G-address can exist on both Stellar networks. The selected network determines which account state is inspected and which transaction is built.</p>
            <label className="mt-5 block"><span className="text-sm font-semibold">Account public address</span><input value={accountId} onChange={(event) => setAccountId(event.target.value)} placeholder="G..." spellCheck={false} autoComplete="off" className="mst-signing-entry-control mt-2 w-full font-mono" /></label>
            {error && <div className="mt-4 flex gap-2 rounded-xl bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
            <ActionButton type="submit" disabled={checking || !accountId.trim()} className="mt-5">{checking ? 'Checking account…' : 'Continue to signing policy'} <ArrowRight className="h-4 w-4" /></ActionButton>
          </form>
        </div>
      </main>
    </StellarWorkspaceShell>
  );
}
