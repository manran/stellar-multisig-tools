import { useEffect, useState } from 'react';
import { ArrowRight, Braces, CircleAlert, LoaderCircle, Plus } from 'lucide-react';
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

  useEffect(() => {
    setLegacy(!loading && privateReady && network ? legacyContractsToImport(network, contracts) : []);
  }, [loading, privateReady, network, identity?.userId, contracts]);

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
                <a href={stellarHrefWithSearch('/new/contract', { network: network ?? 'public' })} className="mst-action-primary"><Plus className="h-4 w-4" />{WORKSPACE_COPY.contracts.add}</a>
              </div>

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
                        <span className="mst-contract-row__type"><Braces className="h-3.5 w-3.5" />{WORKSPACE_COPY.contracts.type}</span>
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