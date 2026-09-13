import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Braces, CircleAlert, LoaderCircle } from 'lucide-react';
import { NetworkBadge, TransactionLifetimePicker, WorkflowProgress } from './MultiSigUi';
import { useContractWorkspaces } from './ContractWorkspaceContext';
import { buildContractCallOperation, inspectContractOperation, keepContractOperation } from './contractOperationsClient';
import { useStellarWallet } from './StellarWalletContext';
import { isValidStellarAccountId } from './stellar/horizon';
import { isValidContractId } from './stellar/contractSpec';
import type { ContractInputDescriptor, ContractMethodDescriptor } from './stellar/contractSpec';
import { MAX_PRIVATE_NOTE_BYTES, normalizePrivateNote, privateNoteByteLength } from './stellar/privateNote';
import { writeReviewHandoff } from './stellar/reviewHandoff';
import { getDefaultTransactionLifetime } from './stellar/transactionPreferences';
import type { StellarNetwork } from './stellar/types';
import { parseTreasuryRoute } from './treasuryNavigation';
import { navigateWorkspace, stellarHref, stellarHrefWithSearch } from './workspaceNavigation';

interface Props {
  network: StellarNetwork;
}

function fieldPlaceholder(input: ContractInputDescriptor): string {
  switch (input.kind) {
    case 'address': return 'G... or C... address';
    case 'integer': return 'Base-10 integer';
    case 'bytesN': return input.bytesLength ? `${input.bytesLength * 2} hex characters` : 'Hex bytes';
    case 'bytes': return 'Hex bytes, optional 0x prefix';
    case 'symbol': return 'Symbol';
    case 'string': return 'Text';
    default: return '';
  }
}

