import { lazy, Suspense, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Braces, Clock3, FileInput, KeyRound, LoaderCircle, RefreshCw, Send, ShieldCheck, UserPlus, UsersRound } from 'lucide-react';
import PaymentComposer from './PaymentComposer';
import TemplateProposerComposer from './TemplateProposerComposer';
import ClaimablePaymentComposer from './ClaimablePaymentComposer';
import TransferComposer from './TransferComposer';
import { ActionButton, NetworkFallbackChoice, WorkflowProgress } from './MultiSigUi';
import type { NetworkFallbackChoiceSource } from './MultiSigUi';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useStellarWallet } from './StellarWalletContext';
import { writeReviewHandoff } from './stellar/reviewHandoff';
import { isValidStellarAccountId } from '../../../packages/stellar-core/src/horizon';
import { resolveStellarNetwork } from './stellar/networkPreference';
import { inspectTransactionXdr } from '../../../packages/stellar-core/src/transactionXdr';
import type { StellarNetwork } from '../../../packages/stellar-core/src/types';
import type { ReusableTemplateSummary } from '../../../packages/stellar-core/src/reusableTemplate';
import { privateSessionAddressHeaders } from '../../../packages/stellar-core/src/privateSessionTransport';
import { navigateWorkspace, stellarHref, stellarHrefWithSearch } from './workspaceNavigation';
import { parseTreasuryRoute } from './treasuryNavigation';
import { isWalletUserRejected } from './stellar/walletKit';

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

function TemplateGrantControls({ template, sessionAddress, network }: { template: ReusableTemplateSummary; sessionAddress: string; network: StellarNetwork }) {
  const [address, setAddress] = useState('');
  const [proposers, setProposers] = useState(template.proposerAddresses ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!sessionAddress || template.ownerAddress !== sessionAddress || template.kind !== 'payment') return null;

  async function update(action: 'grant' | 'revoke', proposerAddress: string) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/templates', {
        method: 'PATCH',
        headers: { ...privateSessionAddressHeaders(sessionAddress), 'Content-Type': 'application/json' },
        body: JSON.stringify({ network, templateId: template.id, proposerAddress, action }),
      });
      const body = await response.json() as { proposerAddresses?: string[]; error?: string };
      if (!response.ok || !Array.isArray(body.proposerAddresses)) throw new Error(body.error || 'Unable to update Template permission.');
      setProposers(body.proposerAddresses);
      if (action === 'grant') setAddress('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update Template permission.');
    } finally { setBusy(false); }
  }
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer font-semibold text-[var(--color-accent)]">Allow another wallet to request payments</summary>
      <p className="mt-2 leading-6 text-[var(--color-ink-2)]">This wallet can prepare payments from the Template. Treasury signers still approve each transaction.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input aria-label="Proposer G address" value={address} onChange={(event) => setAddress(event.target.value.trim())}
          placeholder="G... wallet address" className="mst-request-control min-w-0 flex-1 font-mono text-xs" />
        <ActionButton type="button" variant="secondary" disabled={!isValidStellarAccountId(address) || address === sessionAddress || busy}
          onClick={() => void update('grant', address)}>Allow</ActionButton>
      </div>
      {proposers.length > 0 && <ul className="mt-3 space-y-2">
        {proposers.map((proposer) => <li key={proposer} className="flex min-w-0 items-center gap-3 rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-2)] px-3 py-1.5 text-xs">
          <span className="min-w-0 flex-1 truncate font-mono" title={proposer}>
            {`${proposer.slice(0, 10)}…${proposer.slice(-8)}`}
          </span>
          <button type="button" onClick={() => void navigator.clipboard.writeText(proposer).catch(() => setError('Could not copy this address.'))}
            className="min-h-11 shrink-0 font-semibold text-[var(--color-action)]">Copy</button>
          <button type="button" disabled={busy} onClick={() => void update('revoke', proposer)}
            className="min-h-11 shrink-0 font-semibold text-[var(--color-danger)] disabled:opacity-40">Revoke</button>
        </li>)}
      </ul>}
      {error && <p role="alert" className="mt-2 text-xs text-[var(--color-danger)]">{error}</p>}
    </details>
  );
}

