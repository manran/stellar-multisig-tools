import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  History,
  RefreshCw,
  Send,
  ShieldCheck,
  UserRound,
  UsersRound,
  Vault,
} from 'lucide-react';
import { NetworkBadge, StatusBadge, WorkflowProgress } from './MultiSigUi';
import StellarFooter from './StellarFooter';
import StellarHeader from './StellarHeader';
import {
  DEFAULT_DEMO_PAYMENT,
  DEMO_DESTINATION_ADDRESS,
  DEMO_NETWORK,
  DEMO_SIGNERS,
  buildDemoPaymentXdr,
  createDemoProposalFromXdr,
  demoProposalStatus,
  signDemoProposal,
  submitDemoProposal,
  validateDemoPayment,
} from './stellar/demoRuntime';
import type { DemoPaymentDraft, DemoProposal, DemoSignerName } from './stellar/demoRuntime';
import { projectTransactionSemantics } from './stellar/transactionSemantics';
import { inspectTransactionXdr } from '../packages/stellar-core/src/transactionXdr';
import { stellarHref } from './workspaceNavigation';

type DemoStage = 'prepare' | 'review' | 'proposal' | 'details' | 'activity';

function shortAddress(address: string) {
  return `${address.slice(0, 10)}…${address.slice(-8)}`;
}

function DemoBanner() {
  return (
    <div className="border-b border-amber-500/20 bg-amber-500/[0.07]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm sm:px-6 lg:px-8">
        <div className="flex items-start gap-2.5">
          <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
          <div><span className="font-bold">Interactive demo.</span> No wallet is connected, no private key is used, and nothing here is submitted to Stellar.</div>
        </div>
        <a href={stellarHref('')} className="shrink-0 font-semibold text-amber-800 underline decoration-amber-700/30 underline-offset-4 dark:text-amber-200">Exit demo</a>
      </div>
    </div>
  );
}

function DemoTransactionSummary({ xdr, history = false, frozen = false }: { xdr: string; history?: boolean; frozen?: boolean }) {
  const inspection = useMemo(() => inspectTransactionXdr(xdr, DEMO_NETWORK), [xdr]);
  const semantics = useMemo(() => projectTransactionSemantics(inspection), [inspection]);
  const payment = semantics.kind === 'payment' ? semantics.payment : null;

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-emerald-500/10 p-2.5 text-emerald-700 dark:text-emerald-300"><Send className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">{history ? 'Transaction' : frozen ? 'Frozen transaction' : 'What you are reviewing'}</div>
          <h2 className="mt-2 text-2xl font-bold">{payment ? `${history ? '' : 'Send '}${payment.amount} ${payment.assetCode}${history ? ' transfer' : ''}` : 'Demo transaction'}</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">{history ? 'Source and destination encoded in the frozen Demo transaction.' : frozen ? 'This exact XDR is frozen for the Demo Proposal.' : 'Confirm the source, recipient and on-chain memo before this Demo proposal is frozen.'}</p>

          <div className="mt-5 grid gap-3 rounded-xl bg-black/[0.03] p-4 dark:bg-white/[0.04] md:grid-cols-2">
            <div className="min-w-0">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">From</div>
              <div className="text-sm font-semibold">Acme Demo Treasury</div>
              <div className="mt-0.5 break-all font-mono text-xs text-neutral-500 dark:text-neutral-400">{inspection.transactionSourceAccount}</div>
            </div>
            <div className="min-w-0 border-t border-black/5 pt-3 dark:border-white/10 md:border-l md:border-t-0 md:pl-4 md:pt-0">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">To</div>
              <div className="text-sm font-semibold">Vendor settlement</div>
              <div className="mt-0.5 break-all font-mono text-xs text-neutral-500 dark:text-neutral-400">{payment?.destination ?? DEMO_DESTINATION_ADDRESS}</div>
            </div>
          </div>

          {inspection.memo.type !== 'none' && inspection.memo.value != null && (
            <div className="mt-4 rounded-xl border border-black/10 bg-black/[0.02] px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">Stellar memo · Public on-chain</div>
              <div className="mt-1.5 break-words text-sm">{inspection.memo.value}</div>
            </div>
          )}

          <div className="mt-5 border-t border-black/5 pt-4 text-sm text-neutral-500 dark:border-white/10 dark:text-neutral-400">
            <span className="inline-flex items-center gap-2"><NetworkBadge network={DEMO_NETWORK} /><span>Demo XDR · no wallet signature</span></span>
          </div>
        </div>
      </div>
    </section>
  );
}

