import { CheckCircle2, ChevronDown, CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { horizonTransactionUrl } from '../../../packages/stellar-core/src/horizon';
import type { SorobanIntentEvidenceEvent } from '../../../packages/stellar-core/src/sorobanIntentApiTypes';
import type { SorobanIntentWorkActivityItem } from '../../../packages/stellar-core/src/workActivityTypes';
import { stellarHref } from './workspaceNavigation';

function eventCopy(event: SorobanIntentEvidenceEvent, currentAddress: string) {
  switch (event.type) {
    case 'intent_created': return { title: 'Contract Intent created', tone: 'neutral' as const };
    case 'authorization_added': return {
      title: event.actorAddress === currentAddress ? 'You authorized' : 'Contract authorization added',
      tone: 'positive' as const,
    };
    case 'authorization_plan_revised': return { title: 'Authorization refreshed', tone: 'neutral' as const };
    case 'execution_prepared': return { title: 'Execution prepared', tone: 'neutral' as const };
    case 'execution_confirmed': return {
      title: event.ledger ? `Confirmed on Stellar · Ledger ${event.ledger.toLocaleString()}` : 'Confirmed on Stellar',
      tone: 'positive' as const,
    };
    case 'execution_failed': return {
      title: event.ledger ? `Execution failed · Ledger ${event.ledger.toLocaleString()}` : 'Execution failed on Stellar',
      tone: 'danger' as const,
    };
  }
}

function dotClass(tone: 'neutral' | 'positive' | 'danger') {
  if (tone === 'positive') return 'bg-emerald-500';
  if (tone === 'danger') return 'bg-red-500';
  return 'bg-neutral-400';
}

export default function SorobanIntentActivityCard({
  item,
  currentAddress,
  defaultOpen,
}: {
  item: SorobanIntentWorkActivityItem;
  currentAddress: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const result = [...item.evidence].reverse().find((event) =>
    (event.type === 'execution_confirmed' || event.type === 'execution_failed') && event.transactionHash);
  const intentHref = `${stellarHref('/a')}#${item.intentId}`;

  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="group mst-activity-item">
      <summary className="mst-activity-summary">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-neutral-500 dark:text-neutral-400"><span>Contract authorization</span>{item.network === 'testnet' && <><span>·</span><span className="text-sky-700 dark:text-sky-300">Testnet</span></>}</div>
            <h2 className="mt-2 text-xl font-bold tracking-tight">Soroban Intent</h2>
            <p className="mt-1 break-all font-mono text-xs text-neutral-400">{item.intentDigest}</p>
          </div>
          <div className="flex shrink-0 items-start gap-3">
            <div className="text-right text-xs text-neutral-400"><div>{new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div><div className="mt-1 font-mono">{item.intentId.match(/.{1,4}/g)?.join('-') ?? item.intentId}</div></div>
            <ChevronDown className={`mt-0.5 h-4 w-4 text-neutral-400 transition ${open ? 'rotate-180' : ''}`} />
          </div>
        </div>
      </summary>
      <div className="mst-activity-detail">
        <div className="mst-activity-timeline">
          {item.evidence.map((event, index) => {
            const copy = eventCopy(event, currentAddress);
            const isLast = index === item.evidence.length - 1;
            return <div key={event.eventId} className="relative grid grid-cols-[18px_minmax(0,1fr)] gap-3 pb-5 last:pb-0">
              {!isLast && <div className="absolute left-[4px] top-3 h-[calc(100%-0.25rem)] w-px bg-black/10 dark:bg-white/10" />}
              <div className={`relative z-10 mt-1.5 h-2.5 w-2.5 rounded-full ${dotClass(copy.tone)}`} />
              <div className="min-w-0"><div className="flex flex-wrap items-baseline justify-between gap-2"><div className="text-sm font-semibold">{copy.title}</div><time className="text-xs text-neutral-400">{new Date(event.occurredAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></div>{event.transactionHash && <div className="mt-1 break-all font-mono text-[11px] text-neutral-400">{event.transactionHash}</div>}</div>
            </div>;
          })}
        </div>
        <div className="mst-activity-actions">
          <div>{result?.type === 'execution_confirmed' && <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />Confirmed</div>}{result?.type === 'execution_failed' && <div className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300"><CircleAlert className="h-4 w-4" />Execution failed</div>}</div>
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-xs font-semibold"><a href={intentHref} className="underline decoration-violet-600/30 text-violet-700 underline-offset-4 dark:text-violet-300">Open Intent</a>{result?.transactionHash && <a href={horizonTransactionUrl(result.transactionHash, item.network)} target="_blank" rel="noreferrer" className="underline decoration-black/20 underline-offset-4 dark:decoration-white/20">View network record</a>}</div>
        </div>
      </div>
    </details>
  );
}
