import { ArrowRight, Inbox, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { useStellarWallet } from './StellarWalletContext';
import { navigateWorkspace } from './workspaceNavigation';
import {
  hasSeenWorkspaceOnboarding,
  markWorkspaceOnboardingSeen,
  onboardingModeDestination,
  setWorkspaceMode,
} from './workspaceMode';
import type { WorkspaceMode } from './workspaceMode';

export default function WorkspaceModeOnboarding() {
  const { sessionAddress, sessionNetwork } = useStellarWallet();
  const [handled, setHandled] = useState(false);

  if (!sessionAddress || !sessionNetwork || handled || hasSeenWorkspaceOnboarding(sessionAddress)) return null;

  function chooseMode(mode: WorkspaceMode) {
    if (!sessionAddress || !sessionNetwork) return;
    setWorkspaceMode(sessionAddress, sessionNetwork, mode);
    markWorkspaceOnboardingSeen(sessionAddress);
    setHandled(true);

    const destination = onboardingModeDestination(mode, window.location.pathname);
    if (destination) navigateWorkspace(destination, { replace: true });
  }

  const signAccent = sessionNetwork === 'testnet'
    ? {
        border: 'hover:border-sky-500/40',
        icon: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
        arrow: 'group-hover:text-sky-600 dark:group-hover:text-sky-300',
      }
    : {
        border: 'hover:border-emerald-500/40',
        icon: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        arrow: 'group-hover:text-emerald-600 dark:group-hover:text-emerald-300',
      };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-labelledby="workspace-welcome-title" className="w-full max-w-2xl rounded-3xl border border-black/10 bg-[#f8f8f4] p-6 shadow-2xl dark:border-white/15 dark:bg-[#151515] sm:p-8">
        <div className="max-w-xl">
          <div className={`text-sm font-semibold ${sessionNetwork === 'testnet' ? 'text-sky-700 dark:text-sky-300' : 'text-emerald-700 dark:text-emerald-300'}`}>MultiSig Tools for Stellar</div>
          <h1 id="workspace-welcome-title" className="mt-2 text-3xl font-bold tracking-tight">What are you here to do?</h1>
          <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">Choose a workspace. You can switch anytime from the wallet menu in the top-right corner.</p>
        </div>

        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          <button type="button" onClick={() => chooseMode('sign')} className={`group rounded-2xl border border-black/10 bg-white p-5 text-left transition hover:shadow-md dark:border-white/10 dark:bg-white/[0.04] ${signAccent.border}`}>
            <div className="flex items-start justify-between gap-4">
              <div className={`rounded-xl p-2.5 ${signAccent.icon}`}><Inbox className="h-5 w-5" /></div>
              <ArrowRight className={`mt-1 h-5 w-5 text-neutral-400 transition group-hover:translate-x-0.5 ${signAccent.arrow}`} />
            </div>
            <div className="mt-5 text-lg font-bold">Sign transactions</div>
            <p className="mt-1 text-sm leading-6 text-neutral-500 dark:text-neutral-400">Open Inbox, review proposals waiting for you, create transactions, and track your activity.</p>
          </button>

          <button type="button" onClick={() => chooseMode('setup')} className="group rounded-2xl border border-black/10 bg-white p-5 text-left transition hover:border-black/25 hover:shadow-md dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-white/25">
            <div className="flex items-start justify-between gap-4">
              <div className="rounded-xl bg-black/5 p-2.5 text-neutral-700 dark:bg-white/10 dark:text-neutral-200"><Settings2 className="h-5 w-5" /></div>
              <ArrowRight className="mt-1 h-5 w-5 text-neutral-400 transition group-hover:translate-x-0.5 group-hover:text-neutral-700 dark:group-hover:text-neutral-200" />
            </div>
            <div className="mt-5 text-lg font-bold">Manage treasury</div>
            <p className="mt-1 text-sm leading-6 text-neutral-500 dark:text-neutral-400">Manage shared control, signing policy, shared settings, Audit access, and treasury activity.</p>
          </button>
        </div>
      </section>
    </div>
  );
}