function TreasuryPolicy() {
  return (
    <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5">
      <div className="flex items-center gap-2"><Vault className="h-5 w-5 text-emerald-700 dark:text-emerald-300" /><h2 className="font-bold">Acme Demo Treasury</h2></div>
      <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">A stable 2-of-3 Testnet teaching policy. Any two Demo personas can sign a payment.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {DEMO_SIGNERS.map((signer) => <div key={signer.name} className="rounded-xl bg-black/[0.03] px-3 py-3 dark:bg-white/[0.04]"><div className="text-sm font-semibold">{signer.name}</div><div className="mt-1 font-mono text-[11px] text-neutral-400">{shortAddress(signer.address)}</div><div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">Weight 1</div></div>)}
      </div>
      <div className="mt-4 text-xs font-semibold text-neutral-500 dark:text-neutral-400">Medium 2 · High 2 · Balance 1,000 XLM</div>
    </section>
  );
}

function PrepareStage({ draft, setDraft, onReview }: { draft: DemoPaymentDraft; setDraft: (draft: DemoPaymentDraft) => void; onReview: () => void }) {
  const error = validateDemoPayment(draft);
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5 sm:p-6">
        <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">New payment</div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Prepare a treasury payment.</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">This creates a real Stellar Testnet XDR in your browser, but the Demo will never sign or submit it.</p>

        <div className="mt-6 grid gap-5">
          <label className="block"><span className="text-sm font-semibold">Amount</span><div className="mt-2 flex overflow-hidden rounded-xl border border-black/10 dark:border-white/10"><input aria-label="Demo payment amount" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} className="min-w-0 flex-1 bg-transparent px-4 py-3 outline-none" /><span className="border-l border-black/10 bg-black/[0.025] px-4 py-3 text-sm font-bold dark:border-white/10 dark:bg-white/[0.04]">XLM</span></div></label>
          <div><div className="text-sm font-semibold">Destination</div><div className="mt-2 rounded-xl border border-black/10 bg-black/[0.018] px-4 py-3 dark:border-white/10 dark:bg-white/[0.025]"><div className="text-sm font-semibold">Vendor settlement</div><div className="mt-1 break-all font-mono text-xs text-neutral-400">{DEMO_DESTINATION_ADDRESS}</div></div></div>
          <label className="block"><span className="text-sm font-semibold">Stellar memo <span className="font-normal text-neutral-400">· public</span></span><input aria-label="Demo Stellar memo" value={draft.memo} onChange={(event) => setDraft({ ...draft, memo: event.target.value })} className="mt-2 w-full rounded-xl border border-black/10 bg-transparent px-4 py-3 outline-none dark:border-white/10" /></label>
          <label className="block"><span className="text-sm font-semibold">Private Note <span className="font-normal text-neutral-400">· Demo only</span></span><textarea aria-label="Demo private note" rows={4} value={draft.privateNote} onChange={(event) => setDraft({ ...draft, privateNote: event.target.value })} className="mt-2 w-full resize-y rounded-xl border border-black/10 bg-transparent px-4 py-3 outline-none dark:border-white/10" /><span className="mt-1.5 block text-xs text-neutral-400">Off-chain context in the real product. Here it exists only in this browser tab.</span></label>
        </div>

        {error && <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>}
        <div className="mt-6 flex justify-end"><button type="button" disabled={Boolean(error)} onClick={onReview} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">Review transfer<ArrowRight className="h-4 w-4" /></button></div>
      </section>
      <TreasuryPolicy />
    </div>
  );
}