function MethodFact({ method }: { method: ContractMethodDescriptor }) {
  return (
    <section className="rounded-xl border border-black/10 bg-black/[0.018] p-4 dark:border-white/10 dark:bg-white/[0.025]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-sm font-semibold">{method.name}</div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${method.guided ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}>
          {method.guided ? 'Guided input' : 'Import XDR required'}
        </span>
      </div>
      {method.doc && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-600 dark:text-neutral-300"><span className="font-semibold">Contract spec description:</span> {method.doc}</p>}
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
        <span>Inputs: {method.inputs.length ? method.inputs.map((input) => `${input.name}: ${input.typeLabel}`).join(', ') : 'none'}</span>
        <span>Returns: {method.outputs.length ? method.outputs.join(', ') : 'Void'}</span>
      </div>
      {!method.guided && (
        <div className="mt-3 text-xs leading-5 text-amber-700 dark:text-amber-300">
          {method.inputs.filter((input) => input.kind === 'unsupported').map((input) => input.unsupportedReason).join(' ')}
        </div>
      )}
    </section>
  );
}

export default function ContractCallComposer({ network }: Props) {
  const { sessionAddress, unlock, authBusy } = useStellarWallet();
  const { contracts, ready: workspaceReady } = useContractWorkspaces();
  const params = new URLSearchParams(window.location.search);
  const route = parseTreasuryRoute(window.location.search);
  const routeContractId = (params.get('contract') ?? '').trim();
  const routeMethod = (params.get('method') ?? '').trim();
  const fromWorkspace = params.get('from') === 'workspace';
  const explicitSource = isValidStellarAccountId(route.accountId) ? route.accountId : '';
  const sourceEdited = useRef(false);
  const [source, setSource] = useState(() => explicitSource || (sessionAddress && isValidStellarAccountId(sessionAddress) ? sessionAddress : ''));
  const [contractId, setContractId] = useState(() => isValidContractId(routeContractId) ? routeContractId : '');
  const [loaded, setLoaded] = useState<{ methods: ContractMethodDescriptor[] } | null>(null);
  const [methodName, setMethodName] = useState('');
  const [rawArgs, setRawArgs] = useState<Record<string, string>>({});
  const [privateNote, setPrivateNote] = useState('');
  const [lifetimeSeconds, setLifetimeSeconds] = useState(() => getDefaultTransactionLifetime(localStorage));
  const [loadingSpec, setLoadingSpec] = useState(false);
  const [building, setBuilding] = useState(false);
  const [savingContract, setSavingContract] = useState(false);
  const [savedOverride, setSavedOverride] = useState(false);
  const [error, setError] = useState('');

  const workspaceSaved = savedOverride || contracts.some(
    (item) => item.contractId === contractId && item.network === network,
  );
  const selectedMethod = useMemo(
    () => loaded?.methods.find((method) => method.name === methodName) ?? null,
    [loaded, methodName],
  );
  const sourceValid = isValidStellarAccountId(source);
  const contractValid = isValidContractId(contractId);
  const privateNoteBytes = privateNoteByteLength(privateNote.trim());
  const privateNoteValid = privateNoteBytes <= MAX_PRIVATE_NOTE_BYTES;
  const testnet = network === 'testnet';
  const focusClass = testnet ? 'focus:border-sky-500' : 'focus:border-emerald-500';
  const primaryClass = testnet ? 'bg-sky-700 hover:bg-sky-800' : 'bg-emerald-700 hover:bg-emerald-800';
  const autoLoadContractRef = useRef('');

  useEffect(() => {
    if (explicitSource || sourceEdited.current || source || !sessionAddress || !isValidStellarAccountId(sessionAddress)) return;
    setSource(sessionAddress);
  }, [explicitSource, sessionAddress, source]);

  // Auto-load the interface once a complete C-address is valid.
  useEffect(() => {
    if (!contractValid) {
      autoLoadContractRef.current = '';
      return;
    }
    const key = `${network}:${contractId}`;
    if (autoLoadContractRef.current === key) return;
    autoLoadContractRef.current = key;
    const timer = window.setTimeout(() => { void loadInterface(); }, 200);
    return () => window.clearTimeout(timer);
  }, [contractId, contractValid, network]);

  function resetInterface(nextContractId: string) {
    setContractId(nextContractId.trim());
    setLoaded(null);
    setMethodName('');
    setRawArgs({});
    setError('');
  }

  async function loadInterface() {
    if (!contractValid || loadingSpec) return;
    setLoadingSpec(true);
    setError('');
    try {
      const next = await inspectContractOperation(contractId, network);
      setLoaded(next);
      const requested = routeMethod ? next.methods.find((method) => method.name === routeMethod) ?? null : null;
      const firstGuided = next.methods.find((method) => method.guided) ?? null;
      setMethodName(requested?.name ?? firstGuided?.name ?? next.methods[0]?.name ?? '');
      setRawArgs({});
      if (next.methods.length === 0) {
        setError('This contract exposes no callable methods in its contract spec.');
      } else if (routeMethod && !requested) {
        setError(`This contract does not expose the requested method: ${routeMethod}`);
      }
    } catch (cause) {
      setLoaded(null);
      setMethodName('');
      setRawArgs({});
      setError(cause instanceof Error ? cause.message : 'Unable to load this contract interface.');
    } finally {
      setLoadingSpec(false);
    }
  }

  function selectMethod(name: string) {
    setMethodName(name);
    setRawArgs({});
    setError('');
  }

  async function reviewContractCall(event: FormEvent) {
    event.preventDefault();
    if (!loaded || !selectedMethod?.guided || !sourceValid || !contractValid || !privateNoteValid || building) return;
    setBuilding(true);
    setError('');
    try {
      const built = await buildContractCallOperation({
        network,
        transactionSource: source,
        contractId,
        method: selectedMethod.name,
        arguments: rawArgs,
        lifetimeSeconds,
      });
      writeReviewHandoff(sessionStorage, {
        xdr: built.xdr,
        network,
        privateNote: privateNote.trim() ? normalizePrivateNote(privateNote) : null,
      });
      navigateWorkspace('/signing-room', {
        state: { returnTo: window.location.href, returnLabel: 'Edit contract call', autoSorobanSimulation: true },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to prepare this contract call.');
      setBuilding(false);
    }
  }

  async function saveContract() {
    if (!contractValid || savingContract || authBusy) return;
    setSavingContract(true);
    setError('');
    try {
      if (!workspaceReady) await unlock(undefined, network);
      await keepContractOperation(contractId, network);
      setSavedOverride(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save this contract.');
    } finally {
      setSavingContract(false);
    }
  }

  const workspaceHref = stellarHrefWithSearch('/contract', { contract: contractId, network });
  const backHref = fromWorkspace && contractValid ? workspaceHref : stellarHref('/new');

  return (
    <main className="px-4 py-7 sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6"><WorkflowProgress current="prepare" /></div>
        <a href={backHref} className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-600 hover:text-black dark:text-neutral-300 dark:hover:text-white"><ArrowLeft className="h-4 w-4" />{fromWorkspace ? 'Contract Workspace' : 'New'}</a>
        <div className="mt-4 flex flex-wrap items-center gap-3"><Braces className="h-6 w-6 text-violet-600 dark:text-violet-300" /><h1 className="text-3xl font-bold tracking-tight">Call a contract</h1><NetworkBadge network={network} /></div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">Load the contract's on-chain spec, choose a callable method, and build its exact Soroban transaction. MultiSig Tools shows ABI facts from the contract; it does not infer business intent from a function name.</p>
        {loaded && fromWorkspace && (
          <div className="mt-4 rounded-xl border border-violet-500/20 bg-violet-500/[0.04] p-4 text-sm leading-6 text-neutral-600 dark:border-violet-400/20 dark:text-neutral-300">
            <div className="font-semibold text-neutral-900 dark:text-white">Contract Workspace call</div>
            <p className="mt-1">The contract and requested method came from its workspace. Review returns here with this context preserved.</p>
            <a href={workspaceHref} className="mt-3 inline-flex font-semibold text-violet-700 dark:text-violet-300">Back to Contract Workspace</a>
          </div>
        )}
        {loaded && !fromWorkspace && (
          <div className="mt-4 rounded-xl border border-violet-500/20 bg-violet-500/[0.04] p-4 text-sm leading-6 text-neutral-600 dark:border-violet-400/20 dark:text-neutral-300">
            <div className="font-semibold text-neutral-900 dark:text-white">{workspaceSaved ? 'Saved contract' : 'Save contract workspace'}</div>
            <p className="mt-1">{workspaceSaved ? 'This reusable contract is already available from Contracts.' : 'Save this contract only if you expect to use or manage it again. One-time calls need no workspace.'}</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <a href="#contract-method" className="font-semibold text-neutral-700 dark:text-neutral-200">Continue call</a>
              {workspaceSaved
                ? <a href={workspaceHref} className="font-semibold text-violet-700 dark:text-violet-300">Open Contract Workspace</a>
                : <button type="button" disabled={savingContract || authBusy} onClick={() => void saveContract()} className="font-semibold text-violet-700 disabled:opacity-40 dark:text-violet-300">{savingContract || authBusy ? 'Saving…' : 'Save to Contracts'}</button>}
            </div>
          </div>
        )}

        <form onSubmit={reviewContractCall} className="mt-6 space-y-5 rounded-2xl border border-black/10 bg-white p-5 shadow-sm shadow-black/[0.02] dark:border-white/10 dark:bg-white/5 sm:p-6">
          <div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="contract-source" className="text-sm font-semibold">Transaction source</label>
              {sessionAddress && isValidStellarAccountId(sessionAddress) && source !== sessionAddress && (
                <button type="button" disabled={building} onClick={() => { sourceEdited.current = true; setSource(sessionAddress); }} className="text-sm font-semibold text-violet-700 hover:text-violet-800 disabled:opacity-50 dark:text-violet-300">Use my account</button>
              )}
            </div>
            <input id="contract-source" value={source} disabled={building} onChange={(event) => { sourceEdited.current = true; setSource(event.target.value.trim()); }} placeholder="G... transaction source" spellCheck={false} className={`mt-2 w-full rounded-xl border border-black/10 bg-transparent px-4 py-3 font-mono text-sm outline-none disabled:opacity-50 dark:border-white/10 ${focusClass}`} />
            <p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Usually this is your signed-in account. Paste another G... account only when it should provide the transaction sequence and pay the transaction fee. Contract authorization is resolved separately.</p>
            {source && !sourceValid && <p className="mt-2 text-sm text-red-700 dark:text-red-300">Enter a valid Stellar G... account.</p>}
          </div>

          <div>
            <label htmlFor="contract-id" className="text-sm font-semibold">Contract</label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input id="contract-id" value={contractId} disabled={loadingSpec || building} onChange={(event) => resetInterface(event.target.value)} placeholder="C... contract address" spellCheck={false} className={`min-w-0 flex-1 rounded-xl border border-black/10 bg-transparent px-4 py-3 font-mono text-sm outline-none disabled:opacity-50 dark:border-white/10 ${focusClass}`} />
              <button
                type="button"
                disabled={!contractValid || loadingSpec || building}
                onClick={() => void loadInterface()}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-black/10 px-4 py-3 text-sm font-semibold hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/10"
              >
                {loadingSpec && <LoaderCircle className="h-4 w-4 animate-spin" />}
                {loadingSpec ? 'Loading interface…' : loaded ? 'Reload interface' : contractValid && error ? 'Retry interface' : 'Load interface'}
              </button>
            </div>
            {contractId && !contractValid && <p className="mt-2 text-sm text-red-700 dark:text-red-300">Enter a valid Stellar C... contract address.</p>}
          </div>

          {loaded && (
            <>
              <div>
                <label htmlFor="contract-method" className="text-sm font-semibold">Method</label>
                <select id="contract-method" value={methodName} disabled={building || loaded.methods.length === 0} onChange={(event) => selectMethod(event.target.value)} className={`mt-2 w-full rounded-xl border border-black/10 bg-white px-4 py-3 font-mono text-sm outline-none disabled:opacity-50 dark:border-white/10 dark:bg-[#141414] ${focusClass}`}>
                  {loaded.methods.length === 0 && <option value="">No callable methods</option>}
                  {loaded.methods.map((method) => <option key={method.name} value={method.name}>{method.name}{method.guided ? '' : ' — Import XDR required'}</option>)}
                </select>
              </div>

              {selectedMethod && <MethodFact method={selectedMethod} />}

              {selectedMethod?.guided && selectedMethod.inputs.length > 0 && (
                <section className="space-y-4 border-t border-black/10 pt-5 dark:border-white/10">
                  <div><div className="font-semibold">Arguments</div><div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Values are encoded against the exact type declared by the loaded contract spec.</div></div>
                  {selectedMethod.inputs.map((input) => (
                    <div key={input.name}>
                      <div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor={`contract-arg-${input.name}`} className="text-sm font-semibold">{input.name}</label><span className="font-mono text-xs text-neutral-500 dark:text-neutral-400">{input.typeLabel}</span></div>
                      {input.kind === 'bool' ? (
                        <select id={`contract-arg-${input.name}`} value={rawArgs[input.name] ?? ''} disabled={building} onChange={(event) => setRawArgs((current) => ({ ...current, [input.name]: event.target.value }))} className={`mt-2 w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm outline-none dark:border-white/10 dark:bg-[#141414] ${focusClass}`}><option value="">Choose…</option><option value="true">true</option><option value="false">false</option></select>
                      ) : (
                        <input id={`contract-arg-${input.name}`} value={rawArgs[input.name] ?? ''} disabled={building} onChange={(event) => setRawArgs((current) => ({ ...current, [input.name]: event.target.value }))} placeholder={fieldPlaceholder(input)} spellCheck={false} className={`mt-2 w-full rounded-xl border border-black/10 bg-transparent px-4 py-3 font-mono text-sm outline-none disabled:opacity-50 dark:border-white/10 ${focusClass}`} />
                      )}
                      {input.doc && <p className="mt-1.5 whitespace-pre-wrap text-xs leading-5 text-neutral-500 dark:text-neutral-400">Contract spec: {input.doc}</p>}
                      {(input.kind === 'bytes' || input.kind === 'bytesN') && <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">Enter hexadecimal bytes; `0x` prefix is optional.</p>}
                    </div>
                  ))}
                </section>
              )}
            </>
          )}

          <div className="border-t border-black/10 pt-5 dark:border-white/10">
            <label htmlFor="contract-private-note" className="text-sm font-semibold">Private Note <span className="font-normal text-neutral-400">optional</span></label>
            <textarea id="contract-private-note" value={privateNote} disabled={building} onChange={(event) => setPrivateNote(event.target.value)} rows={3} placeholder="Context for people reviewing this Proposal." className={`mt-2 w-full resize-y rounded-xl border border-black/10 bg-transparent px-4 py-3 text-sm leading-6 outline-none disabled:opacity-50 dark:border-white/10 ${focusClass}`} />
            <div className={`mt-1 text-xs ${privateNoteValid ? 'text-neutral-400' : 'text-red-600 dark:text-red-300'}`}>{privateNoteBytes}/{MAX_PRIVATE_NOTE_BYTES} UTF-8 bytes</div>
          </div>

          <TransactionLifetimePicker network={network} value={lifetimeSeconds} onChange={setLifetimeSeconds} disabled={building} />

          <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.06] px-4 py-3 text-xs leading-5 text-neutral-600 dark:text-neutral-300">Review will run the existing Soroban simulation and authorization flow before the final XDR is frozen for signatures. Nothing is submitted from this screen.</div>

          <div className="flex justify-end border-t border-black/10 pt-5 dark:border-white/10">
            <button type="submit" disabled={building || loadingSpec || !sourceValid || !contractValid || !selectedMethod?.guided || !privateNoteValid} className={`inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white disabled:opacity-40 ${primaryClass}`}>{building && <LoaderCircle className="h-4 w-4 animate-spin" />}{building ? 'Preparing review…' : 'Review contract call'} <ArrowRight className="h-4 w-4" /></button>
          </div>
        </form>

        {error && <div className="mt-5 flex gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm"><CircleAlert className="h-5 w-5 shrink-0 text-red-500" />{error}</div>}
      </div>
    </main>
  );
}
