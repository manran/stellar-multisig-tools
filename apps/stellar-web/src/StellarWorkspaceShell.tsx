import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { BookUser, Bot, Braces, Ellipsis, History, Home, Inbox, LayoutTemplate, Plus, Vault } from 'lucide-react';
import StellarFooter from './StellarFooter';
import StellarHeader from './StellarHeader';
import { useStellarWallet } from './StellarWalletContext';
import { resolveStellarNetwork } from './stellar/networkPreference';
import type { StellarNetwork } from '../../../packages/stellar-core/src/types';
import { stellarHref } from './workspaceNavigation';
import { isWalletUserRejected } from './stellar/walletKit';

export type WorkspaceView = 'dashboard' | 'inbox' | 'waiting' | 'ready' | 'activity' | 'new' | 'templates' | 'contracts' | 'treasury' | 'address-book' | 'agent-access' | 'detail';
type InboxWorkspaceView = 'inbox' | 'waiting' | 'ready';

function navClass(active: boolean) {
  return 'mst-rail-link' + (active ? ' mst-rail-link--active' : '');
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
  const treasuryActive = active === 'treasury' || pathname.endsWith('/treasury') || pathname.includes('/treasury/');
  const addressBookActive = active === 'address-book' || pathname.endsWith('/address-book');
  const inboxActive = active === 'inbox' || active === 'waiting' || active === 'ready';
  const mobileMoreActive = treasuryActive || active === 'templates' || active === 'contracts' || active === 'activity' || addressBookActive || active === 'agent-access';
  const effectiveNetwork = resolveStellarNetwork(networkContext, sessionNetwork);
  const mobileMoreRef = useRef<HTMLDivElement>(null);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  useEffect(() => {
    if (!networkContext || networkSource !== 'application' || sessionNetwork === networkContext) return;
    void alignNetworkContext(networkContext);
  }, [alignNetworkContext, networkContext, networkSource, sessionNetwork]);

  useEffect(() => {
    if (!mobileMoreOpen) return;
    function outside(event: PointerEvent) {
      if (!mobileMoreRef.current?.contains(event.target as Node)) setMobileMoreOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileMoreOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
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
    <div data-stellar-network={effectiveNetwork} className="mst-workspace-root">
      <StellarHeader />
      <div className="mst-workspace-layout">
        <aside className="mst-workspace-rail" aria-label="Workspace navigation">
          <nav className="mst-workspace-navigation" aria-label="Main">
            <a href={stellarHref('')} aria-current={active === 'dashboard' ? 'page' : undefined} className={navClass(active === 'dashboard')}>
              <Home className="h-4 w-4 shrink-0" /><span>Overview</span>
            </a>
            <a href={stellarHref('/inbox')} onClick={(event) => void openPrivateWorkspace(event, stellarHref('/inbox'))} aria-current={inboxActive ? 'page' : undefined} className={navClass(inboxActive)}>
              <Inbox className="h-4 w-4 shrink-0" /><span>Inbox</span>
            </a>
            <a href={stellarHref('/new')} aria-current={active === 'new' ? 'page' : undefined} className={'mst-rail-link mst-rail-link--create' + (active === 'new' ? ' mst-rail-link--create-active' : '')}>
              <Plus className="h-4 w-4 shrink-0" /><span>New<span className="hidden sm:inline"> proposal</span></span>
            </a>

            <div ref={mobileMoreRef} className="relative lg:hidden">
              <button type="button" aria-expanded={mobileMoreOpen} aria-haspopup="menu" aria-label="More workspace tools" onClick={() => setMobileMoreOpen((open) => !open)} className={navClass(mobileMoreActive) + ' w-full'}>
                <Ellipsis className="h-4 w-4 shrink-0" /><span>More</span>
              </button>
              {mobileMoreOpen && (
                <div role="menu" className="mst-workspace-mobile-menu">
                  <a role="menuitem" href={stellarHref('/templates')} onClick={() => setMobileMoreOpen(false)} className="mst-workspace-menu-item"><LayoutTemplate className="h-4 w-4" />Templates</a>
                  <a role="menuitem" href={stellarHref('/activity')} onClick={(event) => { setMobileMoreOpen(false); void openPrivateWorkspace(event, stellarHref('/activity')); }} className="mst-workspace-menu-item"><History className="h-4 w-4" />Activity</a>
                  <a role="menuitem" href={stellarHref('/contracts')} onClick={() => setMobileMoreOpen(false)} className="mst-workspace-menu-item"><Braces className="h-4 w-4" />Contracts</a>
                  <a role="menuitem" href={stellarHref('/treasury')} onClick={() => setMobileMoreOpen(false)} className="mst-workspace-menu-item"><Vault className="h-4 w-4" />Treasuries</a>
                  <a role="menuitem" href={stellarHref('/address-book')} onClick={() => setMobileMoreOpen(false)} className="mst-workspace-menu-item"><BookUser className="h-4 w-4" />Contacts</a>
                  <a role="menuitem" href={stellarHref('/agent-access')} onClick={() => setMobileMoreOpen(false)} className="mst-workspace-menu-item"><Bot className="h-4 w-4" />Agent access</a>
                </div>
              )}
            </div>

            <a href={stellarHref('/templates')} aria-current={active === 'templates' ? 'page' : undefined} className={navClass(active === 'templates') + ' mst-rail-desktop'}>
              <LayoutTemplate className="h-4 w-4 shrink-0" /><span>Templates</span>
            </a>
            <a href={stellarHref('/activity')} onClick={(event) => void openPrivateWorkspace(event, stellarHref('/activity'))} aria-current={active === 'activity' ? 'page' : undefined} className={navClass(active === 'activity') + ' mst-rail-desktop'}>
              <History className="h-4 w-4 shrink-0" /><span>Activity</span>
            </a>
          </nav>

          <nav className="mst-rail-tools" aria-label="Tools">
            <div className="mst-rail-tools__label">Tools</div>
            <a href={stellarHref('/contracts')} className={navClass(active === 'contracts')} aria-current={active === 'contracts' ? 'page' : undefined}><Braces className="h-4 w-4 shrink-0" />Contracts</a>
            <a href={stellarHref('/treasury')} className={navClass(treasuryActive)} aria-current={treasuryActive ? 'page' : undefined}><Vault className="h-4 w-4 shrink-0" />Treasuries</a>
            <a href={stellarHref('/address-book')} className={navClass(addressBookActive)} aria-current={addressBookActive ? 'page' : undefined}><BookUser className="h-4 w-4 shrink-0" />Contacts</a>
            <a href={stellarHref('/agent-access')} className={navClass(active === 'agent-access')} aria-current={active === 'agent-access' ? 'page' : undefined}><Bot className="h-4 w-4 shrink-0" />Agent access</a>
          </nav>
          <div className="mst-rail-note">Shared authorization, one workspace.</div>
        </aside>
        <div className="mst-workspace-content">{children}</div>
      </div>
      <StellarFooter workspace />
    </div>
  );
}