function ReviewStage({ draft, xdr, onBack, onStart }: { draft: DemoPaymentDraft; xdr: string; onBack: () => void; onStart: () => void }) {
  return (
    <div className="space-y-5">
      <DemoTransactionSummary xdr={xdr} />
      {draft.privateNote.trim() && <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5"><div className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">Private Note · off-chain Demo context</div><div className="mt-2 whitespace-pre-wrap text-sm leading-6">{draft.privateNote.trim()}</div><div className="mt-2 text-xs text-neutral-400">Not part of the Stellar transaction and not persisted by this Demo.</div></section>}
      <div className="flex flex-wrap justify-between gap-3"><button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold dark:border-white/10"><ArrowLeft className="h-4 w-4" />Edit payment</button><button type="button" onClick={onStart} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white">Continue to signatures<ArrowRight className="h-4 w-4" /></button></div>
    </div>
  );
}

function ProposalStage({ proposal, setProposal, selectedSigner, setSelectedSigner, submitArmed, setSubmitArmed, onSubmitted }: {
  proposal: DemoProposal;
  setProposal: (proposal: DemoProposal) => void;
  selectedSigner: DemoSignerName;
  setSelectedSigner: (signer: DemoSignerName) => void;
  submitArmed: boolean;
  setSubmitArmed: (armed: boolean) => void;
  onSubmitted: () => void;
}) {
  const status = demoProposalStatus(proposal);
  const currentSigned = proposal.signedBy.includes(selectedSigner);
  const nextUnsigned = DEMO_SIGNERS.find((signer) => !proposal.signedBy.includes(signer.name));

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <DemoTransactionSummary xdr={proposal.xdr} frozen />
        <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-bold uppercase tracking-[0.16em] text-neutral-400">Demo Proposal</div><h2 className="mt-1 text-2xl font-bold">Collect 2 signatures.</h2></div><StatusBadge tone={status === 'ready' ? 'success' : 'warning'}>{status === 'ready' ? '2 of 2 · Ready' : `${proposal.signedBy.length} of 2 signatures`}</StatusBadge></div>
          <div className="mt-5 space-y-2">{DEMO_SIGNERS.map((signer) => { const signed = proposal.signedBy.includes(signer.name); return <div key={signer.name} className="flex items-center justify-between gap-3 rounded-xl bg-black/[0.03] px-4 py-3 dark:bg-white/[0.04]"><div className="flex min-w-0 items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/5 text-xs font-bold dark:bg-white/10">{signer.name[0]}</span><div className="min-w-0"><div className="text-sm font-semibold">{signer.name}</div><div className="truncate font-mono text-[11px] text-neutral-400">{shortAddress(signer.address)}</div></div></div><StatusBadge tone={signed ? 'success' : 'neutral'}>{signed ? <><CheckCircle2 className="mr-1 inline h-4 w-4" />Signed · Demo</> : 'Waiting'}</StatusBadge></div>; })}</div>
        </section>
      </div>

      <aside className="space-y-5">
        <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center gap-2"><UserRound className="h-4 w-4 text-emerald-700 dark:text-emerald-300" /><h2 className="font-bold">Demo persona</h2></div>
          <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">Switching persona simulates another signer opening the same Proposal. It is not identity proof.</p>
          <div className="mt-4 grid grid-cols-3 gap-2">{DEMO_SIGNERS.map((signer) => <button key={signer.name} type="button" aria-pressed={selectedSigner === signer.name} onClick={() => setSelectedSigner(signer.name)} className={`rounded-xl px-2 py-2.5 text-xs font-bold ${selectedSigner === signer.name ? 'bg-black text-white dark:bg-white dark:text-black' : 'bg-black/[0.04] dark:bg-white/[0.06]'}`}>{signer.name}</button>)}</div>

          {status !== 'ready' && <button type="button" disabled={currentSigned} onClick={() => setProposal(signDemoProposal(proposal, selectedSigner))} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:bg-neutral-300 disabled:text-neutral-500 dark:disabled:bg-neutral-700 dark:disabled:text-neutral-400"><ShieldCheck className="h-4 w-4" />{currentSigned ? `${selectedSigner} already signed` : `Sign as ${selectedSigner}`}</button>}
          {status !== 'ready' && currentSigned && nextUnsigned && <button type="button" onClick={() => setSelectedSigner(nextUnsigned.name)} className="mt-2 w-full rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold dark:border-white/10">Continue as {nextUnsigned.name}</button>}
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center gap-2"><UsersRound className="h-4 w-4 text-neutral-400" /><h2 className="font-bold">What happens in the real product?</h2></div>
          <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">Each signer receives the private Proposal link, reviews this exact XDR and signs with their own wallet. The Demo replaces only those identity/signature steps.</p>
        </section>

        {status === 'ready' && <section className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-5"><div className="flex items-center gap-2 font-bold text-emerald-800 dark:text-emerald-200"><CheckCircle2 className="h-5 w-5" />Ready to submit</div><p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">The 2-of-3 Demo quorum is satisfied. Submission remains a separate action.</p>{!submitArmed ? <button type="button" onClick={() => setSubmitArmed(true)} className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white">Submit demo transaction</button> : <div className="mt-4 rounded-xl border border-black/10 bg-white/70 p-4 dark:border-white/10 dark:bg-black/20"><div className="text-sm font-bold">Simulate submission?</div><p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Nothing will be broadcast to Stellar and no transaction hash will be created.</p><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => setSubmitArmed(false)} className="rounded-lg border border-black/10 px-3 py-2 text-xs font-bold dark:border-white/10">Not now</button><button type="button" onClick={() => { setProposal(submitDemoProposal(proposal)); setSubmitArmed(false); onSubmitted(); }} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white">Simulate submit</button></div></div>}</section>}
      </aside>
    </div>
  );
}

