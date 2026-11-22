import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CircleAlert, LoaderCircle, ShieldCheck } from 'lucide-react';
import { ActionButton, NetworkBadge, WorkflowProgress } from './MultiSigUi';
import { useStellarWallet } from './StellarWalletContext';
import { useUserIdentity } from './UserIdentityContext';
import { privateSessionAddressHeaders } from '../../../packages/stellar-core/src/privateSessionTransport';
import { isValidStellarTextMemo } from '../../../packages/stellar-core/src/memo';
import type { ReusableTemplateSummary } from '../../../packages/stellar-core/src/reusableTemplate';
import type { CreateSigningRequestResponse } from '../../../packages/stellar-core/src/requestTypes';
import type { StellarNetwork } from '../../../packages/stellar-core/src/types';
import { navigateWorkspace, stellarHref } from './workspaceNavigation';
import { isWalletUserRejected } from './stellar/walletKit';

interface Props { network: StellarNetwork }

function shortAddress(address: string): string {
  return address.length > 22 ? `${address.slice(0, 10)}…${address.slice(-8)}` : address;
}

function assetName(assetKey: string): string {
  return assetKey === 'native' ? 'XLM' : assetKey.split(':')[1] || assetKey;
}

export default function TemplateProposerComposer({ network }: Props) {
  const { unlock, authBusy } = useStellarWallet();
  const { identity } = useUserIdentity();
  const id = new URLSearchParams(window.location.search).get('template') ?? '';
  const verified = Boolean(identity?.userId && identity.network === network);
  const scope = verified ? `${network}:${identity?.userId}:${identity?.method}:${identity?.address ?? ''}:${id}` : '';
  const walletAddress = identity?.address ?? '';
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
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
    setAmount('');
    setMemo('');
    setSaving(false);
    setError('');
    if (!scope) return;
    const controller = new AbortController();
    setLoading(true);
    void fetch(`/api/templates?network=${network}`, {
      headers: walletAddress ? privateSessionAddressHeaders(walletAddress) : {},
      cache: 'no-store', signal: controller.signal,
    }).then(async (response) => {
      const body = await response.json() as { userId?: string; templates?: ReusableTemplateSummary[]; error?: string };
      if (!response.ok || body.userId !== identity?.userId) throw new Error(body.error || 'Cannot load Template.');
      const found = body.templates?.find((item) => item.id === id && item.network === network
        && item.kind === 'payment' && item.ownerAddress !== walletAddress);
      if (!found) throw new Error('This account has no delegated access to that payment Template.');
      if (!controller.signal.aborted) { setLoaded({ scope, template: found }); setError(''); }
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Cannot load Template.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [scope, network, walletAddress, identity?.userId, id]);

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
    const submittedScope = scope;
    try {
      const response = await fetch('/api/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(walletAddress ? privateSessionAddressHeaders(walletAddress) : {}) },
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
      if (scopeRef.current !== submittedScope) return;
      if (!response.ok || !body.request) throw new Error(body.error || 'Unable to create Proposal.');
      navigateWorkspace('/s', {
        hash: body.request.id,
        state: {
          requestPreview: body.request, requestJustCreated: true, requestActivityBound: true,
          requestReviewedByAddress: walletAddress,
          returnTo: stellarHref('/inbox'), returnLabel: 'My requests',
        },
      });
    } catch (cause) {
      if (scopeRef.current === submittedScope) setError(cause instanceof Error ? cause.message : 'Unable to create Proposal.');
    } finally { if (scopeRef.current === submittedScope) setSaving(false); }
  }

  return (
    <main className="mst-workbench-page">
      <div className="mx-auto max-w-3xl">
        <WorkflowProgress current={review ? 'review' : 'prepare'} />
        <a href={stellarHref('/new')} className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-2)]"><ArrowLeft className="h-4 w-4" />New proposal</a>
        <div className="mt-5 flex items-center gap-3"><h1 className="text-3xl font-bold">Request a payment</h1><NetworkBadge network={network} /></div>
        <p className="mt-2 text-sm leading-6 text-[var(--color-ink-2)]">Prepare a payment for Treasury approval.</p>
        {!verified && <section className="mt-6 rounded-xl border border-[var(--color-rule)] p-5">
          <p className="text-sm">Sign in with the MST account that received this Template invitation.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <a href={stellarHref('/identity')} className="mst-action-primary">Use Passkey</a>
            <ActionButton variant="secondary" disabled={authBusy} onClick={() => void confirmWallet()}>
              {authBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {authBusy ? 'Confirming…' : 'Confirm wallet'}
            </ActionButton>
          </div>
        </section>}
        {loading && <p role="status" className="mt-5 text-sm"><LoaderCircle className="inline h-4 w-4 animate-spin" /> Loading authorized Template…</p>}
        {error && <div role="alert" className="mt-5 flex gap-2 rounded-lg border border-[var(--color-danger)] p-4 text-sm text-[var(--color-danger)]"><CircleAlert className="h-4 w-4 shrink-0" />{error}</div>}
        {template && <form onSubmit={(event) => void create(event)} className="mt-6 space-y-5 rounded-[var(--radius-panel)] border border-[var(--color-rule)] bg-[var(--color-paper-2)] p-5 sm:p-7">
          <div><div className="text-sm text-[var(--color-muted)]">Payment Template</div><h2 className="mt-1 text-xl font-semibold">{template.name}</h2></div>
          <div className="border-y border-[var(--color-rule)] py-5">
            <label htmlFor="proposer-amount" className="text-sm font-semibold">Payment amount</label>
            {review ? <div className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{amount} <span className="text-[var(--color-ink-2)]">{assetName(asset)}</span></div>
              : <div className="mt-2 flex items-center gap-3">
                  <input id="proposer-amount" inputMode="decimal" autoComplete="off" required value={amount}
                    onChange={(e) => { setAmount(e.target.value); setError(''); }} placeholder="0.0000000"
                    className="mst-request-control min-w-0 flex-1" />
                  <span className="shrink-0 text-sm font-semibold text-[var(--color-ink-2)]">{assetName(asset)}</span>
                </div>}
          </div>
          <dl className="grid min-w-0 gap-4 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-[var(--color-muted)]">Recipient</dt>
              <dd className={`mt-1 font-mono text-xs leading-6 ${review ? 'break-all' : 'truncate'}`} title={destination}>
                {review ? destination : shortAddress(destination)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[var(--color-muted)]">From Treasury</dt>
              <dd className={`mt-1 font-mono text-xs leading-6 ${review ? 'break-all' : 'truncate'}`} title={template.definition.source}>
                {review ? template.definition.source : shortAddress(template.definition.source)}
              </dd>
            </div>
          </dl>
          {!review && <details className="text-xs text-[var(--color-ink-2)]">
            <summary className="cursor-pointer font-semibold">View full addresses</summary>
            <div className="mt-3 space-y-2 rounded-lg border border-[var(--color-rule)] p-3 font-mono">
              <p className="break-all">Recipient: {destination}</p>
              <p className="break-all">Treasury: {template.definition.source}</p>
            </div>
          </details>}
          <div>
            <label htmlFor="proposer-memo" className="text-sm font-semibold">On-chain memo (optional)</label>
            {review ? <p className="mt-2 text-sm">{memo || 'None'}</p>
              : <input id="proposer-memo" value={memo} onChange={(e) => setMemo(e.target.value)}
                  placeholder="Invoice number" className="mst-request-control mt-2 w-full" />}
            {!validMemo && <p role="alert" className="mt-1 text-sm text-[var(--color-danger)]">Memo must fit in 28 UTF-8 bytes.</p>}
          </div>
          {review && <p className="text-sm leading-6 text-[var(--color-ink-2)]">Treasury signers will authorize this payment after you create the request.</p>}
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
