import { useEffect, useState } from 'react';
import { ArrowRight, Braces, CircleAlert, LoaderCircle, Plus } from 'lucide-react';
import { isValidContractId } from '../../../packages/stellar-core/src/contractSpec';
import { inspectContractOperation } from './contractOperationsClient';
import type { ContractMethodDescriptor } from '../../../packages/stellar-core/src/contractSpec';
import { legacyContractsToImport, removeContractWorkspace } from './contractWorkspace';
import type { ContractWorkspaceRef as LegacyContractRef } from './contractWorkspace';
import { PageHeader } from './MultiSigUi';
import { WORKSPACE_COPY } from './workspaceCopy';
import { useUserIdentity } from './UserIdentityContext';
import ToolAccessEntry from './ToolAccessEntry';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useContractWorkspaces } from './ContractWorkspaceContext';
import { useStellarWallet } from './StellarWalletContext';
import { stellarHrefWithSearch } from './workspaceNavigation';

function shortContract(value: string) {
  return value.length <= 30 ? value : `${value.slice(0, 15)}…${value.slice(-11)}`;
}

export default function ContractsApp() {
  const { network: walletNetwork } = useStellarWallet();
  const { identity } = useUserIdentity();
  const network = identity?.network ?? walletNetwork;
  const { contracts, loading, error, ready: privateReady, refresh, keep } = useContractWorkspaces();
  const [legacy, setLegacy] = useState<LegacyContractRef[]>([]);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [adding, setAdding] = useState(false);
  const [newContractId, setNewContractId] = useState('');
  const [nickname, setNickname] = useState('');
  const [organization, setOrganization] = useState('');
  const [review, setReview] = useState<{ contractId: string; methods: ContractMethodDescriptor[] } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState('');

  useEffect(() => {
    setLegacy(!loading && privateReady && network ? legacyContractsToImport(network, contracts) : []);
  }, [loading, privateReady, network, identity?.userId, contracts]);

  async function reviewContract() {
    const contractId = newContractId.trim();
    if (!network || !isValidContractId(contractId) || reviewing) return;
    setReviewing(true);
    setAddError('');
    setReview(null);
    try {
      const loaded = await inspectContractOperation(contractId, network);
      setReview({ contractId, methods: loaded.methods });
    } catch (cause) {
      setAddError(cause instanceof Error ? cause.message : 'Unable to find this contract.');
    } finally {
      setReviewing(false);
    }
  }

  async function saveReviewedContract() {
    if (!review || saving) return;
    setSaving(true);
    setAddError('');
    try {
      await keep(review.contractId, { nickname, organization });
      setAdding(false);
      setReview(null);
      setNewContractId('');
      setNickname('');
      setOrganization('');
    } catch (cause) {
      setAddError(cause instanceof Error ? cause.message : 'Unable to save this contract.');
    } finally {
      setSaving(false);
    }
  }

  async function importLegacy() {
    if (!network || importing) return;
    setImporting(true);
    setImportError('');
    try {
      for (const entry of legacy) {
        await keep(entry.contractId);
        removeContractWorkspace(entry.contractId, network);
      }
      setLegacy([]);
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : 'Unable to import contracts.');
      setLegacy(legacyContractsToImport(network, contracts));
    } finally {
      setImporting(false);
    }
  }

  return (
    <StellarWorkspaceShell active="contracts" networkContext={network}>
      <main className="px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-5xl">
          <PageHeader
            title={WORKSPACE_COPY.tools.contracts}
            description={WORKSPACE_COPY.contracts.description}
          />

          {!identity && <ToolAccessEntry returnTo="/contracts" />}

          {privateReady && (
            <div className="mt-6 space-y-4">
              {!loading && legacy.length > 0 && <section className="border-l-2 border-[var(--color-accent)] bg-[var(--color-paper-2)] px-4 py-4" aria-label="Import saved contracts">
                <h2 className="font-semibold">{WORKSPACE_COPY.contracts.importTitle}</h2>
                <p className="mt-1 text-sm text-[var(--color-ink-2)]">{WORKSPACE_COPY.contracts.importCount(legacy.length)}</p>
                <button type="button" disabled={importing} onClick={() => void importLegacy()} className="mst-action-secondary mt-3 disabled:opacity-50">
                  {importing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {importing ? WORKSPACE_COPY.contracts.importing : WORKSPACE_COPY.contracts.importAction}
                </button>
                {importError && <p role="alert" className="mt-2 text-sm text-[var(--color-danger)]">{importError}</p>}
              </section>}
              <div className="mst-contract-toolbar">
                <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
                  <span>{WORKSPACE_COPY.contracts.count(contracts.length)}</span>
                </div>
                <button type="button" className="mst-action-primary" onClick={() => { setAdding((value) => !value); setAddError(''); setReview(null); }} aria-expanded={adding}><Plus className="h-4 w-4" />{WORKSPACE_COPY.contracts.add}</button>
              </div>

              {adding && <section className="border-t border-[var(--color-rule)] pt-5" aria-label="Add a contract">
                <h2 className="text-lg font-semibold">{WORKSPACE_COPY.contracts.add}</h2>
                <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-2)]">{WORKSPACE_COPY.contracts.addDescription}</p>
                <label htmlFor="new-contract-address" className="mt-5 block text-sm font-semibold">Contract address</label>
                <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                  <input id="new-contract-address" className="mst-contract-control min-w-0 flex-1 font-mono" placeholder="C..." value={newContractId} spellCheck={false} onChange={(event) => { setNewContractId(event.target.value.trim()); setReview(null); setAddError(''); }} />
                  <button type="button" className="mst-action-secondary shrink-0 disabled:opacity-50" disabled={!network || !isValidContractId(newContractId) || reviewing || saving} onClick={() => void reviewContract()}>{reviewing && <LoaderCircle className="h-4 w-4 animate-spin" />}{reviewing ? 'Checking…' : WORKSPACE_COPY.contracts.review}</button>
                </div>
                {newContractId && !isValidContractId(newContractId) && <p className="mt-2 text-sm text-[var(--color-ink-2)]">Use a valid C... address.</p>}
                {review && <div className="mt-6 border-t border-[var(--color-rule)] pt-5">
                  <h3 className="font-semibold">{WORKSPACE_COPY.contracts.reviewTitle}</h3>
                  <p className="mt-2 break-all font-mono text-xs text-[var(--color-ink-2)]">{review.contractId}</p>
                  <p className="mt-3 text-sm text-[var(--color-ink-2)]">{network === 'testnet' ? 'Testnet' : 'Mainnet'} · {review.methods.length} available {review.methods.length === 1 ? 'action' : 'actions'}</p>
                  {review.methods.length > 0 && <div className="mt-3 flex flex-wrap gap-2" aria-label={WORKSPACE_COPY.contracts.methodsPreview}>{review.methods.slice(0, 5).map((method) => <span key={method.name} className="rounded-md border border-[var(--color-rule)] px-2 py-1 font-mono text-xs">{method.name}</span>)}{review.methods.length > 5 && <span className="text-xs text-[var(--color-ink-2)]">+{review.methods.length - 5}</span>}</div>}
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <div><label htmlFor="contract-nickname" className="text-sm font-semibold">{WORKSPACE_COPY.contracts.nickname}</label><input id="contract-nickname" maxLength={80} value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="e.g. Payroll" className="mst-contract-control mt-2 w-full" /></div>
                    <div><label htmlFor="contract-organization" className="text-sm font-semibold">{WORKSPACE_COPY.contracts.organization}</label><input id="contract-organization" maxLength={80} value={organization} onChange={(event) => setOrganization(event.target.value)} placeholder="e.g. Acme Finance" className="mst-contract-control mt-2 w-full" /></div>
                  </div>
                  <p className="mt-2 text-xs text-[var(--color-ink-2)]">{WORKSPACE_COPY.contracts.organizationHint}</p>
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <button type="button" className="mst-action-primary disabled:opacity-50" disabled={saving} onClick={() => void saveReviewedContract()}>{saving && <LoaderCircle className="h-4 w-4 animate-spin" />}{saving ? 'Saving…' : WORKSPACE_COPY.contracts.saveAndReturn}</button>
                    <a href={stellarHrefWithSearch('/contract', { contract: review.contractId, network: network ?? 'testnet' })} className="text-sm font-semibold text-[var(--color-ink-2)] underline underline-offset-4">{WORKSPACE_COPY.contracts.showMethods}</a>
                  </div>
                </div>}
                {addError && <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">{addError}</p>}
              </section>}

              {error && (
                <div className="flex items-start justify-between gap-4 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
                  <span className="flex gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</span>
                  <button type="button" onClick={() => void refresh()} className="shrink-0 font-semibold underline">Retry</button>
                </div>
              )}
              {loading && <div className="flex items-center gap-2 py-8 text-sm text-neutral-500"><LoaderCircle className="h-4 w-4 animate-spin" />{WORKSPACE_COPY.contracts.loading}</div>}

              {!loading && !error && contracts.length === 0 && (
                <section className="mst-contract-empty">
                  <h2 className="text-xl font-bold">{WORKSPACE_COPY.contracts.emptyTitle}</h2>
                  <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{WORKSPACE_COPY.contracts.emptyDescription}</p>
                </section>
              )}

              {!loading && contracts.length > 0 && (
                <div className="mst-contract-list">
                  <div className="mst-contract-list__head"><span>{WORKSPACE_COPY.contracts.address}</span></div>
                  {contracts.map((contract) => (
                    <a key={contract.contractId} href={stellarHrefWithSearch('/contract', { contract: contract.contractId, network: contract.network })} className="mst-contract-row">
                      <span className="min-w-0">
                        <span className="mst-contract-row__type"><Braces className="h-3.5 w-3.5" />{contract.organization || WORKSPACE_COPY.contracts.type}</span>
                        {contract.nickname && <span className="block text-sm font-semibold">{contract.nickname}</span>}
                        <span className="mst-contract-row__address" title={contract.contractId}>{shortContract(contract.contractId)}</span>
                      </span>
                      <span className="mst-contract-row__action">{WORKSPACE_COPY.contracts.inspect} <ArrowRight className="h-4 w-4" /></span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </StellarWorkspaceShell>
  );
}