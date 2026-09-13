import { lazy, Suspense, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Braces, Clock3, FileInput, KeyRound, Send, UsersRound } from 'lucide-react';
import PaymentComposer from './PaymentComposer';
import ClaimablePaymentComposer from './ClaimablePaymentComposer';
import TransferComposer from './TransferComposer';
import { NetworkFallbackChoice, WorkflowProgress } from './MultiSigUi';
import type { NetworkFallbackChoiceSource } from './MultiSigUi';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useStellarWallet } from './StellarWalletContext';
import { writeReviewHandoff } from './stellar/reviewHandoff';
import { isValidStellarAccountId } from './stellar/horizon';
import { resolveStellarNetwork } from './stellar/networkPreference';
import { inspectTransactionXdr } from './stellar/transactionXdr';
import type { StellarNetwork } from './stellar/types';
import { navigateWorkspace, stellarHref, stellarHrefWithSearch } from './workspaceNavigation';
import { parseTreasuryRoute } from './treasuryNavigation';

const ContractCallComposer = lazy(() => import('./ContractCallComposer'));

function ChoiceCard({ href, icon, title, description, network, badge, sensitive = false }: { href: string; icon: ReactNode; title: string; description: string; network: StellarNetwork | null; badge?: string; sensitive?: boolean }) {
  const testnet = network === 'testnet';
  const border = sensitive
    ? 'border-red-500/25 hover:border-red-500/50 dark:border-red-400/25 dark:hover:border-red-400/50'
    : testnet
      ? 'border-black/10 hover:border-sky-500/35 dark:border-white/10 dark:hover:border-sky-400/35'
      : 'border-black/10 hover:border-emerald-500/35 dark:border-white/10 dark:hover:border-emerald-400/35';
  const iconClass = sensitive
    ? 'bg-red-500/10 text-red-700 dark:text-red-300'
    : testnet
      ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
      : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  const actionClass = sensitive
    ? 'text-red-700 dark:text-red-300'
    : testnet
      ? 'text-sky-700 dark:text-sky-300'
      : 'text-emerald-700 dark:text-emerald-300';
  return (
    <a href={href} className={`group rounded-2xl border bg-white p-4 transition hover:shadow-sm dark:bg-white/5 sm:p-5 ${border}`}>
      <div className="flex items-start justify-between gap-4">
        <div className={`rounded-xl p-2.5 ${iconClass}`}>{icon}</div>
        {badge && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${sensitive ? 'bg-red-500/10 text-red-700 dark:text-red-300' : 'bg-black/5 text-neutral-500 dark:bg-white/10 dark:text-neutral-300'}`}>{badge}</span>}
      </div>
      <h2 className="mt-4 text-lg font-bold">{title}</h2>
      <p className="mt-1.5 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{description}</p>
      <div className={`mt-4 flex items-center gap-1.5 text-sm font-semibold ${actionClass}`}>Continue <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" /></div>
    </a>
  );
}

function NewTransactionChoices() {
  const { sessionNetwork } = useStellarWallet();
  const route = parseTreasuryRoute(window.location.search);
  const proposalAccount = isValidStellarAccountId(route.accountId) ? route.accountId : '';
  const proposalNetwork = resolveStellarNetwork(route.network, sessionNetwork);
  const paymentHref = stellarHrefWithSearch('/new/payment', { fresh: '1', account: proposalAccount, network: proposalNetwork });

  return (
    <main className="px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-5xl">
        <div className="border-b border-black/10 pb-5 dark:border-white/10">
          <h1 className="text-3xl font-bold tracking-tight">New proposal</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">Start with the action you want to take. Every proposal goes to Review before anyone signs or submits it.</p>
          {proposalAccount && <div className="mt-2 text-xs font-semibold text-neutral-500 dark:text-neutral-400">New proposal for <span className="font-mono">{proposalAccount}</span></div>}
        </div>

        <a href={paymentHref} className="group mt-6 flex flex-col gap-5 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-5 transition hover:border-emerald-500/45 hover:bg-emerald-500/[0.09] dark:border-emerald-400/20 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex min-w-0 items-start gap-4">
            <div className="rounded-xl bg-emerald-600 p-3 text-white"><Send className="h-5 w-5" /></div>
            <div>
              <h2 className="text-xl font-bold">Send payment</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">Choose the source, recipient, asset, and amount. Review the exact Stellar transaction before collecting approvals.</p>
            </div>
          </div>
          <div className="inline-flex shrink-0 items-center gap-2 self-start rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white group-hover:bg-emerald-800 sm:self-auto">Start proposal <ArrowRight className="h-4 w-4" /></div>
        </a>

        <a href={stellarHref('/new/import')} className="group mt-3 flex items-center justify-between gap-4 rounded-2xl border border-black/10 bg-white p-4 transition hover:border-emerald-500/30 hover:shadow-sm dark:border-white/10 dark:bg-white/5 sm:p-5">
          <div className="flex min-w-0 items-start gap-4">
            <div className={`rounded-xl p-2.5 ${proposalNetwork === 'testnet' ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'}`}><FileInput className="h-5 w-5" /></div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h2 className="font-bold">Import transaction (XDR)</h2><span className="rounded-full bg-black/5 px-2.5 py-1 text-xs font-semibold text-neutral-500 dark:bg-white/10 dark:text-neutral-300">Technical</span></div>
              <p className="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-300">Bring in an exact transaction produced by another wallet, CLI, app, or Agent.</p>
            </div>
          </div>
          <span className={`hidden shrink-0 items-center gap-1.5 text-sm font-semibold sm:flex ${proposalNetwork === 'testnet' ? 'text-sky-700 dark:text-sky-300' : 'text-emerald-700 dark:text-emerald-300'}`}>Import XDR <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" /></span>
        </a>

        <details className="mt-6 rounded-2xl border border-black/10 bg-white/55 p-4 dark:border-white/10 dark:bg-white/[0.03] sm:p-5">
          <summary className="cursor-pointer list-none text-sm font-bold">More Stellar actions <span className="ml-1 text-xs font-medium text-neutral-400">Low-frequency workflows</span></summary>
          <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">Less common account and protocol actions. Transaction builders still return to the same Review, Sign, Submit, and Done flow.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <ChoiceCard href={stellarHref('/account/signing')} icon={<KeyRound className="h-5 w-5" />} title="Set up multisig" description="Configure signers and approval rules for any Stellar account. If you cannot authorize it here, export XDR for an authorized signer." network={proposalNetwork} badge="Account signing" />
            <ChoiceCard href={stellarHrefWithSearch('/new/claimable', { fresh: '1', account: proposalAccount, network: proposalNetwork })} icon={<Clock3 className="h-5 w-5" />} title="Claimable payment" description="Create a payment the recipient claims later, with an explicit recovery path." network={proposalNetwork} badge="Claim later" />
            <ChoiceCard href={stellarHrefWithSearch('/new/multi-party', { fresh: '1', network: proposalNetwork })} icon={<UsersRound className="h-5 w-5" />} title="Multi-source transaction" description="Coordinate operations from more than one authorization domain in one atomic transaction." network={proposalNetwork} badge="Multi-source" />
            <ChoiceCard href={stellarHrefWithSearch('/new/contract', { account: proposalAccount, network: proposalNetwork })} icon={<Braces className="h-5 w-5" />} title="Call a contract" description="Load a Soroban contract interface from the network, choose a method, and prepare typed arguments for Review." network={proposalNetwork} badge="Soroban" />
          </div>
        </details>

        <div className="mt-5 rounded-xl border border-black/10 bg-white/55 px-4 py-3 text-sm text-neutral-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-400">
          Nothing is signed or submitted from this screen. The next step is always Review.
        </div>
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
  const focusClass = testnet ? 'focus:border-sky-500' : 'focus:border-emerald-500';
  const primaryClass = testnet ? 'bg-sky-700 hover:bg-sky-800' : 'bg-emerald-700 hover:bg-emerald-800';

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

        <form onSubmit={reviewImported} className="mt-6 space-y-5 rounded-2xl border border-black/10 bg-white p-5 shadow-sm shadow-black/[0.02] dark:border-white/10 dark:bg-white/5 sm:p-6">
          <NetworkFallbackChoice network={network} source={fallbackSource} onChange={changeFallbackNetwork} disabled={resolving} />
          <p className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">The selected deployment network is authoritative. Stellar transaction XDR does not encode a network passphrase, so MultiSigTools validates the XDR against this network instead of guessing across ledgers.</p>
          <div>
            <label htmlFor="import-xdr" className="text-sm font-semibold">Transaction XDR</label>
            <textarea id="import-xdr" value={xdr} onChange={(event) => { setXdr(event.target.value); setXdrError(''); }} aria-invalid={Boolean(xdrError)} aria-describedby={xdrError ? 'import-xdr-error' : undefined} placeholder="AAAAAgAAA..." rows={8} spellCheck={false} className={`mt-2 w-full resize-y rounded-xl border bg-black/[0.015] p-4 font-mono text-xs leading-5 outline-none dark:bg-white/[0.025] ${xdrError ? 'border-red-500/60 dark:border-red-400/60' : 'border-black/10 dark:border-white/10'} ${focusClass}`} />
            {xdrError && <p id="import-xdr-error" role="alert" className="mt-2 text-sm font-medium text-red-700 dark:text-red-300">{xdrError}</p>}
          </div>
          <div className="flex justify-end border-t border-black/10 pt-5 dark:border-white/10">
            <button type="submit" disabled={resolving || !xdr.trim()} className={`flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white disabled:opacity-40 ${primaryClass}`}>{resolving ? 'Validating XDR…' : 'Review transaction'} <ArrowRight className="h-4 w-4" /></button>
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
  const editor = isPayment || isBatch || isClaimable || isMultiParty || isContract || isImport;

  return (
    <StellarWorkspaceShell active="new" networkContext={editor ? network : null}>
      {isPayment || isBatch
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
