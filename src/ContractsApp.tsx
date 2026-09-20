import { ArrowRight, Braces, CircleAlert, LoaderCircle, Plus } from 'lucide-react';
import { NetworkBadge, PageHeader } from './MultiSigUi';
import PrivateWorkspaceUnlock from './PrivateWorkspaceUnlock';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useContractWorkspaces } from './ContractWorkspaceContext';
import { useStellarWallet } from './StellarWalletContext';
import { stellarHrefWithSearch } from './workspaceNavigation';

function shortContract(value: string) {
  return value.length <= 30 ? value : `${value.slice(0, 15)}…${value.slice(-11)}`;
}

export default function ContractsApp() {
  const {
    address,
    network,
    busy,
    connect,
    privateUnlocked,
    unlockedAddress,
    unlockedNetwork,
  } = useStellarWallet();
  const { contracts, loading, error, refresh } = useContractWorkspaces();
  const privateReady = Boolean(
    privateUnlocked
    && address
    && network
    && unlockedAddress === address
    && unlockedNetwork === network,
  );

  return (
    <StellarWorkspaceShell active="contracts" networkContext={network}>
      <main className="px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-5xl">
          <PageHeader
            eyebrow="Contract workspace"
            title="Contracts"
            description="Contracts kept by this signer workspace. Keeping a contract remembers work context; it never grants contract authority."
          />

          {!address && (
            <section className="mx-auto max-w-xl py-14 sm:py-20">
              <Braces className="mst-contract-accent h-8 w-8" />
              <h2 className="mt-5 text-3xl font-bold">Connect the signer workspace</h2>
              <p className="mt-2 text-base leading-7 text-neutral-600 dark:text-neutral-300">Saved contracts stay private to the connected signer workspace.</p>
              <button type="button" disabled={busy} onClick={() => void connect()} className="mst-action-primary mt-6 disabled:opacity-50">{busy ? 'Opening wallets…' : 'Connect wallet'}</button>
            </section>
          )}

          {address && !privateReady && (
            <PrivateWorkspaceUnlock
              title="Open saved contracts"
              description="Confirm this wallet to load its private contract workspace. This does not authorize a contract call."
              buttonLabel="Open Contracts"
            />
          )}

          {privateReady && (
            <div className="mt-6 space-y-4">
              <div className="mst-contract-toolbar">
                <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
                  {network && <NetworkBadge network={network} />}
                  <span>{contracts.length} saved {contracts.length === 1 ? 'contract' : 'contracts'}</span>
                </div>
                <a href={stellarHrefWithSearch('/new/contract', { network: network ?? 'public' })} className="mst-action-primary"><Plus className="h-4 w-4" />Add or call contract</a>
              </div>

              {error && (
                <div className="flex items-start justify-between gap-4 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
                  <span className="flex gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</span>
                  <button type="button" onClick={() => void refresh()} className="shrink-0 font-semibold underline">Retry</button>
                </div>
              )}
              {loading && <div className="flex items-center gap-2 py-8 text-sm text-neutral-500"><LoaderCircle className="h-4 w-4 animate-spin" />Loading contracts…</div>}

              {!loading && !error && contracts.length === 0 && (
                <section className="mst-contract-empty">
                  <h2 className="text-xl font-bold">No saved contracts yet</h2>
                  <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">Load any C-address, inspect its callable methods, then save it here for later.</p>
                </section>
              )}

              {!loading && contracts.length > 0 && (
                <div className="mst-contract-list">
                  {contracts.map((contract) => (
                    <a key={contract.contractId} href={stellarHrefWithSearch('/contract', { contract: contract.contractId, network: contract.network })} className="mst-contract-row">
                      <span className="mst-contract-row__icon"><Braces className="h-5 w-5" /></span>
                      <span className="min-w-0">
                        <span className="block font-mono text-sm font-semibold" title={contract.contractId}>{shortContract(contract.contractId)}</span>
                        <span className="mt-1 block text-xs text-neutral-500 dark:text-neutral-400">Saved contract</span>
                      </span>
                      <NetworkBadge network={contract.network} />
                      <span className="mst-contract-row__action">Open contract <ArrowRight className="h-4 w-4" /></span>
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
