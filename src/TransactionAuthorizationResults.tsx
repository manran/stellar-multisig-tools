import { CheckCircle2, CircleAlert, ShieldCheck } from 'lucide-react';
import { useAddressBook } from './AddressBookContext';
import { humanAuthorizationRequirement } from './stellar/authorizationPresentation';
import type { TransactionAuthorizationStatus } from './stellar/transactionAuthorization';
import type { SourceAnalysis } from './stellar/transactionReviewAnalysis';
import type { TransactionXdrInspection } from './stellar/transactionXdr';

interface Props {
  inspection: TransactionXdrInspection;
  authorization: TransactionAuthorizationStatus | null;
  sourceAnalyses: SourceAnalysis[];
}

function EvidenceIdentity({ address, kind }: { address: string; kind: 'account' | 'signer' }) {
  const { labelFor } = useAddressBook();
  const label = labelFor(address, kind);
  return (
    <div className="min-w-0">
      {label && <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">{label}</div>}
      <div className={`${label ? 'mt-0.5' : ''} break-all font-mono text-[11px] leading-5 text-neutral-500 dark:text-neutral-400`}>{address}</div>
    </div>
  );
}

export default function TransactionAuthorizationResults({ inspection, authorization, sourceAnalyses }: Props) {
  const hasSoroban = inspection.operations.some((operation) => operation.soroban);
  const unusedInner = authorization?.coreUnusedInnerSignatureIndexes;
  const unusedOuter = authorization?.coreUnusedOuterSignatureIndexes;
  const hasBadAuthExtra = authorization?.innerOutcome === 'bad_auth_extra' || authorization?.outerOutcome === 'bad_auth_extra';

  return (
    <>
      <section>
        <h2 className="mb-4 text-xl font-bold">{hasSoroban ? 'Transaction envelope authorization' : 'Authorization required'}</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {inspection.sourceRequirements.map((requirement) => {
            const loaded = sourceAnalyses.find((item) => item.accountId === requirement.accountId);
            const policy = loaded?.analysis?.thresholds[requirement.threshold];
            const auth = authorization?.sources.find((item) => item.accountId === requirement.accountId && item.scope === requirement.scope);
            return (
              <div key={`${requirement.scope}:${requirement.accountId}`} className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${requirement.scope === 'outer' ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300' : 'bg-sky-500/10 text-sky-700 dark:text-sky-300'}`}>{requirement.scope}</span>
                      <EvidenceIdentity address={requirement.accountId} kind="account" />
                    </div>
                    <div className="mt-2 text-xl font-bold capitalize">{requirement.threshold} threshold</div>
                  </div>
                  {policy && <div className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${policy.reachable ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/10 text-red-600 dark:text-red-300'}`}>{humanAuthorizationRequirement(policy)}</div>}
                </div>

                <div className="mt-4 space-y-1 text-xs opacity-55">
                  {requirement.reasons.map((reason) => <div key={reason}>• {reason}</div>)}
                </div>

                {auth?.requiredWeight !== undefined && auth.matchedWeight !== undefined && (
                  <div className="mt-5 rounded-xl bg-black/[0.035] p-4 dark:bg-white/[0.04]">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <div className="text-xs opacity-45">Required approval power</div>
                        <div className="mt-1 text-2xl font-bold">{auth.matchedWeight} / {auth.requiredWeight}</div>
                      </div>
                      <div className={`text-sm font-semibold ${auth.satisfied ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        {auth.satisfied ? 'All checks met' : `Needs ${auth.missingWeight} more approval power`}
                      </div>
                    </div>
                    {auth.matchedSigners.length > 0 && (
                      <div className="mt-3 space-y-2 border-t border-black/5 pt-3 text-xs dark:border-white/10">
                        {auth.matchedSigners.map((signer, index) => (
                          <div key={`${signer.signerKey}:${index}`} className="grid gap-1 rounded-lg border border-black/5 bg-white/40 px-3 py-2 dark:border-white/10 dark:bg-black/10 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3">
                            <EvidenceIdentity address={signer.signerKey} kind="signer" />
                            <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">+{signer.weight} power{signer.automatic ? ' · automatic' : ''}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {auth.checks.length > 1 && (
                      <div className="mt-3 space-y-1 border-t border-black/5 pt-3 text-[11px] opacity-55 dark:border-white/10">
                        {auth.checks.map((check) => (
                          <div key={check.reason} className="flex justify-between gap-3">
                            <span>{check.reason}</span>
                            <span className="shrink-0">{check.satisfied ? '✓' : check.satisfied === false ? 'Missing' : 'Unknown'}{check.requiredWeight !== undefined ? ` · ${check.matchedWeight ?? 0}/${check.requiredWeight}` : ''}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {auth?.error && <div className="mt-4 text-xs text-amber-600 dark:text-amber-400">Live account policy unavailable: {auth.error}</div>}
              </div>
            );
          })}
        </div>
      </section>

      {inspection.extraSigners.length > 0 && (
        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
          <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" /> Extra signer preconditions</div>
          <p className="mt-2 text-sm opacity-65">Every extra signer is mandatory in addition to account threshold authorization.</p>
          <div className="mt-4 space-y-2">
            {authorization?.extraSigners.map((signer) => (
              <div key={signer.signerKey} className="grid gap-2 rounded-xl bg-white/50 p-3 text-xs dark:bg-black/10 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-3">
                {signer.satisfied ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <CircleAlert className="h-4 w-4 shrink-0 text-amber-600" />}
                <EvidenceIdentity address={signer.signerKey} kind="signer" />
                <div className="shrink-0 font-semibold">{signer.satisfied ? signer.automatic ? 'Automatic' : 'Present' : 'Missing'}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {authorization && hasBadAuthExtra && (
        <section className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5">
          <div className="flex items-center gap-2 font-semibold"><CircleAlert className="h-4 w-4" /> Signatures left unused by Stellar Core</div>
          <p className="mt-2 text-sm opacity-65">Core stops each authorization check as soon as enough weight is reached. If all required checks pass and decorated signatures remain unused, the transaction fails with txBAD_AUTH_EXTRA.</p>
          <div className="mt-3 text-sm">
            {(unusedInner?.length ?? 0) > 0 && <div>Inner unused: {unusedInner!.map((index) => `#${index + 1}`).join(', ')}</div>}
            {(unusedOuter?.length ?? 0) > 0 && <div>Outer unused: {unusedOuter!.map((index) => `#${index + 1}`).join(', ')}</div>}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-black/10 bg-black/[0.025] p-5 text-sm dark:border-white/10 dark:bg-white/[0.03]">
        <div className="font-semibold">Read-only Core-order authorization analysis</div>
        <p className="mt-2 opacity-55">The simulator follows Stellar Core's signature type order, threshold short-circuiting, transaction-source and extra-signer checks, operation checks, and fee-bump inner/outer separation. {hasSoroban ? 'For Soroban transactions this covers the transaction envelope only; contract authorization entries are a separate domain shown above.' : ''} It does not sign, submit, or claim that non-authorization transaction validity checks will pass.</p>
      </section>
    </>
  );
}
