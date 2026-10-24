import { lazy, Suspense, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Braces, Clock3, FileInput, KeyRound, Send, UserPlus, UsersRound } from 'lucide-react';
import PaymentComposer from './PaymentComposer';
import ClaimablePaymentComposer from './ClaimablePaymentComposer';
import TransferComposer from './TransferComposer';
import { NetworkFallbackChoice, WorkflowProgress } from './MultiSigUi';
import type { NetworkFallbackChoiceSource } from './MultiSigUi';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useStellarWallet } from './StellarWalletContext';
import { writeReviewHandoff } from './stellar/reviewHandoff';
import { isValidStellarAccountId } from '../../../packages/stellar-core/src/horizon';
import { resolveStellarNetwork } from './stellar/networkPreference';
import { inspectTransactionXdr } from '../../../packages/stellar-core/src/transactionXdr';
import type { StellarNetwork } from '../../../packages/stellar-core/src/types';
import { navigateWorkspace, stellarHref, stellarHrefWithSearch } from './workspaceNavigation';
import { parseTreasuryRoute } from './treasuryNavigation';

const ContractCallComposer = lazy(() => import('./ContractCallComposer'));

function ChoiceRow({ href, icon, title, description, network, badge }: { href: string; icon: ReactNode; title: string; description: string; network: StellarNetwork | null; badge?: string }) {
  const accentClass = network === 'testnet'
    ? 'text-sky-700 dark:text-sky-300'
    : 'text-emerald-700 dark:text-emerald-300';
  return (
    <div className="mst-choice-row">
      <div className={'mst-choice-row__icon ' + accentClass}>{icon}</div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mst-choice-row__title">{title}</h2>
          {badge && <span className="rounded-full bg-black/5 px-2.5 py-1 text-xs font-semibold text-neutral-500 dark:bg-white/10 dark:text-neutral-300">{badge}</span>}
        </div>
        <p className="mst-choice-row__copy">{description}</p>
      </div>
      <a href={href} className={'mst-choice-row__action ' + accentClass}>Continue <ArrowRight className="h-4 w-4" /></a>
    </div>
  );
}

