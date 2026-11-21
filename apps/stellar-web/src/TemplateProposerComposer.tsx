import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CircleAlert, LoaderCircle, ShieldCheck } from 'lucide-react';
import { ActionButton, NetworkBadge, WorkflowProgress } from './MultiSigUi';
import { useStellarWallet } from './StellarWalletContext';
import { privateSessionAddressHeaders } from '../../../packages/stellar-core/src/privateSessionTransport';
import { isValidStellarTextMemo } from '../../../packages/stellar-core/src/memo';
import type { ReusableTemplateSummary } from '../../../packages/stellar-core/src/reusableTemplate';
import type { CreateSigningRequestResponse } from '../../../packages/stellar-core/src/requestTypes';
import type { StellarNetwork } from '../../../packages/stellar-core/src/types';
import { navigateWorkspace, stellarHref } from './workspaceNavigation';
import { isWalletUserRejected } from './stellar/walletKit';

interface Props { network: StellarNetwork }

function assetName(assetKey: string): string {
  return assetKey === 'native' ? 'XLM' : assetKey.split(':')[1] || assetKey;
}

export default function TemplateProposerComposer({ network }: Props) {
  const { sessionAddress, privateUnlocked, unlockedAddress, unlockedNetwork, unlock, authBusy } = useStellarWallet();
  const id = new URLSearchParams(window.location.search).get('template') ?? '';
  const verified = Boolean(privateUnlocked && sessionAddress && unlockedAddress === sessionAddress && unlockedNetwork === network);
  const scope = verified ? `${network}:${sessionAddress}:${id}` : '';
  const [loaded, setLoaded] = useState<{ scope: string; template: ReusableTemplateSummary | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const template = loaded?.scope === scope ? loaded.template : null;
  const validAmount = /^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/.test(amount) && Number(amount) > 0;
  const validMemo = isValidStellarTextMemo(memo);
  const asset = template?.definition.recipients[0]?.assetKey ?? 'native';
  const destination = template?.definition.recipients[0]?.destination ?? '';

  useEffect(() => {
    setLoaded(null);
    setReview(false);
    if (!scope) return;
    const controller = new AbortController();
    setLoading(true);
    void fetch(`/api/templates?network=${network}`, {
      headers: privateSessionAddressHeaders(sessionAddress),
      cache: 'no-store', signal: controller.signal,
    }).then(async (response) => {
      const body = await response.json() as { address?: string; templates?: ReusableTemplateSummary[]; error?: string };
      if (!response.ok || body.address !== sessionAddress) throw new Error(body.error || 'Cannot load Template.');
      const found = body.templates?.find((item) => item.id === id && item.network === network
        && item.kind === 'payment' && item.ownerAddress !== sessionAddress);
      if (!found) throw new Error('This wallet has no delegated access to that payment Template.');
      if (!controller.signal.aborted) { setLoaded({ scope, template: found }); setError(''); }
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Cannot load Template.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [scope, network, sessionAddress, id]);

  async function confirmWallet() {
    setError('');
    try { await unlock(undefined, network); }
    catch (cause) {
      if (!isWalletUserRejected(cause)) setError(cause instanceof Error ? cause.message : 'Wallet confirmation failed.');
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!verified || !template || !validAmount || !validMemo || saving) return;
    if (!review) { setReview(true); return; }
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...privateSessionAddressHeaders(sessionAddress) },
        body: JSON.stringify({
          network,
          templatePayment: {
            template: { id: template.id, version: template.currentVersion },
            amount,
            ...(memo ? { memo } : {}),
          },
        }),
      });
      const body = await response.json() as CreateSigningRequestResponse & { error?: string };
      if (!response.ok || !body.request) throw new Error(body.error || 'Unable to create Proposal.');
      navigateWorkspace('/s', {
        hash: body.request.id,
        state: {
          requestPreview: body.request, requestJustCreated: true, requestActivityBound: true,
          requestReviewedByAddress: sessionAddress,
          returnTo: stellarHref('/inbox'), returnLabel: 'My requests',
        },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create Proposal.');
    } finally { setSaving(false); }
  }

  return (
    <main className="mst-workbench-page">
      <div className="mx-auto max-w-3xl">
        <WorkflowProgress current={review ? 'review' : 'prepare'} />
        <a href={stellarHref('/new')} className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-2)]"><ArrowLeft className="h-4 w-4" />New proposal</a>
        <div className="mt-5 flex items-center gap-3"><h1 className="text-3xl font-bold">Request a payment</h1><NetworkBadge network={network} /></div>
        <p className="mt-2 text-sm leading-6 text-[var(--color-ink-2)]">You can prepare this payment with your wallet. Treasury signers still control approval and submission.</p>
        {!verified && <section className="mt-6 rounded-xl border border-[var(--color-rule)] p-5">
          <p className="text-sm">Confirm the wallet that was granted permission to use this Template.</p>
          <ActionButton className="mt-3" disabled={authBusy} onClick={() => void confirmWallet()}>
            {authBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {authBusy ? 'Confirming…' : 'Confirm wallet'}
          </ActionButton>
        </section>}
        {loading && <p role="status" className="mt-5 text-sm"><LoaderCircle className="inline h-4 w-4 animate-spin" /> Loading authorized Template…</p>}
        {error && <div role="alert" className="mt-5 flex gap-2 rounded-lg border border-[var(--color-danger)] p-4 text-sm text-[var(--color-danger)]"><CircleAlert className="h-4 w-4 shrink-0" />{error}</div>}
        {template && <form onSubmit={(event) => void create(event)} className="mt-6 space-y-5 rounded-[var(--radius-panel)] border border-[var(--color-rule)] bg-[var(--color-paper-2)] p-5 sm:p-7">
          <div><div className="text-sm text-[var(--color-muted)]">Authorized Template</div><h2 className="mt-1 text-xl font-semibold">{template.name}</h2></div>
          <dl className="space-y-4 border-y border-[var(--color-rule)] py-4 text-sm">
            <div><dt className="text-[var(--color-muted)]">From Treasury</dt><dd className="mt-1 break-all font-mono">{template.definition.source}</dd></div>
            <div><dt className="text-[var(--color-muted)]">Recipient</dt><dd className="mt-1 break-all font-mono">{destination}</dd></div>
            <div><dt className="text-[var(--color-muted)]">Asset</dt><dd className="mt-1 font-semibold">{assetName(asset)}</dd></div>
          </dl>
          <div>
            <label htmlFor="proposer-amount" className="text-sm font-semibold">Payment amount</label>
            {review ? <div className="mt-2 text-2xl font-semibold">{amount} {assetName(asset)}</div>
              : <input id="proposer-amount" inputMode="decimal" autoComplete="off" required value={amount}
                  onChange={(e) => { setAmount(e.target.value); setError(''); }} placeholder="0.0000000"
                  className="mst-request-control mt-2 w-full" />}
          </div>
          <div>
            <label htmlFor="proposer-memo" className="text-sm font-semibold">On-chain memo (optional)</label>
            {review ? <p className="mt-2 text-sm">{memo || 'None'}</p>
              : <input id="proposer-memo" value={memo} onChange={(e) => setMemo(e.target.value)}
                  placeholder="Invoice number" className="mst-request-control mt-2 w-full" />}
            {!validMemo && <p role="alert" className="mt-1 text-sm text-[var(--color-danger)]">Memo must fit in 28 UTF-8 bytes.</p>}
          </div>
          {review && <p className="text-sm leading-6 text-[var(--color-ink-2)]">This creates an exact Stellar transaction for the authorized source, recipient and asset. No payment is signed or submitted until Treasury signers review and authorize it.</p>}
          <div className="flex justify-end gap-3 border-t border-[var(--color-rule)] pt-4">
            {review && <ActionButton variant="secondary" type="button" onClick={() => setReview(false)}>Edit</ActionButton>}
            <ActionButton type="submit" disabled={!validAmount || !validMemo || saving}>
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {saving ? 'Creating…' : review ? 'Create signing request' : 'Review request'}
            </ActionButton>
          </div>
        </form>}
      </div>
    </main>
  );
}
