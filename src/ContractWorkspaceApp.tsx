import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Braces, CircleAlert, LoaderCircle, Trash2 } from 'lucide-react';
import { StrKey } from '@stellar/stellar-sdk/base';
import { NetworkBadge } from './MultiSigUi';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useContractWorkspaces } from './ContractWorkspaceContext';
import { inspectContractOperation, keepContractOperation } from './contractOperationsClient';
import type { ContractMethodDescriptor } from '../packages/stellar-core/src/contractSpec';
import { resolveStellarNetwork } from './stellar/networkPreference';
import type { StellarNetwork } from '../packages/stellar-core/src/types';
import { useStellarWallet } from './StellarWalletContext';
import { navigateWorkspace, stellarHref, stellarHrefWithSearch } from './workspaceNavigation';

function routeObject(): { contractId: string; network: StellarNetwork } | null {
  const params = new URLSearchParams(window.location.search);
  const contractId = (params.get('contract') ?? '').trim();
  if (!StrKey.isValidContract(contractId)) return null;
  return { contractId, network: resolveStellarNetwork(params.get('network'), null) };
}

export default function ContractWorkspaceApp() {
  const route = useMemo(routeObject, []);
  const contractId = route?.contractId ?? '';
  const network = route?.network ?? 'public';
  const { contracts, ready, forget } = useContractWorkspaces();
  const { unlock, authBusy } = useStellarWallet();
  const [methods, setMethods] = useState<ContractMethodDescriptor[]>([]);
  const [loading, setLoading] = useState(Boolean(route));
  const [saving, setSaving] = useState(false);
  const [savedOverride, setSavedOverride] = useState(false);
  const [error, setError] = useState('');
  const saved = savedOverride || contracts.some(
    (item) => item.contractId === contractId && item.network === network,
  );

  useEffect(() => {
    if (route) return;
    navigateWorkspace('/contracts', { replace: true });
  }, [route]);

  useEffect(() => {
    if (!route) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    void inspectContractOperation(route.contractId, route.network)
      .then((loaded) => { if (!cancelled) setMethods(loaded.methods); })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load this contract interface.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [route?.contractId, route?.network]);

  if (!route) return null;

  function callHref(method?: string) {
    return stellarHrefWithSearch('/new/contract', {
      contract: contractId,
      network,
      from: 'workspace',
      ...(method ? { method } : {}),
    });
  }

  async function keepContract() {
    if (saving || authBusy) return;
    setSaving(true);
    setError('');
    try {
      if (!ready) await unlock(undefined, network);
      await keepContractOperation(contractId, network);
      setSavedOverride(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save this contract.');
    } finally {
      setSaving(false);
    }
  }

  async function forgetContract() {
    if (!ready || saving) return;
    setSaving(true);
    setError('');
    try {
      await forget(contractId);
      navigateWorkspace('/contracts');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to remove this contract.');
      setSaving(false);
    }
  }

  return (
    <StellarWorkspaceShell active="contracts" networkContext={network}>
      <main className="px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-5xl">
          <a href={stellarHref('/contracts')} className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-600 hover:text-black dark:text-neutral-300 dark:hover:text-white"><ArrowLeft className="h-4 w-4" />Contracts</a>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Braces className="mst-contract-accent h-6 w-6" />
            <h1 className="text-3xl font-bold tracking-tight">Contract Workspace</h1>
            <NetworkBadge network={network} />
            {saved && <span className="mst-contract-saved">Saved</span>}
          </div>
          <p className="mt-2 break-all font-mono text-sm text-neutral-500 dark:text-neutral-400">{contractId}</p>

          {error && <div className="mt-5 flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}

          <div className="mst-contract-workspace mt-6">
            <section className="mst-contract-methods">
              <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">Callable methods</h2>{loading && <LoaderCircle className="h-4 w-4 animate-spin text-neutral-400" />}</div>
              {loading && <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">Loading callable methods from the on-chain contract spec…</p>}
              {!loading && !error && (
                <div className="mst-contract-method-list">
                  {methods.length ? methods.map((method) => (
                    <a key={method.name} href={callHref(method.name)} className="mst-contract-method-row">
                      <span className="font-mono text-sm font-semibold">{method.name}</span>
                      <span className="mst-contract-method-row__args">{method.inputs.length ? method.inputs.map((input) => `${input.name}: ${input.typeLabel}`).join(', ') : 'No arguments'}</span>
                      <ArrowRight className="h-4 w-4" />
                    </a>
                  )) : <span className="block py-4 text-sm text-neutral-500 dark:text-neutral-400">No callable methods found.</span>}
                </div>
              )}
              <a href={callHref()} className="mst-action-primary mt-6">New contract call</a>
            </section>

            <div className="mst-contract-facts">
              <section className="mst-contract-fact">
                <h2 className="text-sm font-bold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Authorization</h2>
                <div className="mt-3 text-lg font-bold">Resolved at action time</div>
                <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">Saving this contract grants no permission. Current Stellar and contract authorization is checked before signing or submission.</p>
              </section>

              <section className="mst-contract-fact">
                <h2 className="font-bold">Workspace</h2>
                {saved ? (
                  <>
                    <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">Saved for this signer workspace.</p>
                    <button type="button" disabled={!ready || saving} onClick={() => void forgetContract()} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-red-700 hover:underline disabled:opacity-40 dark:text-red-300"><Trash2 className="h-4 w-4" />Forget contract</button>
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">Save this reusable work object to your signer workspace.</p>
                    <button type="button" disabled={saving || authBusy} onClick={() => void keepContract()} className="mst-action-secondary mt-4 disabled:opacity-40">{saving || authBusy ? 'Saving…' : 'Save to Contracts'}</button>
                  </>
                )}
              </section>
            </div>
          </div>
        </div>
      </main>
    </StellarWorkspaceShell>
  );
}
