import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { BookUser, Braces, Ellipsis, History, Home, Inbox, Plus, Vault } from 'lucide-react';
import StellarFooter from './StellarFooter';
import StellarHeader from './StellarHeader';
import { useStellarWallet } from './StellarWalletContext';
import { resolveStellarNetwork } from './stellar/networkPreference';
import type { StellarNetwork } from './stellar/types';
import { stellarHref } from './workspaceNavigation';
import { isWalletUserRejected } from './stellar/walletKit';

export type WorkspaceView = 'dashboard' | 'inbox' | 'waiting' | 'ready' | 'activity' | 'new' | 'contracts' | 'treasury' | 'address-book' | 'detail';
type InboxWorkspaceView = 'inbox' | 'waiting' | 'ready';

function navClass(active: boolean) {
  return `flex min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-xs font-semibold transition sm:gap-2 sm:px-3 sm:text-sm lg:w-full lg:justify-start ${
    active
      ? 'bg-black text-white dark:bg-white dark:text-black'
      : 'text-neutral-600 hover:bg-black/5 hover:text-black dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white'
  }`;
}

function newClass(active: boolean) {
  const accent = active ? 'bg-emerald-700' : 'bg-emerald-600 hover:bg-emerald-700';
  return `flex min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-xs font-bold text-white transition sm:gap-2 sm:px-3 sm:text-sm lg:mb-5 lg:w-full lg:justify-start lg:px-3 lg:py-3 ${accent}`;
}

interface Props {
  active: WorkspaceView;
  children: ReactNode;
  onViewChange?: (view: InboxWorkspaceView) => void;
  networkContext?: StellarNetwork | null;
}

export default function StellarWorkspaceShell({ active, children, networkContext = null }: Props) {
  const { sessionNetwork, networkSource, alignNetworkContext, privateUnlocked, authBusy, unlock } = useStellarWallet();
  const pathname = window.location.pathname;
  const treasuryActive = active === 'treasury'
    || pathname.endsWith('/treasury')
    || pathname.includes('/treasury/');
  const addressBookActive = active === 'address-book'
    || pathname.endsWith('/address-book');
  const inboxActive = active === 'inbox' || active === 'waiting' || active === 'ready';
  const mobileMoreActive = treasuryActive || active === 'contracts' || active === 'activity' || addressBookActive;
  const effectiveNetwork = resolveStellarNetwork(networkContext, sessionNetwork);
  const mobileMoreRef = useRef<HTMLDivElement>(null);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  useEffect(() => {
    if (!networkContext || networkSource !== 'application' || sessionNetwork === networkContext) return;
    void alignNetworkContext(networkContext);
  }, [alignNetworkContext, networkContext, networkSource, sessionNetwork]);

  useEffect(() => {
    if (!mobileMoreOpen) return;
    function closeOnOutside(event: PointerEvent) {
      if (!mobileMoreRef.current?.contains(event.target as Node)) setMobileMoreOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileMoreOpen(false);
    }
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [mobileMoreOpen]);

  async function openPrivateWorkspace(event: MouseEvent<HTMLAnchorElement>, href: string) {
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
    <div data-stellar-network={effectiveNetwork} className="flex min-h-screen w-full max-w-full flex-col overflow-x-hidden bg-[#f6f6f2] text-[#171717] dark:bg-[#090909] dark:text-[#f5f5f0]">
      <StellarHeader />

      <div className="mx-auto flex w-full max-w-[1480px] flex-1 flex-col lg:grid lg:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="relative min-w-0 border-b border-black/10 px-2 py-2 dark:border-white/10 sm:px-4 sm:py-3 lg:overflow-hidden lg:border-b-0 lg:border-r lg:px-4 lg:py-6">
          <div className="grid grid-cols-4 gap-1 lg:block">
            <a href={stellarHref('')} className={`${navClass(active === 'dashboard')} lg:mb-1`}><Home className="h-4 w-4 shrink-0" /> <span className="truncate">Home</span></a>
            <a href={stellarHref('/inbox')} onClick={(event) => void openPrivateWorkspace(event, stellarHref('/inbox'))} className={navClass(inboxActive)}><Inbox className="h-4 w-4 shrink-0" /> <span className="truncate">Inbox</span></a>
            <a href={stellarHref('/new')} className={`${newClass(active === 'new')} lg:mt-4`}><Plus className="h-4 w-4 shrink-0" /> <span className="truncate">New<span className="hidden sm:inline"> proposal</span></span></a>

            <div ref={mobileMoreRef} className="relative lg:hidden">
              <button type="button" aria-expanded={mobileMoreOpen} aria-haspopup="menu" onClick={() => setMobileMoreOpen((open) => !open)} className={`${navClass(mobileMoreActive)} w-full`}><Ellipsis className="h-4 w-4 shrink-0" /> <span className="truncate">More</span></button>
              {mobileMoreOpen && (
                <div role="menu" className="absolute right-0 z-30 mt-2 w-48 rounded-2xl border border-black/10 bg-white p-2 shadow-xl shadow-black/10 dark:border-white/10 dark:bg-[#141414]">
                  <a role="menuitem" href={stellarHref('/contracts')} onClick={() => setMobileMoreOpen(false)} className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-black/5 dark:text-neutral-200 dark:hover:bg-white/10"><Braces className="h-4 w-4 shrink-0" /> <span className="truncate">Contracts</span></a>
                  <a role="menuitem" href={stellarHref('/treasury')} onClick={() => setMobileMoreOpen(false)} className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-black/5 dark:text-neutral-200 dark:hover:bg-white/10"><Vault className="h-4 w-4 shrink-0" /> <span className="truncate">Treasuries</span></a>
                  <a role="menuitem" href={stellarHref('/activity')} onClick={(event) => { setMobileMoreOpen(false); void openPrivateWorkspace(event, stellarHref('/activity')); }} className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-black/5 dark:text-neutral-200 dark:hover:bg-white/10"><History className="h-4 w-4 shrink-0" /> <span className="truncate">Activity</span></a>
                  <a role="menuitem" href={stellarHref('/address-book')} onClick={() => setMobileMoreOpen(false)} className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-black/5 dark:text-neutral-200 dark:hover:bg-white/10"><BookUser className="h-4 w-4 shrink-0" /> <span className="truncate">Contacts</span></a>
                </div>
              )}
            </div>

            <div className="hidden lg:block">
              <a href={stellarHref('/contracts')} className={navClass(active === 'contracts')}><Braces className="h-4 w-4 shrink-0" /> <span className="truncate">Contracts</span></a>
              <a href={stellarHref('/treasury')} className={navClass(treasuryActive)}><Vault className="h-4 w-4 shrink-0" /> <span className="truncate">Treasuries</span></a>
              <a href={stellarHref('/activity')} onClick={(event) => void openPrivateWorkspace(event, stellarHref('/activity'))} className={navClass(active === 'activity')}><History className="h-4 w-4 shrink-0" /> <span className="truncate">Activity</span></a>
              <a href={stellarHref('/address-book')} className={navClass(addressBookActive)}><BookUser className="h-4 w-4 shrink-0" /> <span className="truncate">Contacts</span></a>
            </div>
          </div>

          <div className="mt-5 hidden border-t border-black/10 px-3 pt-4 text-xs leading-5 text-neutral-400 dark:border-white/10 lg:block">
            One workspace for contracts, proposals, approvals, treasuries, and activity.
          </div>
        </aside>

        <div className="min-w-0 flex-1">{children}</div>
      </div>

      <StellarFooter workspace />
    </div>
  );
}