function NewTransactionChoices() {
  const { sessionNetwork } = useStellarWallet();
  const route = parseTreasuryRoute(window.location.search);
  const proposalAccount = isValidStellarAccountId(route.accountId) ? route.accountId : '';
  const proposalNetwork = resolveStellarNetwork(route.network, sessionNetwork);
  const paymentHref = stellarHrefWithSearch('/new/payment', { fresh: '1', account: proposalAccount, network: proposalNetwork });
  const createAccountHref = stellarHrefWithSearch('/new/create-account', { fresh: '1', account: proposalAccount, network: proposalNetwork });
  const accentClass = proposalNetwork === 'testnet'
    ? 'text-sky-700 dark:text-sky-300'
    : 'text-emerald-700 dark:text-emerald-300';

  return (
    <main className="px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-5xl">
        <div className="border-b border-black/10 pb-5 dark:border-white/10">
          <h1 className="text-3xl font-bold tracking-tight">New proposal</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">Start with the action you want to take. Every proposal goes to Review before anyone signs or submits it.</p>
          {proposalAccount && <div className="mt-2 text-xs font-semibold text-neutral-500 dark:text-neutral-400">New proposal for <span className="font-mono">{proposalAccount}</span></div>}
        </div>

        <section className="mt-7" aria-labelledby="primary-action">
          <div id="primary-action" className="text-sm font-bold">Most common</div>
          <div className="mst-work-list mt-3">
            <div className="mst-work-row">
              <div>
                <div className={'mst-work-row__meta ' + accentClass}><Send className="h-4 w-4" />Payment</div>
                <h2 className="mst-work-row__title">Send payment</h2>
                <p className="mst-work-row__copy">Choose the source, recipient, asset, and amount. Review the exact Stellar transaction before collecting signatures.</p>
              </div>
              <a href={paymentHref} className="mst-action-primary">Start proposal <ArrowRight className="h-4 w-4" /></a>
            </div>

            <div className="mst-work-row">
              <div>
                <div className={'mst-work-row__meta ' + accentClass}><FileInput className="h-4 w-4" />Technical input</div>
                <h2 className="mst-work-row__title">Import transaction (XDR)</h2>
                <p className="mst-work-row__copy">Bring in an exact transaction produced by another wallet, CLI, app, or Agent.</p>
              </div>
              <a href={stellarHref('/new/import')} className={'mst-work-row__action ' + accentClass}>Import XDR <ArrowRight className="h-4 w-4" /></a>
            </div>
          </div>
        </section>

        <details className="mt-8 border-y border-black/10 py-4 dark:border-white/10">
          <summary className="cursor-pointer list-none text-sm font-bold">More Stellar actions</summary>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500 dark:text-neutral-400">These builders return to the same Review, Sign, Submit, and Done workflow.</p>
          <div className="mst-choice-list">
            <ChoiceRow href={createAccountHref} icon={<UserPlus className="h-5 w-5" />} title="Create Stellar account" description="Fund an inactive G-address with an explicit CreateAccount operation. You can switch to Payment without losing the entered address or amount." network={proposalNetwork} badge="CreateAccount" />
            <ChoiceRow href={stellarHref('/account/signing')} icon={<KeyRound className="h-5 w-5" />} title="Set up multisig" description="Configure signers and approval rules for any Stellar account. If you cannot authorize it here, export XDR for an authorized signer." network={proposalNetwork} badge="Account signing" />
            <ChoiceRow href={stellarHrefWithSearch('/new/claimable', { fresh: '1', account: proposalAccount, network: proposalNetwork })} icon={<Clock3 className="h-5 w-5" />} title="Claimable payment" description="Create a payment the recipient claims later, with an explicit recovery path." network={proposalNetwork} badge="Claim later" />
            <ChoiceRow href={stellarHrefWithSearch('/new/multi-party', { fresh: '1', network: proposalNetwork })} icon={<UsersRound className="h-5 w-5" />} title="Multi-source transaction" description="Coordinate operations from more than one authorization domain in one atomic transaction." network={proposalNetwork} badge="Multi-source" />
            <ChoiceRow href={stellarHrefWithSearch('/new/contract', { account: proposalAccount, network: proposalNetwork })} icon={<Braces className="h-5 w-5" />} title="Call a contract" description="Load a Soroban contract interface from the network, choose a method, and prepare typed arguments for Review." network={proposalNetwork} badge="Soroban" />
          </div>
        </details>

        <p className="mt-5 text-sm text-neutral-500 dark:text-neutral-400">Nothing is signed or submitted from this screen. The next step is always Review.</p>
      </div>
    </main>
  );
}

interface ImportComposerProps {
  network: StellarNetwork;
  onNetworkChange: (network: StellarNetwork) => void;
  initialFallbackSource: NetworkFallbackChoiceSource;
}

