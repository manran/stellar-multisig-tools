import { useEffect, useState } from 'react';
import { ArrowRight, Clock3, LoaderCircle } from 'lucide-react';
import { NetworkBadge, RequestStatusBadge } from './MultiSigUi';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useUserIdentity } from './UserIdentityContext';
import { describeInboxRequest } from './stellar/inboxRequestPresentation';
import { stellarHref } from './workspaceNavigation';
import type { SigningRequestSnapshot } from '../../../packages/stellar-core/src/requestTypes';

interface UserHistoryRecord extends Pick<SigningRequestSnapshot,
  'id' | 'network' | 'createdAt' | 'status' | 'mergedXdr' | 'transactionHash' | 'template'> {
  submission: SigningRequestSnapshot['submission'] | null;
}

export default function UserActivityApp() {
  const { identity } = useUserIdentity();
  const [data, setData] = useState<{ scope: string; requests: UserHistoryRecord[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const scope = identity ? `${identity.network}:${identity.userId}` : '';
  const requests = data?.scope === scope ? data.requests : [];

  useEffect(() => {
    if (!identity || identity.method !== 'passkey') return;
    const controller = new AbortController();
    setLoading(true); setError('');
    void fetch(`/api/identity?network=${identity.network}&view=activity`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { userId?: string; requests?: UserHistoryRecord[]; error?: string };
        if (!response.ok || body.userId !== identity.userId || !Array.isArray(body.requests)) {
          throw new Error(body.error || 'Unable to read your payment history.');
        }
        if (!controller.signal.aborted) setData({ scope, requests: body.requests });
      }).catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load history.');
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [identity, scope]);

  return <StellarWorkspaceShell active="activity">
    <main className="mst-workbench-page"><div className="mx-auto max-w-5xl">
      <div className="mt-4 flex items-center gap-3"><h1 className="text-3xl font-bold">My payment history</h1>
        {identity && <NetworkBadge network={identity.network} />}</div>
      <p className="mt-2 text-sm text-[var(--color-ink-2)]">Payments you prepared with your MST account. Treasury signing rights remain separate.</p>
      {loading && <p role="status" className="mt-6 text-sm"><LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" />Loading history…</p>}
      {error && <p role="alert" className="mt-5 text-sm text-[var(--color-danger)]">{error}</p>}
      {!loading && !error && requests.length === 0 && <section className="mt-10 text-center"><Clock3 className="mx-auto h-7 w-7 text-[var(--color-muted)]" />
        <h2 className="mt-4 text-xl font-semibold">No requests yet</h2><a href={stellarHref('/new')} className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-action)]">Start a payment <ArrowRight className="ml-2 h-4 w-4" /></a>
      </section>}
      <div className="mst-work-list mt-6">
        {requests.map((item) => {
          const description = describeInboxRequest({ ...item, baseXdr: item.mergedXdr,
            expiresAt: item.createdAt, contributionCount: 0 } as SigningRequestSnapshot);
          return <a key={item.id} href={stellarHref('/s') + '#' + item.id} className="mst-work-row">
            <div className="min-w-0"><h2 className="mst-work-row__title">{description.title}</h2>
              <p className="mst-work-row__copy">{description.summary}</p>
              <p className="mt-1 text-xs text-[var(--color-muted)]">{new Date(item.createdAt).toLocaleString()}</p>
              {item.submission && <p className="mt-1 text-xs text-[var(--color-success)]">Confirmed in ledger {item.submission.ledger}</p>}
            </div>
            <span className="shrink-0"><RequestStatusBadge status={item.status} /> <ArrowRight className="ml-2 inline h-4 w-4" /></span>
          </a>;
        })}
      </div>
    </div></main>
  </StellarWorkspaceShell>;
}
