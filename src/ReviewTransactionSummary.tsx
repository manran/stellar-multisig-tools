import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Clock3, Settings2, ShieldAlert } from 'lucide-react';
import AddressIdentity from './AddressIdentity';
import { useAddressBook } from './AddressBookContext';
import PrivateCommitmentDisclosure from './PrivateCommitmentDisclosure';
import { useStellarWallet } from './StellarWalletContext';
import { summarizeAccountControlReview } from './stellar/accountControlReview';
import { compactAssetIssuer, inspectedAssetIdentity } from './stellar/assetPresentation';
import type { PrivateCommitmentDraft, PrivateCommitmentRecord } from '../packages/stellar-core/src/privateCommitment';
import { projectTransactionSemantics } from './stellar/transactionSemantics';
import type { PaymentSemanticFacts } from './stellar/transactionSemantics';
import { stellarAmountToStroops, stroopsToStellarAmount } from '../packages/stellar-core/src/reserve';
import type { TransactionXdrInspection } from '../packages/stellar-core/src/transactionXdr';
import { hasSharedSigningControl } from '../packages/stellar-core/src/treasuryModel';
import type { StellarAccountSnapshot } from '../packages/stellar-core/src/types';
import { cachedTreasuryName, loadSharedTreasuryNames } from './treasuryMetadataCache';
import { treasuryDisplayLabel } from './treasuryDisplay';

interface Props {
  inspection: TransactionXdrInspection;
  xdr?: string;
  sourceAccount?: StellarAccountSnapshot | null;
  privateCommitment?: PrivateCommitmentDraft | PrivateCommitmentRecord | null;
  mode?: 'review' | 'history';
}

function validityLabel(inspection: TransactionXdrInspection): string {
  const maxTime = inspection.timeBounds?.maxTime;
  if (!maxTime || maxTime === '0') return 'No expiration time set';
  const millis = Number(maxTime) * 1000;
  if (!Number.isFinite(millis)) return 'Transaction validity could not be read';
  return `Valid until ${new Date(millis).toLocaleString()}`;
}

function memoLabel(type: string): string {
  if (type === 'text') return 'Stellar memo';
  if (type === 'id') return 'Stellar memo ID';
  if (type === 'hash') return 'Stellar memo hash';
  if (type === 'return') return 'Stellar return hash';
  return 'Stellar memo';
}

