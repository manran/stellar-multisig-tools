import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Braces, CircleAlert, LoaderCircle, Trash2 } from 'lucide-react';
import { StrKey } from '@stellar/stellar-sdk/base';
import { NetworkBadge } from './MultiSigUi';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useContractWorkspaces } from './ContractWorkspaceContext';
import { inspectContractOperation } from './contractOperationsClient';
import type { ContractMethodDescriptor } from '../../../packages/stellar-core/src/contractSpec';
import { resolveStellarNetwork } from './stellar/networkPreference';
import type { StellarNetwork } from '../../../packages/stellar-core/src/types';
import { useStellarWallet } from './StellarWalletContext';
import { navigateWorkspace, stellarHref, stellarHrefWithSearch } from './workspaceNavigation';
import { WORKSPACE_COPY } from './workspaceCopy';

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
  const { contracts, ready, keep, forget } = useContractWorkspaces();
  const { authBusy } = useStellarWallet();
  const [methods, setMethods] = useState<ContractMethodDescriptor[]>([]);
  const [loading, setLoading] = useState(Boolean(route));
  const [saving, setSaving] = useState(false);
  const [savedOverride, setSavedOverride] = useState(false);
  const [error, setError] = useState('');
  const savedContract = contracts.find((item) => item.contractId === contractId && item.network === network);
  const saved = savedOverride || Boolean(savedContract);
  const [editingDetails, setEditingDetails] = useState(false);
  const [nickname, setNickname] = useState('');
  const [organization, setOrganization] = useState('');

  useEffect(() => {
    setNickname(savedContract?.nickname ?? '');
    setOrganization(savedContract?.organization ?? '');
  }, [savedContract?.nickname, savedContract?.organization]);

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
      if (!ready) {
        navigateWorkspace('/identity', { search: '?next=/contracts' });
        return;
      }
      await keep(contractId, { nickname, organization });
      setSavedOverride(true);
      navigateWorkspace('/contracts');
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
          <a href={stellarHref('/contracts')} className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-600 hover:text-black dark:text-neutral-300 dark:hover:text-white"><ArrowLeft className="h-4 w-4" />{WORKSPACE_COPY.tools.contracts}</a>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Braces className="mst-contract-accent h-6 w-6" />
            <h1 className="text-3xl font-bold tracking-tight">{savedContract?.nickname || 'Contract details'}</h1>
            <NetworkBadge network={network} />
            {saved && <span className="mst-contract-saved">Saved</span>}
          </div>
          {savedContract?.organization && <p className="mt-2 text-sm font-semibold">{savedContract.organization} <span className="font-normal text-[var(--color-ink-2)]">· Your label</span></p>}
          <p className="mt-2 break-all font-mono text-sm text-neutral-500 dark:text-neutral-400">{contractId}</p>

          {error && <div className="mt-5 flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}

          <div className="mst-contract-workspace mt-6">
            <section className="mst-contract-methods">
              <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">Available actions</h2>{loading && <LoaderCircle className="h-4 w-4 animate-spin text-neutral-400" />}</div>
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
                <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">Signing rights are checked when you authorize an action.</p>
              </section>

              <section className="mst-contract-fact">
                <h2 className="font-bold">Saved contract</h2>
                {saved ? (
                  <>
                    <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">Saved to Smart Contracts.</p>
                    <button type="button" className="mt-3 text-sm font-semibold underline underline-offset-4" onClick={() => setEditingDetails((value) => !value)} aria-expanded={editingDetails}>Edit details</button>
                    {editingDetails && <div className="mt-3 space-y-3">
                      <label htmlFor="saved-contract-nickname" className="block text-sm font-semibold">Nickname</label>
                      <input id="saved-contract-nickname" className="mst-contract-control w-full" maxLength={80} value={nickname} onChange={(event) => setNickname(event.target.value)} />
                      <label htmlFor="saved-contract-organization" className="block text-sm font-semibold">Organization</label>
                      <input id="saved-contract-organization" className="mst-contract-control w-full" maxLength={80} value={organization} onChange={(event) => setOrganization(event.target.value)} />
                      <button type="button" disabled={saving} className="mst-action-secondary disabled:opacity-50" onClick={() => void keepContract()}>Save changes</button>
                    </div>}
                    <button type="button" disabled={!ready || saving} onClick={() => void forgetContract()} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-red-700 hover:underline disabled:opacity-40 dark:text-red-300"><Trash2 className="h-4 w-4" />Forget contract</button>
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">Keep this contract in Smart Contracts for later.</p>
                    <button type="button" disabled={saving || authBusy} onClick={() => void keepContract()} className="mst-action-secondary mt-4 disabled:opacity-40">{saving || authBusy ? 'Saving…' : WORKSPACE_COPY.contracts.save}</button>
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
