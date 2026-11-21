import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, LoaderCircle } from 'lucide-react';
import type { SaintSecurityEvent, SaintSecurityTimeline } from '../../stellar-api/stellar/server/saintAccountSecurity';

function eventLabel(event: SaintSecurityEvent): string {
  if (event.kind === 'lifecycle') return event.field === 'created' ? 'Account created' : 'Account merged';
  if (event.field === 'signer_weight') {
    if (event.before === null || event.before === 0) return 'Signer added';
    if (event.after === null || event.after === 0) return 'Signer removed';
    return 'Signer weight changed';
  }
  if (event.field === 'master_weight') return 'Account key weight changed';
  const labels: Record<string, string> = {
    low_threshold: 'Low threshold changed',
    medium_threshold: 'Transaction threshold changed',
    high_threshold: 'Account control threshold changed',
  };
  return labels[event.field] ?? 'Signing policy changed';
}

function eventDetail(event: SaintSecurityEvent): string {
  const signer = event.signer ? event.signer.slice(0, 8) + '…' + event.signer.slice(-6) + ' · ' : '';
  if (event.kind === 'lifecycle') return '';
  return signer + (event.before === null ? 'new' : event.before) + ' → ' + (event.after === null ? 'removed' : event.after);
}

export default function SaintSecurityTimeline({
  address,
  createdAt,
}: {
  address: string;
  createdAt?: string;
}) {
  const [history, setHistory] = useState<SaintSecurityTimeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const current = useRef<AbortController | null>(null);
  const automatic = Boolean(createdAt);

  async function load() {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setLoading(true);
    setUnavailable(false);
    try {
      const response = await fetch('/api/saint-account-security?address=' + encodeURIComponent(address), {
        cache: 'no-store',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6_000)]),
      });
      if (!response.ok) throw new Error('Optional history unavailable');
      const value = await response.json() as SaintSecurityTimeline;
      if (value.source !== 'saint' || value.network !== 'testnet' || value.address !== address || !Array.isArray(value.events)) {
        throw new Error('Unexpected SAINT history');
      }
      if (!controller.signal.aborted) setHistory(value);
    } catch {
      if (!controller.signal.aborted) {
        setHistory(null);
        setUnavailable(true);
      }
    } finally {
      if (current.current === controller) {
        setLoading(false);
        current.current = null;
      }
    }
  }

  useEffect(() => {
    setHistory(null);
    setUnavailable(false);
    if (automatic) void load();
    return () => current.current?.abort();
  }, [address, automatic, createdAt]);

  const after = history && createdAt && Number.isFinite(Date.parse(createdAt))
    ? history.events.filter((event) => event.kind === 'control' && Date.parse(event.occurredAt) > Date.parse(createdAt))
    : [];

  // Proposal: advisory only. SAINT never participates in review, sign or submit callbacks.
  if (automatic) {
    if (after.length > 0) {
      return (
        <aside aria-label="SAINT signing-policy history" className="rounded-xl border border-[var(--color-warning)] px-4 py-3 text-sm">
          <p className="font-semibold text-[var(--color-warning)]">Signing policy changed after this Proposal was created</p>
          <p className="mt-1 text-[var(--color-ink-2)]">SAINT observed {after.length} change{after.length === 1 ? '' : 's'} within its historical window. Check the current Treasury policy before signing.</p>
          <a className="mt-2 inline-flex items-center gap-1 text-[var(--color-action)] underline" href={'https://stellar.expert/explorer/testnet/tx/' + after[0].txHash} target="_blank" rel="noreferrer">View latest change <ArrowUpRight className="h-3.5 w-3.5" /></a>
          {!history?.complete && <p className="mt-1 text-xs text-[var(--color-muted)]">Historical coverage is incomplete.</p>}
        </aside>
      );
    }
    if (unavailable) return <p className="text-xs text-[var(--color-muted)]">Optional security history unavailable. Proposal signing is unaffected.</p>;
    if (history && !history.complete) return <p className="text-xs text-[var(--color-muted)]">SAINT history is incomplete. Current authorization is checked separately.</p>;
    return null;
  }

  return (
    <section aria-label="Treasury security history" className="mt-7 rounded-xl border border-[var(--color-rule)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Security history</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">Observed signer and threshold changes from SAINT. Current signing rights remain verified by Stellar.</p>
        </div>
        <button type="button" className="mst-action-secondary" onClick={() => void load()} disabled={loading}>
          {loading && <LoaderCircle className="h-4 w-4 animate-spin" />}
          {history ? 'Refresh history' : 'View history'}
        </button>
      </div>
      {unavailable && <p role="status" className="mt-3 text-sm text-[var(--color-muted)]">Security history is temporarily unavailable. Treasury management continues normally.</p>}
      {history && (
        <div className="mt-4">
          <p className="text-xs text-[var(--color-muted)]">SAINT Ledger {history.window.from}–{history.window.through}. This is a bounded history window, not a complete account audit.</p>
          {!history.complete && <p className="mt-2 text-sm text-[var(--color-warning)]">History is incomplete. Missing events do not prove the policy was unchanged.</p>}
          {history.events.length === 0 && <p className="mt-3 text-sm text-[var(--color-ink-2)]">{history.complete ? 'No signer or threshold changes observed in this window.' : 'No complete change history is available for this window.'}</p>}
          <div className="mt-3 divide-y divide-[var(--color-rule)]">
            {history.events.slice(0, 12).map((event) => (
              <div className="flex flex-wrap items-start justify-between gap-3 py-3" key={event.id}>
                <div>
                  <div className="font-semibold text-sm">{eventLabel(event)}</div>
                  <div className="mt-1 text-xs text-[var(--color-muted)]">{eventDetail(event)} · Ledger {event.ledger} · {new Date(event.occurredAt).toLocaleString()}</div>
                </div>
                <a href={'https://stellar.expert/explorer/testnet/tx/' + event.txHash} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--color-action)]">Transaction <ArrowUpRight className="h-3.5 w-3.5" /></a>
              </div>
            ))}
          </div>
          {history.events.length > 12 && <p className="mt-2 text-xs text-[var(--color-muted)]">Showing the most recent 12 of {history.events.length} events.</p>}
        </div>
      )}
    </section>
  );
}