function ImportComposer({ network, onNetworkChange, initialFallbackSource }: ImportComposerProps) {
  const [xdr, setXdr] = useState('');
  const [xdrError, setXdrError] = useState('');
  const [fallbackSource, setFallbackSource] = useState<NetworkFallbackChoiceSource>(initialFallbackSource);
  const [resolving, setResolving] = useState(false);
  const testnet = network === 'testnet';

  function changeFallbackNetwork(value: StellarNetwork) {
    if (value === network) return;
    setXdrError('');
    setFallbackSource('human');
    onNetworkChange(value);
  }

  async function reviewImported(event: FormEvent) {
    event.preventDefault();
    const value = xdr.trim();
    if (!value || resolving) return;
    setResolving(true);
    setXdrError('');
    try {
      inspectTransactionXdr(value, network);
      writeReviewHandoff(sessionStorage, { xdr: value, network });
      navigateWorkspace('/signing-room', { state: { returnTo: stellarHref('/new'), returnLabel: 'New proposal' } });
    } catch {
      setXdrError('This is not a valid Stellar transaction XDR. Check that you pasted the complete transaction envelope.');
      setResolving(false);
    }
  }

  return (
    <main className="px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6"><WorkflowProgress current="review" /></div>
        <a href={stellarHref('/new')} className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-600 hover:text-black dark:text-neutral-300 dark:hover:text-white"><ArrowLeft className="h-4 w-4" />New proposal</a>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Import XDR</h1>
        <p className="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-300">Import an existing transaction from another Stellar app, wallet, CLI, or Agent.</p>

        <form onSubmit={reviewImported} className={`mst-import-form mt-6 ${testnet ? 'mst-testnet-page' : ''}`}>
          <NetworkFallbackChoice network={network} source={fallbackSource} onChange={changeFallbackNetwork} disabled={resolving} />
          <p className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">The selected deployment network is authoritative. Stellar transaction XDR does not encode a network passphrase, so MultiSigTools validates the XDR against this network instead of guessing across ledgers.</p>
          <div>
            <label htmlFor="import-xdr" className="text-sm font-semibold">Transaction XDR</label>
            <textarea id="import-xdr" value={xdr} onChange={(event) => { setXdr(event.target.value); setXdrError(''); }} aria-invalid={Boolean(xdrError)} aria-describedby={xdrError ? 'import-xdr-error' : undefined} placeholder="AAAAAgAAA..." rows={8} spellCheck={false} className={`mst-import-control mt-2 w-full resize-y font-mono text-xs leading-5 ${xdrError ? 'mst-import-control--error' : ''}`} />
            {xdrError && <p id="import-xdr-error" role="alert" className="mt-2 text-sm font-medium text-red-700 dark:text-red-300">{xdrError}</p>}
          </div>
          <div className="flex justify-end border-t border-black/10 pt-5 dark:border-white/10">
            <button type="submit" disabled={resolving || !xdr.trim()} className="mst-action-primary disabled:opacity-40">{resolving ? 'Validating XDR…' : 'Review transaction'} <ArrowRight className="h-4 w-4" /></button>
          </div>
        </form>
      </div>
    </main>
  );
}

export default function NewTransactionApp() {
  const { sessionNetwork, networkSource } = useStellarWallet();
  const pathname = window.location.pathname;
  const isPayment = pathname.endsWith('/new/payment');
  const isCreateAccount = pathname.endsWith('/new/create-account');
  const isBatch = pathname.endsWith('/new/batch');
  const isClaimable = pathname.endsWith('/new/claimable');
  const isMultiParty = pathname.endsWith('/new/multi-party');
  const isContract = pathname.endsWith('/new/contract');
  const isImport = pathname.endsWith('/new/import');
  const route = parseTreasuryRoute(window.location.search);
  const [network, setNetwork] = useState<StellarNetwork>(() => resolveStellarNetwork(route.network, sessionNetwork));
  const importFallbackSource: NetworkFallbackChoiceSource = route.network
    ? 'human'
    : sessionNetwork
      ? networkSource === 'wallet' ? 'wallet' : 'context'
      : 'default';
  const editor = isPayment || isCreateAccount || isBatch || isClaimable || isMultiParty || isContract || isImport;

  return (
    <StellarWorkspaceShell active="new" networkContext={editor ? network : null}>
      {isPayment || isCreateAccount || isBatch
        ? <PaymentComposer network={network} />
        : isClaimable
            ? <ClaimablePaymentComposer network={network} />
            : isMultiParty
              ? <TransferComposer network={network} mode="multi_party" />
              : isContract
                ? <Suspense fallback={<main className="px-4 py-12 text-center text-sm text-neutral-500">Loading contract composer…</main>}><ContractCallComposer network={network} /></Suspense>
                : isImport
                ? <ImportComposer network={network} onNetworkChange={setNetwork} initialFallbackSource={importFallbackSource} />
                : <NewTransactionChoices />}
    </StellarWorkspaceShell>
  );
}
