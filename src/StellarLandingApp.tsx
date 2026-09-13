import { useState } from 'react';
import type { MouseEvent } from 'react';
import { ArrowRight, CheckCircle2, Inbox, KeyRound, Send, ShieldCheck, UsersRound, Vault } from 'lucide-react';
import StellarFooter from './StellarFooter';
import StellarHeader from './StellarHeader';
import { useStellarWallet } from './StellarWalletContext';
import { landingDemoScenarioForCycle } from './stellar/landingDemo';
import { isWalletUserRejected } from './stellar/walletKit';
import { stellarHref } from './workspaceNavigation';

function TreasuryApprovalDemo() {
  const [cycle, setCycle] = useState(0);
  const [sequenceSeed] = useState(() => Math.floor(Math.random() * 0x1_0000_0000));
  const scenario = landingDemoScenarioForCycle(cycle, sequenceSeed);

  return (
    <div className="landing-demo relative" aria-label="Animated example 2-of-3 treasury approval flow">
      <div className="absolute -inset-5 -z-10 rounded-[2rem] bg-emerald-500/[0.05] blur-2xl" />
      <div
        className="landing-demo-cycle rounded-[1.75rem] border border-black/10 bg-white p-5 shadow-xl shadow-black/[0.04] dark:border-white/10 dark:bg-[#111] sm:p-6"
        onAnimationIteration={(event) => {
          if (event.target !== event.currentTarget) return;
          setCycle((value) => value + 1);
        }}
      >
        <div className="flex items-center justify-between gap-4 border-b border-black/10 pb-4 dark:border-white/10">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-wider text-neutral-400">Treasury</div>
            <div className="landing-demo-scenario-swap mt-1 min-h-6 truncate font-bold">{scenario.treasury}</div>
          </div>
          <span className="relative inline-flex h-7 min-w-[7.5rem] items-center justify-center overflow-hidden rounded-full bg-emerald-500/10 px-3 text-center text-xs font-bold text-emerald-700 dark:text-emerald-300">
            <span className="landing-demo-stage landing-demo-stage-zero">0 of 2</span>
            <span className="landing-demo-stage landing-demo-stage-one">1 of 2</span>
            <span className="landing-demo-stage landing-demo-stage-ready">2 of 2 · Ready</span>
            <span className="landing-demo-stage landing-demo-stage-submitted">Submitted</span>
          </span>
        </div>

        <div className="landing-demo-scenario-swap py-5">
          <div className="text-sm text-neutral-500 dark:text-neutral-400">Payment proposal</div>
          <div className="mt-1 flex items-end justify-between gap-4">
            <div className="whitespace-nowrap text-3xl font-bold tracking-tight">{scenario.amount} {scenario.asset}</div>
            <Send className="mb-1 h-5 w-5 shrink-0 text-neutral-400" />
          </div>
          <div className="mt-2 truncate text-sm text-neutral-500 dark:text-neutral-400">To {scenario.destination}</div>
        </div>

        <div className="space-y-2 border-t border-black/10 pt-4 dark:border-white/10">
          {scenario.signers.map((name, index) => {
            const signedOrder = scenario.signedIndexes.indexOf(index);
            const stateClass = signedOrder === 0
              ? 'landing-demo-first-check'
              : signedOrder === 1
                ? 'landing-demo-second-check'
                : '';
            return (
              <div key={name} className="flex items-center justify-between rounded-xl bg-black/[0.025] px-3.5 py-3 text-sm dark:bg-white/[0.04]">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/5 text-xs font-bold dark:bg-white/10">{name[0]}</span>
                  <span className="font-semibold">{name}</span>
                </div>
                {stateClass ? (
                  <span className="relative inline-block h-5 min-w-[4.75rem] text-right">
                    <span className={`landing-demo-waiting ${stateClass}`}>Waiting</span>
                    <span className={`landing-demo-signed ${stateClass}`}>
                      <CheckCircle2 className="mr-1 inline h-4 w-4" />Signed
                    </span>
                  </span>
                ) : (
                  <span className="text-neutral-400">Waiting</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-400">
            <span>Prepared</span>
            <span className="landing-demo-ready-label text-emerald-700 dark:text-emerald-300">Quorum reached</span>
            <span>Stellar</span>
          </div>
          <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
            <div className="landing-demo-progress absolute inset-y-0 left-0 rounded-full bg-emerald-500" />
            <span className="landing-demo-pulse absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-emerald-500 shadow-[0_0_0_5px_rgba(16,185,129,0.12)]" />
          </div>
          <div className="landing-demo-submitted mt-3 flex items-center justify-end gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />Submitted to Stellar
          </div>
          <a href={stellarHref('/demo')} className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-4 py-2.5 text-sm font-bold text-emerald-800 hover:bg-emerald-500/10 dark:text-emerald-200">Try this flow yourself<ArrowRight className="h-4 w-4" /></a>
        </div>
      </div>
    </div>
  );
}

export default function StellarLandingApp() {
  const { sessionNetwork, privateUnlocked, authBusy, unlock } = useStellarWallet();
  const workspaceHref = stellarHref('');
  const effectiveNetwork = sessionNetwork ?? 'public';

  async function openPrivateDestination(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (privateUnlocked) return;
    event.preventDefault();
    if (authBusy) return;
    try {
      await unlock();
      window.location.assign(href);
    } catch (cause) {
      if (!isWalletUserRejected(cause)) window.location.assign(href);
    }
  }

  return (
    <div data-stellar-network={effectiveNetwork} className="min-h-screen bg-[#f6f6f2] text-[#171717] dark:bg-[#090909] dark:text-[#f5f5f0]">
      <StellarHeader landing />

      <main className="relative z-0">
        <section className="mx-auto grid max-w-7xl gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:px-8 lg:pb-24 lg:pt-24">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-700 dark:text-emerald-300">Stellar multisig</div>
            <h1 className="mt-5 max-w-3xl text-5xl font-bold leading-[1.02] tracking-[-0.045em] sm:text-6xl lg:text-7xl">Share control.<br />Not custody.</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-neutral-600 dark:text-neutral-300 sm:text-xl">Create Stellar treasuries, prepare exact transactions, collect the approvals they require, and submit only when the on-chain signing rules are satisfied.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={workspaceHref} onClick={(event) => void openPrivateDestination(event, workspaceHref)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-3.5 text-sm font-bold text-white hover:bg-emerald-800">{authBusy ? 'Confirm in wallet…' : 'Open workspace'}<ArrowRight className="h-4 w-4" /></a>
              <a href={stellarHref('/demo')} className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] px-5 py-3.5 text-sm font-bold text-emerald-800 hover:bg-emerald-500/10 dark:text-emerald-200"><UsersRound className="h-4 w-4" />Try live demo</a>
              <a href={stellarHref('/treasury')} className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white/60 px-5 py-3.5 text-sm font-bold hover:bg-white dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"><Vault className="h-4 w-4" />Create a treasury</a>
            </div>
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-neutral-500 dark:text-neutral-400">
              <span className="flex items-center gap-1.5"><KeyRound className="h-4 w-4" />Keys stay in your wallet</span>
              <span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4" />Signing rules stay on Stellar</span>
            </div>
          </div>

          <TreasuryApprovalDemo />
        </section>

        <section className="border-y border-black/10 bg-white/45 dark:border-white/10 dark:bg-white/[0.025]">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
            <div className="max-w-2xl"><div className="text-sm font-bold text-emerald-700 dark:text-emerald-300">One treasury. Multiple approvals.</div><h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">The transaction stays understandable from start to finish.</h2></div>
            <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-black/10 bg-black/10 dark:border-white/10 dark:bg-white/10 md:grid-cols-4">
              {[
                ['01', 'Create shared control', 'Choose who can sign and how many approvals the Stellar account requires.'],
                ['02', 'Prepare a transaction', 'Build a treasury payment or an account-control change without moving funds yet.'],
                ['03', 'Share for approval', 'Every signer reviews the exact transaction before adding a signature.'],
                ['04', 'Submit to Stellar', 'Broadcast only after the current on-chain threshold and execution checks pass.'],
              ].map(([number, title, description]) => <div key={number} className="bg-[#f6f6f2] p-5 dark:bg-[#0c0c0c] sm:p-6"><div className="text-xs font-bold text-neutral-400">{number}</div><h3 className="mt-6 font-bold">{title}</h3><p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{description}</p></div>)}
            </div>
          </div>
        </section>

        <section className="border-y border-black/10 bg-white/45 dark:border-white/10 dark:bg-white/[0.025]">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[0.72fr_1.28fr] lg:px-8 lg:py-16">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-neutral-400">A historical analogy</div>
              <h2 className="mt-3 text-3xl font-bold tracking-tight">Authority was split long before it was digital.</h2>
            </div>
            <div className="space-y-4 text-base leading-7 text-neutral-600 dark:text-neutral-300">
              <p>Surviving Qin and Han tiger tallies — <span className="font-semibold text-neutral-900 dark:text-white">虎符</span> — document an early authorization pattern: a tally divided into matching halves, with authority deliberately split between holders. A military order could be authenticated by matching the halves, so possession of an instruction alone was not enough.</p>
              <p>MultiSig Tools uses a modern cryptographic model, not the ancient mechanism. The analogy is the principle: high-impact authority can be deliberately divided, and one holder alone need not be enough to act.</p>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:px-8 lg:py-24">
          <div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><ShieldCheck className="h-5 w-5" /></div>
            <h2 className="mt-5 text-3xl font-bold tracking-tight">Your keys stay in your wallet.</h2>
            <div className="mt-5 space-y-4 text-base leading-7 text-neutral-600 dark:text-neutral-300">
              <p>MultiSig Tools does not hold treasury assets or private keys. Account signing rules live on Stellar.</p>
              <p>Private share links identify a transaction; they do not grant signing authority. Each signer can inspect the exact XDR before approving it.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <a href={stellarHref('/inbox')} onClick={(event) => void openPrivateDestination(event, stellarHref('/inbox'))} className="group flex h-full flex-col rounded-2xl border border-black/10 bg-white p-6 hover:border-emerald-500/35 dark:border-white/10 dark:bg-white/[0.04]"><Inbox className="h-5 w-5 text-emerald-700 dark:text-emerald-300" /><h3 className="mt-8 text-xl font-bold">I need to sign</h3><p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">Review transactions waiting for your approval and follow the ones you keep in Activity.</p><div className="mt-auto flex items-center gap-1.5 pt-5 text-sm font-bold text-emerald-700 dark:text-emerald-300">Open Inbox<ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" /></div></a>
            <a href={stellarHref('/treasury')} className="group flex h-full flex-col rounded-2xl border border-black/10 bg-white p-6 hover:border-emerald-500/35 dark:border-white/10 dark:bg-white/[0.04]"><UsersRound className="h-5 w-5 text-emerald-700 dark:text-emerald-300" /><h3 className="mt-8 text-xl font-bold">I manage a treasury</h3><p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">Manage shared control, treasury settings, Audit access, and signing rules.</p><div className="mt-auto flex items-center gap-1.5 pt-5 text-sm font-bold text-emerald-700 dark:text-emerald-300">Open Treasury<ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" /></div></a>
          </div>
        </section>
      </main>

      <StellarFooter />
    </div>
  );
}