function DetailsStage({ draft, proposal, onActivity }: { draft: DemoPaymentDraft; proposal: DemoProposal; onActivity: () => void }) {
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-5 sm:p-6"><div className="flex items-center gap-2 text-lg font-bold text-emerald-800 dark:text-emerald-200"><CheckCircle2 className="h-5 w-5" />Simulated submission complete</div><p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">This is Demo history only. No transaction was sent to Stellar, so there is intentionally no Stellar transaction hash or ledger link.</p></section>
      <DemoTransactionSummary xdr={proposal.xdr} history />
      {draft.privateNote.trim() && <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5"><div className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">Private Note · Demo history</div><div className="mt-2 whitespace-pre-wrap text-sm">{draft.privateNote.trim()}</div></section>}
      <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5"><h2 className="font-bold">History</h2><div className="mt-4 space-y-3 text-sm"><div className="flex gap-3"><CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /><div><div className="font-semibold">Proposal created</div><div className="text-neutral-400">Frozen Demo XDR</div></div></div>{proposal.signedBy.map((signer) => <div key={signer} className="flex gap-3"><CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /><div><div className="font-semibold">{signer} signed</div><div className="text-neutral-400">Simulated Demo signature</div></div></div>)}<div className="flex gap-3"><CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /><div><div className="font-semibold">Simulated submission</div><div className="text-neutral-400">No network broadcast</div></div></div></div></section>
      <div className="flex justify-end"><button type="button" onClick={onActivity} className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-bold text-white dark:bg-white dark:text-black"><History className="h-4 w-4" />View Activity</button></div>
    </div>
  );
}

