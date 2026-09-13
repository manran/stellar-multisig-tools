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
              <Braces className="h-8 w-8 text-violet-500" />
              <h2 className="mt-5 text-3xl font-bold">Connect the signer workspace</h2>
              <p className="mt-2 text-base leading-7 text-neutral-600 dark:text-neutral-300">Saved contracts stay private to the connected signer workspace.</p>
              <button type="button" disabled={busy} onClick={() => void connect()} className="mt-6 rounded-xl bg-violet-700 px-5 py-3 font-semibold text-white disabled:opacity-50">{busy ? 'Opening wallets…' : 'Connect wallet'}</button>
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
                  {network && <NetworkBadge network={network} />}
                  <span>{contracts.length} saved {contracts.length === 1 ? 'contract' : 'contracts'}</span>
                </div>
                <a href={stellarHrefWithSearch('/new/contract', { network: network ?? 'public' })} className="inline-flex items-center gap-2 rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-800"><Plus className="h-4 w-4" />Add or call contract</a>
              </div>

              {error && (
                <div className="flex items-start justify-between gap-4 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
                  <span className="flex gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</span>
                  <button type="button" onClick={() => void refresh()} className="shrink-0 font-semibold underline">Retry</button>
                </div>
              )}
              {loading && <div className="flex items-center gap-2 py-8 text-sm text-neutral-500"><LoaderCircle className="h-4 w-4 animate-spin" />Loading contracts…</div>}

              {!loading && !error && contracts.length === 0 && (
                <section className="rounded-2xl border border-dashed border-black/15 bg-white/50 p-8 dark:border-white/15 dark:bg-white/[0.03]">
                  <h2 className="text-xl font-bold">No saved contracts yet</h2>
                  <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">Load any C-address, inspect its callable methods, then save it here for later.</p>
                </section>
              )}

              {!loading && contracts.length > 0 && (
                <div className="grid gap-3 md:grid-cols-2">
                  {contracts.map((contract) => (
                    <a key={contract.contractId} href={stellarHrefWithSearch('/contract', { contract: contract.contractId, network: contract.network })} className="group rounded-2xl border border-black/10 bg-white p-5 transition hover:border-violet-500/35 dark:border-white/10 dark:bg-white/[0.04]">
                      <div className="flex items-center justify-between gap-3"><Braces className="h-5 w-5 text-violet-600 dark:text-violet-300" /><NetworkBadge network={contract.network} /></div>
                      <div className="mt-5 font-mono text-sm font-semibold" title={contract.contractId}>{shortContract(contract.contractId)}</div>
                      <div className="mt-4 flex items-center gap-1.5 text-sm font-bold text-violet-700 dark:text-violet-300">Open contract <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" /></div>
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