function durationLabel(seconds: number): string {
  if (seconds % 86_400 === 0) {
    const days = seconds / 86_400;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  return `${seconds} seconds`;
}


function OperationFieldGrid({ operation, allowNaming }: {
  operation: TransactionXdrInspection['operations'][number];
  allowNaming: boolean;
}) {
  return (
    <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">Source</div>
        <div className="mt-1"><AddressIdentity address={operation.sourceAccount} subjectType="account" allowNaming={allowNaming} /></div>
      </div>
      {operation.fields.map((field) => (
        <div key={`${operation.index}:${field.label}`} className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">{field.label}</div>
          <div className={`mt-1 break-words text-sm ${field.mono ? 'break-all font-mono text-xs' : 'font-semibold'}`}>{field.value}</div>
        </div>
      ))}
      {operation.fields.length === 0 && <div className="text-xs leading-5 text-neutral-500 dark:text-neutral-400 sm:col-span-2">No additional structured fields are available here. Verify the raw operation under Advanced if you need protocol-level evidence.</div>}
    </div>
  );
}

interface PaymentTotal {
  asset: string;
  amount: string;
}

function PaymentAssetIdentity({ asset, compact = false }: { asset: string; compact?: boolean }) {
  const identity = inspectedAssetIdentity(asset);
  return (
    <div className={compact ? 'min-w-0' : ''}>
      <div className="font-semibold">{identity.code}</div>
      {identity.issuer && (
        <div className="mt-0.5 truncate font-mono text-[10px] font-normal text-neutral-400" title={identity.issuer}>
          Issuer {compactAssetIssuer(identity.issuer)}
        </div>
      )}
    </div>
  );
}

function paymentTotals(payments: PaymentSemanticFacts[]): PaymentTotal[] {
  const totals = new Map<string, bigint>();
  for (const payment of payments) {
    try {
      totals.set(payment.asset, (totals.get(payment.asset) ?? 0n) + stellarAmountToStroops(payment.amount));
    } catch {
      return [];
    }
  }
  return [...totals.entries()].map(([asset, stroops]) => ({ asset, amount: stroopsToStellarAmount(stroops) }));
}

export default function ReviewTransactionSummary({ inspection, xdr, sourceAccount = null, privateCommitment, mode = 'review' }: Props) {
  const { labelFor } = useAddressBook();
  const { sessionAddress, privateUnlocked } = useStellarWallet();
  const operations = inspection.operations;
  const semantics = projectTransactionSemantics(inspection);
  const sourceAlias = labelFor(inspection.transactionSourceAccount, 'account');
  const isSigningSetup = semantics.kind === 'signing_change' && semantics.signingAccountId === inspection.transactionSourceAccount;
  const accountControlReview = isSigningSetup && xdr ? summarizeAccountControlReview(xdr, inspection.network, sourceAccount) : null;
  const payment = semantics.kind === 'payment' ? semantics.payment : null;
  const structuredPayments = semantics.kind === 'batch_payment' || semantics.kind === 'multi_party' ? semantics.payments : [];
  const claimablePayment = semantics.kind === 'claimable_payment' ? semantics.claimablePayment : null;
  const totals = paymentTotals(structuredPayments);
  const batchRecipientCounts = semantics.kind === 'batch_payment'
    ? structuredPayments.reduce((counts, item) => counts.set(item.destination, (counts.get(item.destination) ?? 0) + 1), new Map<string, number>())
    : new Map<string, number>();
  const repeatedBatchRecipients = [...batchRecipientCounts.values()].filter((count) => count > 1).length;
  const paymentAmount = payment?.amount ?? '';
  const paymentAsset = payment?.assetCode ?? '';
  const paymentDestination = payment?.destination ?? '';
  const allowNaming = Boolean(sessionAddress);
  const hasMemo = inspection.memo.type !== 'none' && inspection.memo.value != null;
  const sourceIsTreasury = Boolean(sourceAccount && hasSharedSigningControl(sourceAccount));
  const [sourceTreasuryName, setSourceTreasuryName] = useState(() =>
    cachedTreasuryName(sessionStorage, inspection.network, inspection.transactionSourceAccount),
  );

  useEffect(() => {
    const cached = cachedTreasuryName(sessionStorage, inspection.network, inspection.transactionSourceAccount);
    setSourceTreasuryName(cached);
    if (!sourceIsTreasury || !privateUnlocked || !sessionAddress) return;
    let cancelled = false;
    const controller = new AbortController();
    void loadSharedTreasuryNames(
      [inspection.transactionSourceAccount],
      inspection.network,
      sessionAddress,
      controller.signal,
    )
      .then((names) => {
        if (!cancelled) setSourceTreasuryName(names[inspection.transactionSourceAccount] || cached);
      })
      .catch(() => undefined);
    return () => { cancelled = true; controller.abort(); };
  }, [inspection.transactionSourceAccount, inspection.network, sourceIsTreasury, privateUnlocked, sessionAddress]);

  const sourceDisplay = treasuryDisplayLabel(sourceTreasuryName, sourceAlias);
  let title = operations.length === 1 ? operations[0].title : `Review ${operations.length} account changes`;
  let description = operations.length === 1 ? operations[0].summary : 'These changes will be applied together after the required signers sign the transaction.';
  if (isSigningSetup) {
    title = mode === 'history'
      ? (sourceDisplay ? `Signing policy change · ${sourceDisplay}` : 'Signing policy change')
      : (sourceDisplay ? `Change signing for ${sourceDisplay}` : 'Change account signing');
    description = mode === 'history' ? 'Account-control changes encoded in this transaction.' : 'Review exactly how this transaction changes account control before signing it.';
  } else if (payment) {
    title = mode === 'history' ? `${paymentAmount || '?'} ${paymentAsset || 'asset'} transfer` : `Send ${paymentAmount || '?'} ${paymentAsset || 'asset'}`;
    description = mode === 'history' ? 'Source and destination encoded in the transaction.' : 'Confirm the source account and recipient before signing this payment.';
  } else if (semantics.kind === 'batch_payment') {
    title = mode === 'history' ? `Payment · ${structuredPayments.length} recipients` : `Pay ${structuredPayments.length} recipients`;
    description = mode === 'history' ? 'Every payment below was encoded in one atomic Stellar transaction.' : 'Confirm every recipient, amount, and asset. The entire batch succeeds or fails together.';
  } else if (semantics.kind === 'multi_party') {
    title = mode === 'history' ? `Multi-party transaction · ${structuredPayments.length} payments` : 'Multi-party transaction';
    description = mode === 'history' ? 'Independent source accounts participated in one atomic Stellar transaction.' : 'Confirm who sends each payment. Each source account must independently authorize its own operations, and all operations execute atomically.';
  } else if (claimablePayment) {
    title = mode === 'history' ? `${claimablePayment.amount || '?'} ${claimablePayment.assetCode || 'asset'} claimable payment` : `Send ${claimablePayment.amount || '?'} ${claimablePayment.assetCode || 'asset'} to claim later`;
    description = mode === 'history' ? 'The recipient claim window and recovery path are encoded in this transaction.' : 'Confirm the recipient and recovery path before signing. If the recipient does not claim in time, the recovery account can take the balance back.';
  }
  return (
    <section className={`transaction-evidence-summary ${mode === 'history' ? 'rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/[0.035] sm:p-6' : 'mst-evidence-surface'}`}>
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-emerald-500/10 p-2.5 text-emerald-700 dark:text-emerald-300">{isSigningSetup ? <Settings2 className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}</div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] opacity-40">{mode === 'history' ? 'Transaction' : 'What you are reviewing'}</div>
          <h2 className="mt-2 text-2xl font-bold">{title}</h2>
          <p className="mt-2 text-sm leading-6 opacity-65">{description}</p>

          {payment && paymentDestination && (
            <div className="mt-5 grid gap-3 rounded-xl bg-black/[0.03] p-4 dark:bg-white/[0.04] md:grid-cols-2">
              <div className="min-w-0">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">From</div>
                <AddressIdentity address={inspection.transactionSourceAccount} subjectType="account" labelOverride={sourceDisplay} />
              </div>
              <div className="min-w-0 border-t border-black/5 pt-3 dark:border-white/10 md:border-l md:border-t-0 md:pl-4 md:pt-0">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">To</div>
                <AddressIdentity address={paymentDestination} subjectType="account" allowNaming={allowNaming} />
              </div>
              <div className="min-w-0 border-t border-black/5 pt-3 dark:border-white/10 md:col-span-2">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">Asset</div>
                <PaymentAssetIdentity asset={payment.asset} />
              </div>
            </div>
          )}

          {structuredPayments.length > 0 && (
            <div className="mt-5 overflow-hidden rounded-xl border border-black/10 dark:border-white/10">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 bg-black/[0.025] px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">Exact payment list</div>
                {totals.length > 0 && <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs">{totals.map((total) => <div key={total.asset} className="flex items-baseline gap-1.5"><span className="font-semibold tabular-nums">{total.amount}</span><PaymentAssetIdentity asset={total.asset} compact /></div>)}</div>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-neutral-400"><tr>{semantics.kind === 'multi_party' && <th className="px-4 py-3">From</th>}<th className="px-4 py-3">To</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Asset</th></tr></thead>
                  <tbody>
                    {structuredPayments.map((item, index) => <tr key={`${index}:${item.sourceAccount}:${item.destination}:${item.asset}`} className="border-t border-black/5 dark:border-white/10">{semantics.kind === 'multi_party' && <td className="px-4 py-3"><AddressIdentity address={item.sourceAccount} subjectType="account" /></td>}<td className="px-4 py-3"><AddressIdentity address={item.destination} subjectType="account" allowNaming={allowNaming} /></td><td className="px-4 py-3 font-semibold">{item.amount}</td><td className="px-4 py-3"><PaymentAssetIdentity asset={item.asset} compact /></td></tr>)}
                  </tbody>
                </table>
              </div>
              {semantics.kind === 'batch_payment' && repeatedBatchRecipients > 0 && <div className="border-t border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-xs leading-5 text-amber-800 dark:text-amber-200">{repeatedBatchRecipients} recipient{repeatedBatchRecipients === 1 ? '' : 's'} appears more than once. Review each row and asset before continuing.</div>}
              {semantics.kind === 'multi_party' && <div className="border-t border-black/10 px-4 py-3 text-xs leading-5 text-neutral-500 dark:border-white/10 dark:text-neutral-400">Transaction account: <span className="font-mono">{inspection.transactionSourceAccount}</span>. Stellar also requires this account's transaction authorization.</div>}
            </div>
          )}

          {claimablePayment && (
            <div className="mt-5 space-y-3">
              <div className="grid gap-3 rounded-xl bg-black/[0.03] p-4 dark:bg-white/[0.04] md:grid-cols-2">
                <div className="min-w-0"><div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">From</div><AddressIdentity address={inspection.transactionSourceAccount} subjectType="account" labelOverride={sourceDisplay} /></div>
                <div className="min-w-0 border-t border-black/5 pt-3 dark:border-white/10 md:border-l md:border-t-0 md:pl-4 md:pt-0"><div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">Recipient</div><AddressIdentity address={claimablePayment.recipient} subjectType="account" allowNaming={allowNaming} /></div>
              </div>
              <div className="rounded-xl border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">Asset</div>
                <PaymentAssetIdentity asset={claimablePayment.asset} />
              </div>
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4 text-sm">
                <div className="font-semibold">Recovery path included</div>
                <div className="mt-1 leading-6 text-neutral-600 dark:text-neutral-300">The recipient may claim for {durationLabel(claimablePayment.claimWindowSeconds)} after creation. If it is still unclaimed after that window, <AddressIdentity className="mt-2" address={claimablePayment.recoveryAccount} subjectType="account" /> can reclaim it.</div>
              </div>
            </div>
          )}

          {hasMemo && (
            <div className="mt-4 rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">{memoLabel(inspection.memo.type)} · Public on-chain</div>
              <div className={`mt-1.5 break-words text-sm ${inspection.memo.type === 'text' ? '' : 'font-mono text-xs'}`}>{inspection.memo.value}</div>
            </div>
          )}
          {inspection.memo.type === 'hash' && <div className="mt-4"><PrivateCommitmentDisclosure inspection={inspection} commitment={privateCommitment} mode={mode} /></div>}

          {isSigningSetup && accountControlReview && (
            <div className="mt-5 overflow-hidden rounded-xl border border-black/10 dark:border-white/10">
              <div className="border-b border-black/10 bg-black/[0.025] px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400 dark:border-white/10 dark:bg-white/[0.03]">Account control changes</div>
              {accountControlReview.changes.length === 0
                ? <div className="px-4 py-4 text-sm text-neutral-500 dark:text-neutral-400">No account-control change could be derived from this transaction.</div>
                : accountControlReview.changes.map((change) => (
                  <div key={change.key} className="grid gap-2 border-b border-black/5 px-4 py-4 last:border-b-0 dark:border-white/10 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0"><div className={`text-sm font-semibold ${change.warning ? 'text-amber-800 dark:text-amber-200' : ''}`}>{change.label}</div>{change.address && <div className="mt-1"><AddressIdentity address={change.address} subjectType="signer" allowNaming={allowNaming} /></div>}</div>
                    <div className="flex items-center gap-2 text-sm sm:justify-end"><span className="text-neutral-500 dark:text-neutral-400">{change.before}</span><ArrowRight className="h-4 w-4 shrink-0 text-neutral-300 dark:text-neutral-600" /><span className="font-semibold">{change.after}</span></div>
                  </div>
                ))}
            </div>
          )}
          {isSigningSetup && mode !== 'history' && accountControlReview?.currentHighRequirement && (
            <div className="mt-4 rounded-xl bg-black/[0.035] p-4 text-sm dark:bg-white/[0.04]">
              <div className="font-semibold">Current account-control authorization</div>
              <div className="mt-1 text-neutral-600 dark:text-neutral-300">Core account control · {accountControlReview.currentHighRequirement.requirementLabel}. The current policy must authorize this transaction before the new policy can take effect.</div>
            </div>
          )}
          {isSigningSetup && mode !== 'history' && accountControlReview?.risks.map((risk) => (
            <div key={risk.key} className={`mt-4 flex gap-3 rounded-xl border p-4 text-sm ${risk.severity === 'critical' ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300' : 'border-amber-500/25 bg-amber-500/[0.07] text-amber-800 dark:text-amber-200'}`}>
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
              <div><div className="font-semibold">{risk.title}</div><div className="mt-1 leading-6">{risk.detail}</div></div>
            </div>
          ))}
          {isSigningSetup && !accountControlReview && <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-sm text-amber-800 dark:text-amber-200">Technical account-control details are available under Advanced, but current account state was unavailable for a before/after comparison.</div>}
          {(semantics.kind === 'single_operation' || semantics.kind === 'multi_operation') && operations.length > 0 && (
            <div data-operation-details className="mt-5 overflow-hidden rounded-xl border border-neutral-200/80 dark:border-white/[0.08]">
              <div className="border-b border-neutral-200/80 bg-neutral-50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400 dark:border-white/[0.08] dark:bg-white/[0.03]">Ledger operations</div>
              {operations.length <= 3 ? operations.map((operation) => (
                <div key={operation.index} className="border-b border-neutral-200/80 px-4 py-4 last:border-b-0 dark:border-white/[0.08]">
                  {operations.length > 1 && (
                    <div className="mb-3">
                      <div className="text-sm font-semibold">Operation {operation.index + 1} · {operation.title}</div>
                      <div className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">{operation.summary}</div>
                    </div>
                  )}
                  <OperationFieldGrid operation={operation} allowNaming={allowNaming} />
                </div>
              )) : operations.map((operation) => (
                <div key={operation.index} className="border-b border-neutral-200/80 last:border-b-0 dark:border-white/[0.08]">
                  <details className="group">
                    <summary className="cursor-pointer list-none px-4 py-3.5 outline-none hover:bg-black/[0.02] focus-visible:bg-black/[0.03] dark:hover:bg-white/[0.03] dark:focus-visible:bg-white/[0.04] [&::-webkit-details-marker]:hidden">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold">Operation {operation.index + 1} · {operation.title}</div>
                          <div className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">{operation.summary}</div>
                        </div>
                        <span data-operation-toggle-label className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400 group-open:hidden">Details</span>
                        <span data-operation-toggle-label className="hidden shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400 group-open:inline">Hide</span>
                      </div>
                    </summary>
                    <div data-operation-screen-fields className="border-t border-neutral-200/60 px-4 py-4 dark:border-white/[0.06]"><OperationFieldGrid operation={operation} allowNaming={allowNaming} /></div>
                  </details>
                  <div data-operation-print-fields className="hidden border-t border-neutral-200/60 px-4 py-4"><OperationFieldGrid operation={operation} allowNaming={allowNaming} /></div>
                </div>
              ))}
            </div>
          )}

          {mode !== 'history' && <div className="mt-5 border-t border-black/5 pt-4 text-sm opacity-65 dark:border-white/10">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="font-semibold">{inspection.network === 'public' ? 'Mainnet' : 'Testnet'}</span>{!payment && <><span>·</span><AddressIdentity address={inspection.transactionSourceAccount} subjectType="account" /></>}</div>
            <div className="mt-2 flex items-center gap-1.5"><Clock3 className="h-4 w-4" />{validityLabel(inspection)}</div>
          </div>}
        </div>
      </div>
    </section>
  );
}