function ActivityStage({ draft, proposal, onDetails, onReset }: { draft: DemoPaymentDraft; proposal: DemoProposal; onDetails: () => void; onReset: () => void }) {
  return (
    <div className="space-y-5">
      <section><div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">Demo Activity</div><h1 className="mt-2 text-3xl font-bold tracking-tight">The same proposal becomes retained history.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500 dark:text-neutral-400">Production Activity is private and authorization-gated. This Demo card is only an in-memory projection of the flow you just completed.</p></section>
      <button type="button" onClick={onDetails} className="w-full rounded-2xl border border-black/10 bg-white p-5 text-left hover:bg-black/[0.01] dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/[0.07] sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">Acme Demo Treasury</div><div className="mt-2 text-xl font-bold">{draft.amount} XLM → Vendor settlement</div><div className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{proposal.signedBy.join(' + ')} signatures · simulated submission</div></div><StatusBadge tone="success">Demo · Done</StatusBadge></div><div className="mt-5 flex items-center gap-2 text-sm font-semibold">Transaction receipt<ArrowRight className="h-4 w-4" /></div></button>
      <div className="flex justify-end"><button type="button" onClick={onReset} className="inline-flex items-center gap-2 rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold dark:border-white/10"><RefreshCw className="h-4 w-4" />Start demo again</button></div>
    </div>
  );
}

export default function DemoTreasuryApp() {
  const [stage, setStage] = useState<DemoStage>('prepare');
  const [draft, setDraft] = useState<DemoPaymentDraft>(DEFAULT_DEMO_PAYMENT);
  const [reviewXdr, setReviewXdr] = useState('');
  const [proposal, setProposal] = useState<DemoProposal | null>(null);
  const [selectedSigner, setSelectedSigner] = useState<DemoSignerName>('Alice');
  const [submitArmed, setSubmitArmed] = useState(false);

  function reset() {
    setStage('prepare');
    setDraft(DEFAULT_DEMO_PAYMENT);
    setReviewXdr('');
    setProposal(null);
    setSelectedSigner('Alice');
    setSubmitArmed(false);
    window.scrollTo({ top: 0, left: 0 });
  }

  function go(stageValue: DemoStage) {
    setStage(stageValue);
    window.scrollTo({ top: 0, left: 0 });
  }

  const workflowStage = stage === 'prepare'
    ? 'prepare'
    : stage === 'review'
      ? 'review'
      : stage === 'proposal' && proposal && demoProposalStatus(proposal) === 'ready'
        ? 'submit'
        : stage === 'proposal'
          ? 'sign'
          : 'done';
  return (
    <div data-stellar-network="testnet" data-demo-runtime="true" className="min-h-screen bg-[#f6f6f2] text-[#171717] dark:bg-[#090909] dark:text-[#f5f5f0]">
      <StellarHeader demo />
      <DemoBanner />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <div className="mb-6"><WorkflowProgress current={workflowStage} label="Demo transaction progress" /></div>
        {stage === 'prepare' && <PrepareStage draft={draft} setDraft={setDraft} onReview={() => { setReviewXdr(buildDemoPaymentXdr(draft)); go('review'); }} />}
        {stage === 'review' && reviewXdr && <ReviewStage draft={draft} xdr={reviewXdr} onBack={() => go('prepare')} onStart={() => { setProposal(createDemoProposalFromXdr(reviewXdr)); setSelectedSigner('Alice'); go('proposal'); }} />}
        {stage === 'proposal' && proposal && <ProposalStage proposal={proposal} setProposal={setProposal} selectedSigner={selectedSigner} setSelectedSigner={setSelectedSigner} submitArmed={submitArmed} setSubmitArmed={setSubmitArmed} onSubmitted={() => go('details')} />}
        {stage === 'details' && proposal && <DetailsStage draft={draft} proposal={proposal} onActivity={() => go('activity')} />}
        {stage === 'activity' && proposal && <ActivityStage draft={draft} proposal={proposal} onDetails={() => go('details')} onReset={reset} />}
      </main>
      <StellarFooter />
    </div>
  );
}
