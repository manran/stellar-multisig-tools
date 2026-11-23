/* Hallmark · pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { ArrowRight, LoaderCircle, Plus, RefreshCw, ShieldCheck, WalletCards } from 'lucide-react';
import { ActionButton, PageHeader } from './MultiSigUi';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import TemplateGrantControls from './TemplateGrantControls';
import { useStellarWallet } from './StellarWalletContext';
import useSavedTemplates from './useSavedTemplates';
import { resolveStellarNetwork } from './stellar/networkPreference';
import { stellarHref, stellarHrefWithSearch } from './workspaceNavigation';

export default function TemplatesApp() {
  const { address, sessionNetwork } = useStellarWallet();
  const network = resolveStellarNetwork(null, sessionNetwork);
  const {
    sessionAddress, templateScope, currentTemplates, templateLoading,
    templateUnlockError, busy, authBusy, showTemplates, retryTemplates,
  } = useSavedTemplates(network);

  return (
    <StellarWorkspaceShell active="templates" networkContext={network}>
      <main className="mst-workbench-page">
        <div className="mx-auto max-w-5xl">
          <PageHeader
            title="Templates"
            description="Reuse saved payment setups and manage who can request payments."
            actions={<a href={stellarHref('/new')} className="mst-action-secondary"><Plus className="h-4 w-4" />New proposal</a>}
          />

          {!templateScope && (
            <section className="mx-auto max-w-xl py-14 sm:py-20">
              <WalletCards className="h-8 w-8 text-[var(--color-action)]" />
              <h2 className="mt-5 text-3xl font-semibold">Open saved templates</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--color-ink-2)]">Connect and confirm your wallet to see its templates and permissions.</p>
              <ActionButton className="mt-5" disabled={busy || authBusy} onClick={() => void showTemplates()}>
                {busy || authBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : address ? <ShieldCheck className="h-4 w-4" /> : <WalletCards className="h-4 w-4" />}
                {busy || authBusy ? 'Confirming wallet…' : address ? 'Confirm wallet' : 'Connect wallet'}
              </ActionButton>
              {templateUnlockError && <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">{templateUnlockError}</p>}
            </section>
          )}

          {templateLoading && <p role="status" className="mt-6 flex items-center gap-2 text-sm text-[var(--color-muted)]"><LoaderCircle className="h-4 w-4 animate-spin" />Loading templates…</p>}

          {currentTemplates?.status === 'error' && (
            <section className="mt-6 border-y border-[var(--color-rule)] py-5">
              <p role="alert" className="text-sm text-[var(--color-ink-2)]">Could not load templates.</p>
              <ActionButton variant="secondary" className="mt-3" onClick={retryTemplates}><RefreshCw className="h-4 w-4" />Retry templates</ActionButton>
            </section>
          )}
          {currentTemplates?.status === 'unlock_required' && (
            <section className="mt-6 border-y border-[var(--color-rule)] py-5">
              <p role="alert" className="text-sm text-[var(--color-ink-2)]">Confirm your wallet again to load templates.</p>
              <ActionButton variant="secondary" className="mt-3" disabled={busy || authBusy} onClick={() => void showTemplates()}>
                <ShieldCheck className="h-4 w-4" />Confirm wallet
              </ActionButton>
              {templateUnlockError && <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">{templateUnlockError}</p>}
            </section>
          )}
          {currentTemplates?.status === 'ready' && currentTemplates.items.length === 0 && (
            <section className="mt-6 border-y border-[var(--color-rule)] py-8">
              <h2 className="text-lg font-semibold">No saved templates yet</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--color-ink-2)]">Start a payment and save it as a template to reuse its setup.</p>
              <a href={stellarHref('/new/payment')} className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--color-action)]">Create payment <ArrowRight className="h-4 w-4" /></a>
            </section>
          )}

          {currentTemplates?.status === 'ready' && currentTemplates.items.length > 0 && (
            <section className="mt-6" aria-label="Saved templates">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-lg font-semibold">Saved templates</h2>
                <span className="text-sm text-[var(--color-muted)]">{currentTemplates.items.length} template{currentTemplates.items.length === 1 ? '' : 's'}</span>
              </div>
              <div className="mst-work-list mt-3">
                {currentTemplates.items.map((template) => {
                  const owned = template.ownerAddress === sessionAddress;
                  const delegated = Boolean(template.ownerAddress && !owned);
                  const href = stellarHrefWithSearch(delegated ? '/new/proposer' : '/new/payment', {
                    fresh: '1', template: template.id, network,
                  });
                  return (
                    <article key={template.id} className="mst-work-row items-start">
                      <div className="min-w-0">
                        <p className="mst-work-row__meta">{template.kind === 'batch_payment' ? 'Batch payment' : 'Payment'} · {owned ? 'Owned by this wallet' : delegated ? 'Shared with this wallet' : 'Saved template'}</p>
                        <h3 className="mst-work-row__title">{template.name}</h3>
                        <p className="mst-work-row__copy">{template.definition.recipients.length} recipient{template.definition.recipients.length === 1 ? '' : 's'} · Source <span className="font-mono" title={template.definition.source}>{template.definition.source.slice(0, 8)}…{template.definition.source.slice(-8)}</span></p>
                        {delegated && <p className="mt-2 text-sm text-[var(--color-ink-2)]">You can request a payment. Treasury signers approve it.</p>}
                        {owned && <TemplateGrantControls template={template} sessionAddress={sessionAddress} network={network} />}
                      </div>
                      <a href={href} className="mst-work-row__action">{delegated ? 'Request payment' : 'Use template'} <ArrowRight className="h-4 w-4" /></a>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </main>
    </StellarWorkspaceShell>
  );
}
