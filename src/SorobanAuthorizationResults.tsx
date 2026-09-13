import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleAlert,
  FlaskConical,
  KeyRound,
  LoaderCircle,
  Network,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { ActionButton } from './MultiSigUi';
import { prepareContractCallOperation } from './contractOperationsClient';
import SorobanAuthorizationPreparation from './SorobanAuthorizationPreparation';
import type { SorobanAuthorizationPreparationInput } from './SorobanAuthorizationPreparation';
import type {
  SorobanAuthorizationEntryInspection,
  SorobanInvocationInspection,
} from './stellar/sorobanInspection';
import {
  SorobanSimulationError,
  sorobanSimulationEligibility,
  stellarRpcUrl,
} from './stellar/sorobanRpc';
import type { SorobanSimulationSummary } from './stellar/sorobanRpc';
import type { TransactionXdrInspection } from './stellar/transactionXdr';
import { loadNetworkParameters } from './stellar/horizon';
import { assertSorobanTransactionPreparedForFreeze } from './stellar/sorobanAuthorization';

interface Props {
  inspection: TransactionXdrInspection;
  envelopeXdr: string;
  onPreparedXdrChange: (xdr: string | null, ready: boolean) => void;
  autoRun?: boolean;
}

type SimulationState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'success'; result: SorobanSimulationSummary }
  | { status: 'error'; kind: SorobanSimulationError['kind']; message: string };

type PreparedImportState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; preparation: SorobanAuthorizationPreparationInput }
  | { status: 'error'; message: string };

