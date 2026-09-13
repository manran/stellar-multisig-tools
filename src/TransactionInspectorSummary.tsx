import { AlertTriangle, CheckCircle2, CircleAlert } from 'lucide-react';
import type { TransactionReviewAuthorizationStatus } from './stellar/transactionReviewAnalysis';
import type { TransactionXdrInspection } from './stellar/transactionXdr';

interface Props {
  inspection: TransactionXdrInspection;
  status: TransactionReviewAuthorizationStatus;
}

function shortKey(key: string) {
  return key.length <= 24 ? key : `${key.slice(0, 12)}…${key.slice(-10)}`;
}

export default function TransactionInspectorSummary({ inspection, status }: Props) {
  const sorobanOperations = inspection.operations.filter((operation) => operation.soroban);
  const sorobanAuthEntryCount = sorobanOperations.reduce(
    (count, operation) => count + (operation.soroban?.authorizationEntries.length ?? 0),
    0,
  );
  const hasSoroban = sorobanOperations.length > 0;
  const statusStyle = status === 'satisfied'
    ? 'border-emerald-500/30 bg-emerald-500/10'
    : status === 'missing'
      ? 'border-amber-500/30 bg-amber-500/10'
      : status === 'bad_auth_extra'
        ? 'border-red-500/30 bg-red-500/10'
        : 'border-sky-500/30 bg-sky-500/10';

  return (
    <>
      <section className={`grid gap-4 sm:grid-cols-2 ${hasSoroban ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
        <div className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-white/5">
          <div className="text-xs opacity-45">Envelope</div>
          <div className="mt-1 font-semibold">{inspection.envelopeType === 'fee_bump' ? 'Fee bump' : 'Transaction'}</div>
        </div>
        <div className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-white/5">
          <div className="text-xs opacity-45">Operations</div><div className="mt-1 text-xl font-bold">{inspection.operations.length}</div>
        </div>
        <div className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-white/5">
          <div className="text-xs opacity-45">{hasSoroban ? 'Envelope signatures' : 'Signatures'}</div>
          <div className="mt-1 text-xl font-bold">{inspection.innerSignatureCount}{inspection.envelopeType === 'fee_bump' ? ` + ${inspection.outerSignatureCount}` : ''}</div>
          {inspection.envelopeType === 'fee_bump' && <div className="mt-1 text-[11px] opacity-40">inner + outer</div>}
        </div>
        <div className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-white/5">
          <div className="text-xs opacity-45">{hasSoroban ? 'Envelope auth checks' : 'Authorization checks'}</div>
          <div className="mt-1 text-xl font-bold">{inspection.sourceRequirements.length + inspection.extraSigners.length}</div>
        </div>
        {hasSoroban && (
          <div className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-white/5">
            <div className="text-xs opacity-45">Soroban auth entries</div>
            <div className="mt-1 text-xl font-bold">{sorobanAuthEntryCount}</div>
          </div>
        )}
      </section>

      {status && (
        <section className={`flex gap-3 rounded-2xl border p-5 ${statusStyle}`}>
          {status === 'satisfied'
            ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            : status === 'missing'
              ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              : status === 'bad_auth_extra'
                ? <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                : <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />}
          <div>
            <div className="font-semibold">
              {status === 'satisfied'
                ? hasSoroban ? 'Transaction envelope authorization is satisfied' : 'Core-order authorization is satisfied'
                : status === 'missing'
                  ? 'More authorization is required'
                  : status === 'bad_auth_extra'
                    ? 'Core would reject unused signatures'
                    : 'Some account policies could not be loaded'}
            </div>
            <div className="mt-1 text-sm opacity-60">
              {hasSoroban
                ? 'This result covers transaction-envelope signatures only. Soroban authorization entries are separate evidence and appear below. Execution validity and simulation remain separate checks.'
                : status === 'bad_auth_extra'
                ? 'All required authorization can be met, but one or more decorated signatures remain unused and would cause txBAD_AUTH_EXTRA.'
                : 'This simulates Stellar signature consumption order. Sequence, time bounds, ledger state, fees, and operation validity remain separate checks.'}
            </div>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] opacity-35">Transaction context</div>
        <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0">
            <dt className="text-[10px] uppercase tracking-wider opacity-35">Source</dt>
            <dd className="mt-1 break-all font-mono text-xs opacity-70" title={inspection.transactionSource}>{inspection.transactionSource}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider opacity-35">Sequence</dt>
            <dd className="mt-1 font-mono text-xs opacity-70">{inspection.sequence}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider opacity-35">Inner fee</dt>
            <dd className="mt-1 text-xs opacity-70">{inspection.innerFee} stroops</dd>
          </div>
          {inspection.feeSource ? (
            <div className="min-w-0">
              <dt className="text-[10px] uppercase tracking-wider opacity-35">Fee-bump source</dt>
              <dd className="mt-1 break-all font-mono text-xs opacity-70" title={inspection.feeSource}>{inspection.feeSource}</dd>
            </div>
          ) : (
            <div>
              <dt className="text-[10px] uppercase tracking-wider opacity-35">Network</dt>
              <dd className="mt-1 text-xs font-semibold opacity-70">{inspection.network === 'public' ? 'Mainnet' : 'Testnet'}</dd>
            </div>
          )}
        </dl>
        {(inspection.memo.type !== 'none' || inspection.timeBounds || inspection.ledgerBounds || inspection.minAccountSequence) && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-black/5 pt-4 text-xs dark:border-white/10">
            {inspection.memo.type !== 'none' && (
              <span className="rounded-lg bg-black/5 px-2.5 py-1 dark:bg-white/10">Memo {inspection.memo.type}: <span className={inspection.memo.type === 'text' ? '' : 'font-mono'}>{inspection.memo.value}</span></span>
            )}
            {inspection.timeBounds && (
              <span className="rounded-lg bg-black/5 px-2.5 py-1 font-mono dark:bg-white/10">Time {inspection.timeBounds.minTime} → {inspection.timeBounds.maxTime === '0' ? '∞' : inspection.timeBounds.maxTime}</span>
            )}
            {inspection.ledgerBounds && (
              <span className="rounded-lg bg-black/5 px-2.5 py-1 font-mono dark:bg-white/10">Ledger {inspection.ledgerBounds.minLedger} → {inspection.ledgerBounds.maxLedger === 0 ? '∞' : inspection.ledgerBounds.maxLedger}</span>
            )}
            {inspection.minAccountSequence && (
              <span className="rounded-lg bg-black/5 px-2.5 py-1 font-mono dark:bg-white/10">Min sequence {inspection.minAccountSequence}</span>
            )}
          </div>
        )}
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">What this transaction does</h2>
            <p className="mt-1 text-xs opacity-45">Human-readable intent first; authorization details remain separate below.</p>
          </div>
          <div className="hidden text-xs opacity-40 sm:block">Sequence {inspection.sequence}</div>
        </div>
        <div className="space-y-3">
          {inspection.operations.map((operation) => (
            <article key={operation.index} className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] opacity-35">#{operation.index + 1}</span>
                    <h3 className="font-semibold">{operation.title}</h3>
                  </div>
                  <div className="mt-2 break-words text-sm font-medium">{operation.summary}</div>
                  <div className="mt-2 font-mono text-[11px] opacity-40" title={operation.sourceAccount}>Source {shortKey(operation.sourceAccount)}</div>
                </div>
                <div className="w-fit rounded-full bg-black/5 px-3 py-1 text-xs font-semibold capitalize dark:bg-white/10">{operation.soroban ? `Envelope: ${operation.threshold}` : `${operation.threshold} auth`}</div>
              </div>

              {operation.fields.length > 0 && (
                <dl className="mt-4 grid gap-x-5 gap-y-3 border-t border-black/5 pt-4 sm:grid-cols-2 dark:border-white/10">
                  {operation.fields.map((item) => (
                    <div key={`${item.label}:${item.value}`} className="min-w-0">
                      <dt className="text-[10px] font-semibold uppercase tracking-wider opacity-35">{item.label}</dt>
                      <dd className={`mt-1 break-all text-xs opacity-70 ${item.mono ? 'font-mono' : ''}`}>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
