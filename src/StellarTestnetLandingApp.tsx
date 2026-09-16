import { ArrowRight, BookOpen, FlaskConical, ShieldCheck } from 'lucide-react';
import StellarHeader from './StellarHeader';
import { STELLAR_MAINNET_ORIGIN } from './stellar/deploymentOrigins';
import { canonicalStellarContentHref, stellarHref } from './workspaceNavigation';

export default function StellarTestnetLandingApp() {
  return (
    <div data-stellar-network="testnet" className="flex min-h-screen flex-col bg-[#f6f6f2] text-[#171717] dark:bg-[#090909] dark:text-[#f5f5f0]">
      <StellarHeader landing />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-sky-500/10 px-3 py-1.5 text-xs font-bold text-sky-800 dark:text-sky-200"><FlaskConical className="h-4 w-4" />Testnet runtime</div>
          <h1 className="mt-6 text-4xl font-bold tracking-[-0.04em] sm:text-5xl">Test the MultiSigTools workflow without Mainnet assets.</h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-neutral-600 dark:text-neutral-300">This deployment is fixed to Stellar Testnet. Proposals, Intents, Treasuries, Activity, credentials, and wallet network context stay inside the Testnet runtime instead of sharing state with Mainnet.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={stellarHref('/inbox')} className="inline-flex items-center gap-2 rounded-xl bg-sky-700 px-5 py-3 text-sm font-bold text-white hover:bg-sky-800">Open Testnet workspace<ArrowRight className="h-4 w-4" /></a>
            <a href={stellarHref('/new')} className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white px-5 py-3 text-sm font-bold hover:bg-black/[0.03] dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.08]">New test proposal</a>
          </div>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/[0.04]"><ShieldCheck className="h-5 w-5 text-sky-700 dark:text-sky-300" /><h2 className="mt-4 font-bold">Network stays fixed</h2><p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">There is no in-app Mainnet/Testnet switch. The deployment owns the network boundary so runtime state cannot silently cross networks.</p></div>
          <div className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/[0.04]"><BookOpen className="h-5 w-5 text-neutral-500" /><h2 className="mt-4 font-bold">Product content lives once</h2><p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">Documentation, Developers, Privacy, Terms, and the interactive demo use the canonical Mainnet content site rather than being duplicated here.</p></div>
        </div>
      </main>
      <footer className="border-t border-black/10 px-4 py-5 text-sm text-neutral-500 dark:border-white/10 dark:text-neutral-400 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-5 gap-y-2">
          <a href={canonicalStellarContentHref('/docs')} className="font-semibold hover:text-sky-700 dark:hover:text-sky-300">Documentation</a>
          <a href={canonicalStellarContentHref('/developers')} className="font-semibold hover:text-sky-700 dark:hover:text-sky-300">Developers</a>
          <a href={STELLAR_MAINNET_ORIGIN} className="font-semibold hover:text-sky-700 dark:hover:text-sky-300">Mainnet</a>
          <span className="sm:ml-auto">Testnet assets have no Mainnet value.</span>
        </div>
      </footer>
    </div>
  );
}