function NewTransactionChoices() {
  const { sessionNetwork, sessionAddress, privateUnlocked, busy, authBusy, unlock } = useStellarWallet();
  const [templateLoad, setTemplateLoad] = useState<{
    scope: string;
    status: 'loading' | 'ready' | 'error' | 'unlock_required';
    items: ReusableTemplateSummary[];
  } | null>(null);
  const [templateRetry, setTemplateRetry] = useState(0);
  const [templateUnlockError, setTemplateUnlockError] = useState('');
  const route = parseTreasuryRoute(window.location.search);
  const proposalAccount = isValidStellarAccountId(route.accountId) ? route.accountId : '';
  const proposalNetwork = resolveStellarNetwork(route.network, sessionNetwork);
  const paymentHref = stellarHrefWithSearch('/new/payment', { fresh: '1', account: proposalAccount, network: proposalNetwork });
  const createAccountHref = stellarHrefWithSearch('/new/create-account', { fresh: '1', account: proposalAccount, network: proposalNetwork });
  const templateScope = privateUnlocked && sessionAddress ? `${sessionAddress}:${proposalNetwork}` : '';
  // A previous wallet's response must not appear while the new scope is loading.
  const currentTemplates = templateScope && templateLoad?.scope === templateScope ? templateLoad : null;
  const templateLoading = Boolean(templateScope && (!currentTemplates || currentTemplates.status === 'loading'));
  const networkLabel = proposalNetwork === 'testnet' ? 'Testnet' : 'Mainnet';
  const accentClass = proposalNetwork === 'testnet'
    ? 'text-sky-700 dark:text-sky-300'
    : 'text-emerald-700 dark:text-emerald-300';

  useEffect(() => {
    setTemplateUnlockError('');
    if (!templateScope) {
      setTemplateLoad(null);
      return;
    }
    const controller = new AbortController();
    setTemplateLoad({ scope: templateScope, status: 'loading', items: [] });
    void fetch(`/api/templates?network=${proposalNetwork}`, {
      headers: privateSessionAddressHeaders(sessionAddress),
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          if (!controller.signal.aborted) setTemplateLoad({ scope: templateScope, status: 'unlock_required', items: [] });
          return;
        }
        const body = await response.json() as { address?: string; templates?: ReusableTemplateSummary[] };
        if (!response.ok || !Array.isArray(body.templates)) throw new Error('Unable to load templates.');
        if (controller.signal.aborted) return;
        if (body.address !== sessionAddress || body.templates.some((item) => item.network !== proposalNetwork)) {
          setTemplateLoad({ scope: templateScope, status: 'unlock_required', items: [] });
          return;
        }
        setTemplateLoad({ scope: templateScope, status: 'ready', items: body.templates });
      })
      .catch(() => {
        if (!controller.signal.aborted) setTemplateLoad({ scope: templateScope, status: 'error', items: [] });
      });
    return () => controller.abort();
  }, [templateScope, sessionAddress, proposalNetwork, templateRetry]);

  async function showTemplates() {
    setTemplateUnlockError('');
    try {
      await unlock(undefined, proposalNetwork);
      setTemplateRetry((value) => value + 1);
    } catch (cause) {
      if (!isWalletUserRejected(cause)) {
        setTemplateUnlockError(cause instanceof Error ? cause.message : 'Unable to confirm this wallet. Try again.');
      }
    }
  }

  return (
    <main className="mst-workbench-page">
      <div className="mx-auto max-w-6xl">
        <header className="mst-page-intro">
          <h1>New proposal</h1>
          <p>What would you like to authorize?</p>
          {proposalAccount && <div className="mt-3 text-xs text-[var(--color-muted)]">From <span className="font-mono" title={proposalAccount}>{proposalAccount.slice(0, 8)}…{proposalAccount.slice(-8)}</span></div>}
        </header>

        <div className="mst-compose-layout">
          <section className="mst-compose-primary" aria-labelledby="primary-action">
            <div className="mst-compose-hero">
              <div>
                <span className="mst-compose-hero__symbol"><Send className="h-5 w-5" /></span>
                <h2 id="primary-action" className="mst-compose-hero__title">Send a payment</h2>
                <p className="mst-compose-hero__copy">Set the recipient, asset, and amount. Others can review and sign before the payment is submitted.</p>
              </div>
              <a href={paymentHref} className="mst-action-primary mst-compose-hero__cta">Create payment <ArrowRight className="h-4 w-4" /></a>
            </div>
            <a href={stellarHref('/new/import')} className="mst-compose-import">
              <FileInput className="h-5 w-5 shrink-0" />
              <span className="min-w-0 flex-1">
                <strong>Import a prepared transaction</strong>
                <span className="mst-compose-import__copy">Use XDR from a wallet, CLI, application, or agent.</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0" />
            </a>
          </section>

          <section className="mst-compose-templates" aria-labelledby="saved-templates" aria-busy={templateLoading}>
          <div className="mst-compose-templates__header">
            <h2 id="saved-templates">Your templates</h2>
            <p>Start with a saved payment setup. Each new proposal is reviewed before signing.</p>
          </div>

          {!templateScope && (
            <div className="mt-3 border-y border-[var(--color-rule)] py-4">
              <p className="max-w-prose text-sm leading-6 text-[var(--color-ink-2)]">Confirm your wallet to see its saved templates. The wallet verification opens your private workspace.</p>
              <ActionButton variant="secondary" className="mt-3" disabled={busy || authBusy} onClick={() => void showTemplates()}>
                {busy || authBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {busy || authBusy ? 'Confirm in wallet…' : 'Show my templates'}
              </ActionButton>
            </div>
          )}

          {templateLoading && <p role="status" className="mt-4 flex items-center gap-2 text-sm text-[var(--color-muted)]"><LoaderCircle className="h-4 w-4 animate-spin" />Loading templates…</p>}

          {currentTemplates?.status === 'error' && (
            <div className="mt-3 border-y border-[var(--color-rule)] py-4">
              <p role="alert" className="text-sm text-[var(--color-ink-2)]">Could not load your templates. Try again, or start a payment above.</p>
              <ActionButton variant="secondary" className="mt-3" onClick={() => setTemplateRetry((value) => value + 1)}><RefreshCw className="h-4 w-4" />Retry templates</ActionButton>
            </div>
          )}

          {currentTemplates?.status === 'unlock_required' && (
            <div className="mt-3 border-y border-[var(--color-rule)] py-4">
              <p role="alert" className="text-sm text-[var(--color-ink-2)]">Confirm your wallet again to load its templates.</p>
              <ActionButton variant="secondary" className="mt-3" disabled={busy || authBusy} onClick={() => void showTemplates()}><ShieldCheck className="h-4 w-4" />{busy || authBusy ? 'Confirm in wallet…' : 'Confirm wallet'}</ActionButton>
            </div>
          )}

          {templateUnlockError && <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">{templateUnlockError}</p>}

          {currentTemplates?.status === 'ready' && currentTemplates.items.length === 0 && (
            <div className="mt-3 border-y border-[var(--color-rule)] py-4 text-sm leading-6 text-[var(--color-ink-2)]">
              <p>No saved templates on {networkLabel} yet.</p>
              <p className="mt-1 text-[var(--color-muted)]">Start a payment, then choose Save as template to reuse its source account, recipients, assets, and signing window.</p>
            </div>
          )}

          {currentTemplates?.status === 'ready' && currentTemplates.items.length > 0 && (
            <div className="mst-work-list mst-compose-template-list">
              {currentTemplates.items.map((template) => (
                <div key={template.id} className="mst-work-row">
                  <div className="min-w-0">
                    <div className={'mst-work-row__meta ' + accentClass}>{template.kind === 'batch_payment' ? 'Batch payment' : 'Payment'}</div>
                    <h3 className="mst-work-row__title">{template.name}</h3>
                    <p className="mst-work-row__copy">{template.definition.recipients.length} recipient{template.definition.recipients.length === 1 ? '' : 's'} · Source <span className="font-mono" title={template.definition.source}>{template.definition.source.slice(0, 8)}…{template.definition.source.slice(-8)}</span></p>
                    {template.definition.autoRemind && <p className="mt-1 text-xs font-medium text-[var(--color-ink-2)]">Automatic email reminders enabled</p>}
                    {template.ownerAddress && template.ownerAddress !== sessionAddress && <p className="mt-1 text-xs font-semibold text-[var(--color-accent)]">You are authorized to initiate payments from this Template.</p>}
                    <TemplateGrantControls template={template} sessionAddress={sessionAddress} network={proposalNetwork} />
                    {proposalAccount && template.definition.source !== proposalAccount && <p className="mt-1 text-xs leading-5 text-[var(--color-muted)]">This template uses a different source account.</p>}
                  </div>
                  <a
                    href={stellarHrefWithSearch(template.ownerAddress && template.ownerAddress !== sessionAddress ? '/new/proposer' : '/new/payment', {
                      fresh: '1',
                      template: template.id,
                      network: proposalNetwork,
                    })}
                    className="mst-work-row__action"
                  >
                    {template.ownerAddress && template.ownerAddress !== sessionAddress ? 'Request payment' : 'Use template'} <ArrowRight className="h-4 w-4" />
                  </a>
                </div>
              ))}
            </div>
          )}
          </section>
        </div>

        <details className="mst-compose-advanced">
          <summary className="cursor-pointer list-none text-sm font-semibold">More transaction types</summary>
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
  const isProposer = pathname.endsWith('/new/proposer');
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
  const editor = isPayment || isProposer || isCreateAccount || isBatch || isClaimable || isMultiParty || isContract || isImport;

  return (
    <StellarWorkspaceShell active="new" networkContext={editor ? network : null}>
      {isProposer
        ? <TemplateProposerComposer network={network} />
        : isPayment || isCreateAccount || isBatch
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
