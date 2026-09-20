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
    <div data-stellar-network={effectiveNetwork} className="mst-page">
      <StellarHeader landing />

      <main>
        <section className="mst-marketing-hero">
          <div>
            <div className="mst-kicker">Stellar multisig</div>
            <h1 className="mst-display mt-5">Share control.<br />Not custody.</h1>
            <p className="mst-lede mt-6">Create Stellar treasuries, prepare exact transactions, collect the approvals they require, and submit only when the on-chain signing rules are satisfied.</p>

            <div className="mst-actions">
              <a href={workspaceHref} onClick={(event) => void openPrivateDestination(event, workspaceHref)} className="mst-action-primary">
                {authBusy ? 'Confirm in wallet…' : 'Open workspace'}<ArrowRight className="h-4 w-4" />
              </a>
              <a href={stellarHref('/demo')} className="mst-action-secondary">Try live demo</a>
            </div>

            <div className="mst-trust-line">
              <span><KeyRound className="h-4 w-4" />Keys stay in your wallet</span>
              <span><ShieldCheck className="h-4 w-4" />Signing rules stay on Stellar</span>
            </div>
          </div>

          <TreasuryApprovalDemo />
        </section>

        <section className="mst-section">
          <div className="mst-section__inner">
            <header className="mst-section__intro">
              <div className="mst-kicker">One transaction, one readable path</div>
              <h2 className="mst-section__title">Shared authorization should stay understandable from preparation to submission.</h2>
            </header>

            <div className="mst-sequence" aria-label="How MultiSig Tools works">
              {[
                ['01', 'Create shared control', 'Choose who can sign and how many approvals the Stellar account requires.'],
                ['02', 'Prepare the transaction', 'Build the payment or account-control change without moving funds yet.'],
                ['03', 'Review and sign', 'Every signer sees the exact transaction before adding a wallet signature.'],
                ['04', 'Submit to Stellar', 'Broadcast only after the current on-chain threshold and execution checks pass.'],
              ].map(([number, title, description]) => (
                <div key={number} className="mst-sequence__row">
                  <div className="mst-sequence__number">{number}</div>
                  <h3 className="mst-sequence__title">{title}</h3>
                  <p className="mst-sequence__copy">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mst-section">
          <div className="mst-section__inner">
            <header className="mst-section__intro">
              <div className="mst-kicker">Start from your job</div>
              <h2 className="mst-section__title">The workspace opens around what you need to do next.</h2>
            </header>

            <div className="mst-task-index">
              <div className="mst-task-row">
                <Inbox className="mst-task-link__icon h-5 w-5" />
                <span className="mst-task-link__title">Review and sign</span>
                <span className="mst-task-link__copy">Open transactions that need your signature or attention.</span>
                <a href={stellarHref('/inbox')} onClick={(event) => void openPrivateDestination(event, stellarHref('/inbox'))} className="mst-task-row__action">Open Inbox<ArrowRight className="h-4 w-4" /></a>
              </div>

              <div className="mst-task-row">
                <Vault className="mst-task-link__icon h-5 w-5" />
                <span className="mst-task-link__title">Create or manage a treasury</span>
                <span className="mst-task-link__copy">Set shared control, inspect current signers, and prepare treasury work.</span>
                <a href={stellarHref('/treasury')} className="mst-task-row__action">Open Treasury<ArrowRight className="h-4 w-4" /></a>
              </div>

              <div className="mst-task-row">
                <UsersRound className="mst-task-link__icon h-5 w-5" />
                <span className="mst-task-link__title">See the full flow</span>
                <span className="mst-task-link__copy">Walk through a multisig proposal without putting real assets at risk.</span>
                <a href={stellarHref('/demo')} className="mst-task-row__action">Open demo<ArrowRight className="h-4 w-4" /></a>
              </div>
            </div>
          </div>
        </section>

        <section className="mst-section mst-trust-band">
          <div className="mst-section__inner mst-trust-layout">
            <div>
              <div className="mst-kicker">Authority stays where it belongs</div>
              <h2 className="mst-section__title">Your keys stay in your wallet.</h2>
            </div>

            <div className="mst-trust-copy">
              <p>MultiSig Tools does not hold treasury assets or private keys. Account signing rules live on Stellar.</p>
              <p>Private share links identify a transaction; they do not grant signing authority. Each signer can inspect the exact XDR before signing it.</p>

              <div className="mst-history-note">
                <strong>Why the linked-authority mark?</strong> Surviving Qin and Han tiger tallies — 虎符 — document an old authorization pattern: authority divided between holders, with a match required before an order could proceed. MultiSig Tools uses modern cryptographic signatures, not the ancient mechanism; the shared idea is that one holder alone need not be enough to act.
              </div>
            </div>
          </div>
        </section>
      </main>

      <StellarFooter />
    </div>
  );
}
