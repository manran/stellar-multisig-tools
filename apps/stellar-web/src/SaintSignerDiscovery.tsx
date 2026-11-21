import { useEffect, useRef, useState } from 'react';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { privateSessionAddressHeaders } from '../../../packages/stellar-core/src/privateSessionTransport';
import { treasuryOverviewHref } from './treasuryNavigation';

interface SaintSignerDiscoveryResponse {
  source: 'saint';
  signer: string;
  network: 'testnet';
  status: 'available' | 'partial' | 'unavailable';
  publication: { through: number };
  scopeComplete: boolean;
  globalScopeComplete: boolean;
  indexCaughtUp: boolean;
  hasMore: boolean;
  resources: Array<{ address: string; relation: string; weight?: number; observedAtLedger?: number }>;
}

function abbreviated(address: string): string {
  return address.slice(0, 12) + '...' + address.slice(-8);
}

export default function SaintSignerDiscovery({
  signer,
  knownAccounts,
}: {
  signer: string;
  knownAccounts: readonly string[];
}) {
  const [result, setResult] = useState<SaintSignerDiscoveryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  async function discover() {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/saint-signer-resources', {
        signal: controller.signal,
        headers: { Accept: 'application/json', ...privateSessionAddressHeaders(signer) },
      });
      const body = await response.json() as SaintSignerDiscoveryResponse & { error?: string };
      if (!response.ok) throw new Error(body.error || 'SAINT lookup is unavailable.');
      if (body.source !== 'saint' || body.signer !== signer || body.network !== 'testnet'
        || !Array.isArray(body.resources)) {
        throw new Error('SAINT returned an unexpected discovery result.');
      }
      if (!controller.signal.aborted) setResult(body);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'SAINT lookup failed.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  const additional = result?.resources.filter((resource) =>
    resource.address !== signer && !knownAccounts.includes(resource.address)) ?? [];
  const incomplete = result && (result.status !== 'available' || !result.scopeComplete
    || !result.globalScopeComplete || !result.indexCaughtUp || result.hasMore);

  return (
    <section aria-label="SAINT signer relationships" className="mt-6 rounded-xl border border-[var(--color-rule)] bg-[var(--color-paper-2)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">Explore signer relationships</h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-neutral-500 dark:text-neutral-400">
            SAINT checks current public-chain relationships beyond the standard account list. This does not grant signing access.
          </p>
        </div>
        <button type="button" className="mst-action-secondary" disabled={loading} onClick={() => void discover()}>
          {loading && <LoaderCircle className="h-4 w-4 animate-spin" />}
          {result ? 'Refresh SAINT' : 'Check with SAINT'}
        </button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {result && (
        <div className="mt-4 space-y-3 text-sm">
          <p className="text-neutral-600 dark:text-neutral-300">
            {result.resources.length} current relationship(s) returned. {additional.length} not in the standard account list.
            {' '}SAINT publication through Ledger {result.publication.through}.
          </p>
          {incomplete && <p className="text-amber-700 dark:text-amber-300">Discovery is incomplete. Missing accounts or contracts must not be treated as proof of no signing relationship.</p>}
          {additional.map((resource) => (
            <div key={resource.address} className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-rule)] pt-3">
              <div>
                <div className="font-mono text-xs" title={resource.address}>{abbreviated(resource.address)}</div>
                <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  {resource.address.startsWith('C') ? 'Contract' : 'Account'} · {resource.relation.replace(/_/g, ' ')}
                  {resource.weight !== undefined ? ' · Weight ' + resource.weight : ''}
                  {resource.observedAtLedger ? ' · RPC Ledger ' + resource.observedAtLedger : ''}
                </div>
              </div>
              {resource.address.startsWith('G') && (
                <a href={treasuryOverviewHref(resource.address, 'testnet')} className="inline-flex items-center gap-1 font-semibold">
                  Check account <ArrowRight className="h-4 w-4" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