function InvocationNode({ node, depth = 0 }: { node: SorobanInvocationInspection; depth?: number }) {
  return (
    <div className={depth > 0 ? 'border-l border-black/10 pl-4 dark:border-white/10' : ''}>
      <div className="rounded-xl bg-black/[0.03] p-3 dark:bg-white/[0.04]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">{node.type}</span>
          <span className="break-all text-sm font-semibold">{node.label}</span>
        </div>
        {node.detail && node.type === 'create' && <div className="mt-2 break-all font-mono text-[11px] text-neutral-500 dark:text-neutral-400">{node.detail}</div>}
        {node.argumentPreviews.length > 0 && (
          <div className="mt-3 space-y-1.5 text-xs text-neutral-600 dark:text-neutral-300">
            {node.argumentPreviews.map((argument, index) => (
              <div key={`${index}:${argument}`} className="grid gap-1 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-3">
                <span className="font-semibold text-neutral-400">Arg {index + 1}</span>
                <span className="break-all font-mono">{argument}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {node.children.length > 0 && (
        <div className="mt-2 space-y-2">
          {node.children.map((child, index) => <InvocationNode key={`${depth}:${index}:${child.label}`} node={child} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
}

function authorizationHeading(entry: SorobanAuthorizationEntryInspection): string {
  if (entry.sourceAccountAuthorization) return 'Transaction source account';
  if (entry.authorizationKind === 'contract-account') return 'Contract account (__check_auth)';
  if (entry.authorizationKind === 'delegated') return 'Delegated authorization';
  return entry.authorizer ?? 'Unknown authorizer';
}

function authorizationEvidence(entry: SorobanAuthorizationEntryInspection): string {
  if (entry.sourceAccountAuthorization) return 'Covered by transaction envelope authorization';
  if (entry.authorizationKind === 'contract-account') {
    return entry.signed
      ? 'Credential payload present; __check_auth decides validity'
      : 'Contract account requires custom authorization evidence';
  }
  if (entry.authorizationKind === 'delegated') {
    return entry.signed
      ? 'Delegated credential payload present; contract execution decides validity'
      : 'Delegated authorization still needs credential evidence';
  }
  return entry.signed
    ? 'Authorization entry carries signatures'
    : 'Authorization entry still needs signature evidence';
}

function signerEvidenceLabel(entry: SorobanAuthorizationEntryInspection, signed: boolean, signatureFormat: string, signatureCount: number | null): string {
  if (!signed) return 'Unsigned';
  if (entry.authorizationKind === 'contract-account') return 'Credential payload present · contract-enforced';
  if (entry.authorizationKind === 'delegated') return 'Delegated credential payload · contract-enforced';
  return signatureFormat === 'ed25519'
    ? `${signatureCount ?? 0} Ed25519 signature${signatureCount === 1 ? '' : 's'}`
    : 'Custom signature payload';
}

function AuthorizationEntry({ entry }: { entry: SorobanAuthorizationEntryInspection }) {
  if (entry.inspectionError) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
        <div className="flex gap-3">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <div className="font-semibold">Authorization entry #{entry.index + 1} could not be decoded</div>
            <div className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-300">{entry.inspectionError}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <article className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400">Authorization entry #{entry.index + 1}</div>
          <div className="mt-1 font-semibold">
            {authorizationHeading(entry)}
          </div>
          {!entry.sourceAccountAuthorization && entry.authorizer && <div className="mt-1 break-all font-mono text-[11px] text-neutral-500 dark:text-neutral-400">{entry.authorizer}</div>}
        </div>
        <span className="rounded-full bg-black/5 px-3 py-1 text-xs font-semibold dark:bg-white/10">
          {entry.credentialType}
        </span>
      </div>

      <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
        <div className="rounded-xl bg-black/[0.03] p-3 dark:bg-white/[0.04]">
          <div className="text-neutral-400">Authorization evidence</div>
          <div className="mt-1 font-semibold">
            {authorizationEvidence(entry)}
          </div>
        </div>
        <div className="rounded-xl bg-black/[0.03] p-3 dark:bg-white/[0.04]">
          <div className="text-neutral-400">Validity</div>
          <div className="mt-1 font-semibold">
            {entry.sourceAccountAuthorization
              ? 'Uses transaction validity'
              : entry.signatureExpirationLedger === null
                ? 'Expiration not available'
                : `Until ledger ${entry.signatureExpirationLedger}`}
          </div>
        </div>
      </div>

      {(entry.authorizationKind === 'contract-account' || entry.authorizationKind === 'delegated') && (
        <div className="mt-4 rounded-xl border border-violet-500/20 bg-violet-500/[0.06] p-3 text-xs leading-5 text-neutral-600 dark:text-neutral-300">
          <div className="font-semibold text-violet-800 dark:text-violet-300">Contract/network-enforced authorization</div>
          <div className="mt-1">MultiSig Tools can inspect this credential and invocation tree, but it does not locally prove custom account policy or credential validity. Stellar Host contract execution, including <span className="font-mono">__check_auth</span>, is authoritative. An explicitly configured C-account adapter may prepare this authorization below; unknown C-accounts and delegated authorization remain inspect-only.</div>
        </div>
      )}

      {entry.signers.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-neutral-500 dark:text-neutral-400"><KeyRound className="h-4 w-4" /> Signature-bearing credential nodes</div>
          {entry.signers.map((signer, index) => (
            <div key={`${signer.address}:${index}`} className="grid gap-2 rounded-xl border border-black/5 px-3 py-2 text-xs dark:border-white/10 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3">
              <span className="break-all font-mono">{signer.address}</span>
              <span className="font-semibold text-neutral-500 dark:text-neutral-400">
                {signerEvidenceLabel(entry, signer.signed, signer.signatureFormat, signer.signatureCount)}
              </span>
            </div>
          ))}
        </div>
      )}

      {entry.invocation && (
        <div className="mt-5 border-t border-black/5 pt-4 dark:border-white/10">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-neutral-500 dark:text-neutral-400"><Network className="h-4 w-4" /> Authorized invocation tree</div>
          <InvocationNode node={entry.invocation} />
        </div>
      )}
    </article>
  );
}

function endpointHost(endpointUrl: string): string {
  try {
    return new URL(endpointUrl).host;
  } catch {
    return endpointUrl;
  }
}

function SimulationResult({ result }: { result: SorobanSimulationSummary }) {
  const facts = [
    ['Latest ledger', String(result.latestLedger)],
    ['Minimum resource fee', result.minResourceFee ?? 'Not returned'],
    ['Required auth entries', String(result.authorizationEntries.length)],
    ['Events', String(result.eventCount)],
    ['State changes', String(result.stateChangeCount)],
    ['Restore required', result.restoreRequired ? 'Yes' : 'No'],
  ];
  if (result.cpuInstructions) facts.push(['CPU instructions', result.cpuInstructions]);
  if (result.memoryBytes) facts.push(['Memory bytes', result.memoryBytes]);

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] p-4">
        <div className="font-semibold text-emerald-800 dark:text-emerald-300">Simulation completed</div>
        <div className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-300">This is execution evidence from the configured RPC provider. It is not a signature and does not satisfy Soroban authorization by itself.</div>
        <div className="mt-3 break-all font-mono text-[11px] text-neutral-500 dark:text-neutral-400">Transaction hash · {result.transactionHash}</div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-black/[0.03] p-3 text-xs dark:bg-white/[0.04]">
            <div className="text-neutral-400">{label}</div>
            <div className="mt-1 break-all font-semibold">{value}</div>
          </div>
        ))}
      </div>

      {result.returnValuePreview && (
        <div className="rounded-xl bg-black/[0.03] p-3 text-xs dark:bg-white/[0.04]">
          <div className="text-neutral-400">Return value</div>
          <div className="mt-1 break-all font-mono">{result.returnValuePreview}</div>
        </div>
      )}

      {result.authorizationEntries.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">Required authorization from simulation</div>
          {result.authorizationEntries.map((entry) => <AuthorizationEntry key={entry.index} entry={entry} />)}
        </div>
      )}
    </div>
  );
}

export default function SorobanAuthorizationResults({ inspection, envelopeXdr, onPreparedXdrChange, autoRun = false }: Props) {
  const operations = inspection.operations.filter((operation) => operation.soroban);
  const [simulation, setSimulation] = useState<SimulationState>({ status: 'idle' });
  const [preparedImport, setPreparedImport] = useState<PreparedImportState>({ status: 'idle' });
  const autoSimulationKey = useRef('');
  const endpointUrl = useMemo(() => stellarRpcUrl(inspection.network), [inspection.network]);
  const eligibility = useMemo(() => sorobanSimulationEligibility(inspection), [inspection]);
  const importedPrepared = useMemo(() => {
    if (autoRun || inspection.innerSignatureCount > 0 || inspection.envelopeType !== 'transaction') return false;
    try {
      assertSorobanTransactionPreparedForFreeze(envelopeXdr, inspection.network);
      return true;
    } catch {
      return false;
    }
  }, [autoRun, envelopeXdr, inspection.envelopeType, inspection.innerSignatureCount, inspection.network]);
  const simulationPreparation = useMemo<SorobanAuthorizationPreparationInput | null>(() => {
    if (simulation.status !== 'success' || simulation.result.restoreRequired || !simulation.result.assembledXdr) return null;
    return {
      xdr: simulation.result.assembledXdr,
      network: simulation.result.network,
      currentLedger: simulation.result.latestLedger,
      endpointUrl: simulation.result.endpointUrl,
      source: 'record-simulation',
    };
  }, [simulation]);

  useEffect(() => {
    setSimulation({ status: 'idle' });
    onPreparedXdrChange(null, false);
  }, [envelopeXdr, inspection.network, onPreparedXdrChange]);

  useEffect(() => {
    if (!importedPrepared) {
      setPreparedImport({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setPreparedImport({ status: 'loading' });
    void loadNetworkParameters(inspection.network)
      .then((parameters) => {
        if (cancelled) return;
        setPreparedImport({
          status: 'ready',
          preparation: {
            xdr: envelopeXdr,
            network: inspection.network,
            currentLedger: parameters.ledgerSequence,
            endpointUrl,
            source: 'imported-prepared',
          },
        });
      })
      .catch((cause) => {
        if (cancelled) return;
        setPreparedImport({
          status: 'error',
          message: cause instanceof Error ? cause.message : 'Unable to load the current ledger for this prepared Soroban XDR.',
        });
      });
    return () => { cancelled = true; };
  }, [endpointUrl, envelopeXdr, importedPrepared, inspection.network]);

  useEffect(() => {
    if (!autoRun || !eligibility.supported) return;
    const key = `${inspection.network}:${envelopeXdr}`;
    if (autoSimulationKey.current === key) return;
    autoSimulationKey.current = key;
    void runSimulation();
  }, [autoRun, eligibility.supported, envelopeXdr, inspection.network]);

  if (operations.length === 0) return null;

  async function runSimulation() {
    if (!eligibility.supported || simulation.status === 'running') return;
    onPreparedXdrChange(null, false);
    setSimulation({ status: 'running' });
    try {
      const result = await prepareContractCallOperation({
        xdr: envelopeXdr,
        network: inspection.network,
      });
      setSimulation({ status: 'success', result });
    } catch (cause) {
      if (cause instanceof SorobanSimulationError) {
        setSimulation({ status: 'error', kind: cause.kind, message: cause.message });
      } else {
        setSimulation({
          status: 'error',
          kind: 'unavailable',
          message: 'Simulation failed unexpectedly. The transaction has not been marked invalid.',
        });
      }
    }
  }

  return (
    <section>
      <div className="mb-4">
        <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-violet-600" /><h2 className="text-xl font-bold">Contract authorization</h2></div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">Before Sign, Review checks the contract execution requirements and collects any authorization that must be embedded in the transaction. Transaction-envelope signatures still happen afterward.</p>
      </div>
      <details className="rounded-xl border border-black/10 px-4 py-3 dark:border-white/10">
        <summary className="cursor-pointer text-xs font-semibold text-neutral-500 dark:text-neutral-400">Authorization details</summary>
        <p className="mt-3 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Soroban authorization entries approve contract invocation trees. Supported G-account entries can be prepared before Sign; unknown C-accounts and delegated credentials remain inspect-only unless an explicit verified adapter defines the credential path.</p>
        <div className="mt-4 space-y-5">
          {operations.map((operation) => (
            <div key={operation.index} className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">Operation #{operation.index + 1} · {operation.soroban!.hostFunctionType}</div>
              {operation.soroban!.authorizationEntries.length > 0
                ? operation.soroban!.authorizationEntries.map((entry) => <AuthorizationEntry key={entry.index} entry={entry} />)
                : <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4 text-sm text-neutral-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-300">No authorization entries are embedded yet. The contract check can discover what execution requires.</div>}
            </div>
          ))}
        </div>
      </details>

      {importedPrepared && (
        <div className="mt-4 rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-5">
          <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-violet-600" /><h3 className="font-semibold">Prepared Soroban XDR</h3></div>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-neutral-500 dark:text-neutral-400">This imported XDR already contains Soroban execution resources. MultiSig Tools preserves existing pre-freeze signatures and continues from the embedded authorization entries instead of running recording simulation again. The exact transaction is still checked in enforce mode before Proposal freeze.</p>
          {preparedImport.status === 'loading' && <div className="mt-4 flex items-center gap-2 text-xs text-neutral-500"><LoaderCircle className="h-4 w-4 animate-spin" /> Loading current authorization policy…</div>}
          {preparedImport.status === 'error' && <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] p-3 text-xs leading-5 text-neutral-600 dark:text-neutral-300">{preparedImport.message}</div>}
          {preparedImport.status === 'ready' && <SorobanAuthorizationPreparation preparation={preparedImport.preparation} onPreparedXdrChange={onPreparedXdrChange} />}
        </div>
      )}

      {!importedPrepared && (
      <div className="mt-4 rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-5">
        <div className="flex items-center gap-2"><FlaskConical className="h-5 w-5 text-violet-600" /><h3 className="font-semibold">Checking contract requirements</h3></div>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-neutral-500 dark:text-neutral-400">{autoRun ? 'This guided Contract Call is checked automatically in Review. The check sends the exact pre-submission XDR to the configured Stellar RPC provider; it does not sign or submit the transaction.' : 'Imported Soroban XDR is not sent to the configured RPC provider until you run this check. The check does not sign or submit the transaction.'}</p>
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-black/[0.03] p-3 text-xs dark:bg-white/[0.04]">
          <Server className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
          <div className="min-w-0">
            <div className="font-semibold">Configured RPC · {endpointHost(endpointUrl)}</div>
            <div className="mt-1 break-all font-mono text-[11px] text-neutral-500 dark:text-neutral-400">{endpointUrl}</div>
          </div>
        </div>

        {eligibility.supported ? (
          <div className="mt-4">
            <ActionButton variant="secondary" size="sm" disabled={simulation.status === 'running'} onClick={() => void runSimulation()}>
              {simulation.status === 'running' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
              {simulation.status === 'running' ? 'Simulating…' : simulation.status === 'success' ? 'Run simulation again' : 'Run RPC simulation'}
            </ActionButton>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] p-3 text-xs leading-5 text-neutral-600 dark:text-neutral-300">{eligibility.reason}</div>
        )}

        {simulation.status === 'error' && (
          <div className={`mt-4 rounded-xl border p-4 ${simulation.kind === 'invalid' ? 'border-red-500/25 bg-red-500/[0.08]' : 'border-amber-500/25 bg-amber-500/[0.08]'}`}>
            <div className="flex gap-3">
              <CircleAlert className={`mt-0.5 h-4 w-4 shrink-0 ${simulation.kind === 'invalid' ? 'text-red-600' : 'text-amber-600'}`} />
              <div>
                <div className="font-semibold">{simulation.kind === 'invalid' ? 'Simulation found an execution error' : simulation.kind === 'configuration' ? 'RPC configuration is invalid' : 'Simulation unavailable'}</div>
                <div className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-300">{simulation.message}</div>
              </div>
            </div>
          </div>
        )}

        {simulation.status === 'success' && (
          <>
            <details className="mt-4 rounded-xl border border-black/10 px-4 py-3 dark:border-white/10">
              <summary className="cursor-pointer text-xs font-semibold text-neutral-500 dark:text-neutral-400">Simulation details</summary>
              <SimulationResult result={simulation.result} />
            </details>
            {simulation.result.restoreRequired ? (
              <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] p-3 text-xs leading-5 text-neutral-600 dark:text-neutral-300">This simulation requires state restoration before authorization can be prepared.</div>
            ) : !simulationPreparation ? (
              <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] p-3 text-xs leading-5 text-neutral-600 dark:text-neutral-300">This simulation result cannot be assembled into a signing-ready Soroban transaction. Use an unsigned transaction and re-run simulation; if the provider still omits required assembly data, keep this transaction in Review.</div>
            ) : (
              <SorobanAuthorizationPreparation preparation={simulationPreparation} onPreparedXdrChange={onPreparedXdrChange} />
            )}
          </>
        )}
      </div>
      )}
    </section>
  );
}
