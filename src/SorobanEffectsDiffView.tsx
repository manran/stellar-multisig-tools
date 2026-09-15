import { StatusBadge } from './MultiSigUi';
import type { SorobanEffectsDiff } from './stellar/sorobanEffects';

function percentLabel(basisPoints: number | null) {
  if (basisPoints === null) return 'unbounded';
  return `${(basisPoints / 100).toFixed(basisPoints < 100 ? 2 : 1)}%`;
}

function numericChangeClass(basisPoints: number | null) {
  if (basisPoints === null || basisPoints > 500) return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300';
  if (basisPoints > 200) return 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300';
  if (basisPoints > 50) return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
}

export default function SorobanEffectsDiffView({ diff }: { diff: SorobanEffectsDiff }) {
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge tone={diff.severity === 'critical' ? 'danger' : diff.severity === 'high' || diff.severity === 'medium' ? 'warning' : 'success'}>
        {diff.kind === 'structural' ? 'Structural change' : diff.kind === 'numeric' ? 'Numeric drift' : 'No change'}
      </StatusBadge>
      {diff.kind === 'numeric' && <span className="text-xs text-neutral-500">Maximum difference {percentLabel(diff.maxChangeBasisPoints)}</span>}
    </div>    {diff.kind === 'structural' && (
      <p className="text-sm leading-6 text-red-700 dark:text-red-300">
        The set or structure of effects changed: contract, recipient, topic, or state shape may differ from the effects that were approved.
      </p>
    )}
    {diff.numericChanges.map((change) => (
      <div key={change.key} className={`rounded-xl border p-3 ${numericChangeClass(change.basisPoints)}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-semibold">{change.label}</span>
          <span className="font-mono text-xs">{percentLabel(change.basisPoints)}</span>
        </div>
        <div className="mt-1 font-mono text-xs opacity-80">
          expected {change.expected} → actual {change.actual} · Δ {change.difference}
        </div>
      </div>
    ))}
  </div>;
}
