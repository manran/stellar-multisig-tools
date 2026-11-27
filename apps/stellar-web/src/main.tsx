import { Component as ReactComponent, lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { AddressBookProvider } from './AddressBookContext';
import { ContractWorkspaceProvider } from './ContractWorkspaceContext';
import StellarHomeApp from './StellarHomeApp';
import { StellarWalletProvider } from './StellarWalletContext';
import { canonicalStellarRuntimeLocationForLocation, navigateWorkspace, WORKSPACE_NAVIGATION_EVENT } from './workspaceNavigation';
import { stellarWorkspaceRouteForPath } from './workspaceRoutes';
import type { StellarWorkspaceRouteKind } from './workspaceRoutes';

const AgentAccessApp = lazy(() => import('./AgentAccessApp'));
const ActivityApp = lazy(() => import('./ActivityApp'));
const AddressBookApp = lazy(() => import('./AddressBookApp'));
const AccountSigningEntryApp = lazy(() => import('./AccountSigningEntryApp'));
const ContractsApp = lazy(() => import('./ContractsApp'));
const ContractWorkspaceApp = lazy(() => import('./ContractWorkspaceApp'));
const DemoTreasuryApp = lazy(() => import('./DemoTreasuryApp'));
const InboxEntryApp = lazy(() => import('./InboxEntryApp'));
const IntegrationAdminApp = lazy(() => import('./IntegrationAdminApp'));
const TestnetIntegrationApp = lazy(() => import('./TestnetIntegrationApp'));
const LegalApp = lazy(() => import('./LegalApp'));
const MultisigDesignerApp = lazy(() => import('./MultisigDesignerApp'));
const NewTransactionApp = lazy(() => import('./NewTransactionApp'));
const RequestApp = lazy(() => import('./RequestApp'));
const SigningRoomApp = lazy(() => import('./SigningRoomApp'));
const SorobanIntentApp = lazy(() => import('./SorobanIntentApp'));
const TreasuryApp = lazy(() => import('./TreasuryApp'));
const TemplatesApp = lazy(() => import('./TemplatesApp'));
const TreasuryBoxSettingsApp = lazy(() => import('./TreasuryBoxSettingsApp'));
const TransactionReceiptApp = lazy(() => import('./TransactionReceiptApp'));

interface RouteMatch {
  kind: StellarWorkspaceRouteKind | 'not-found';
  redirectTo?: string;
}

function routeFor(pathname: string): RouteMatch {
  const matched = stellarWorkspaceRouteForPath(pathname);
  if (matched) return { kind: matched.kind };
  return { kind: 'not-found' };
}

function titleFor(kind: RouteMatch['kind']) {
  switch (kind) {
    case 'not-found': return 'Page not found | MultiSig Tools';
    case 'home': return 'MultiSig Tools for Stellar | Shared authorization without shared custody';
    case 'demo': return 'Interactive Demo | MultiSig Tools';
    case 'inbox': return 'Inbox | MultiSig Tools';
    case 'new': return 'New proposal | MultiSig Tools';
    case 'templates': return 'Templates | MultiSig Tools';
    case 'contracts': return 'Contracts | MultiSig Tools';
    case 'contract-workspace': return 'Contract Workspace | MultiSig Tools';
    case 'account-signing': return 'Set up multisig | MultiSig Tools';
    case 'treasury': return 'Treasury | MultiSig Tools';
    case 'treasury-settings': return 'Treasury settings | MultiSig Tools';
    case 'bootstrap': return 'Set up multisig offline | MultiSig Tools';
    case 'address-book': return 'Contacts | MultiSig Tools';
    case 'agent-access': return 'Agent access | MultiSig Tools';
    case 'activity': return 'Activity | MultiSig Tools';
    case 'request': return 'Transaction | MultiSig Tools';
    case 'authorization': return 'Contract authorization | MultiSig Tools';
    case 'receipt': return 'Transaction receipt | MultiSig Tools';
    case 'signing-room': return 'Review transaction | MultiSig Tools';
    case 'designer': return 'Change account signing | MultiSig Tools';
    case 'legal': return 'Legal | MultiSig Tools';
    case 'integration-admin': return 'Integration administration | MultiSig Tools';
    case 'integration-self-service': return 'Create Testnet Integration | MultiSig Tools';
  }
}

function currentLocationKey() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function RouteLoading() {
  return <main className="mx-auto max-w-4xl px-6 py-16"><p role="status" className="text-sm text-[var(--color-muted)]">Loading page...</p></main>;
}

// Failed chunk loads (for example after a deploy while a tab was open) must
// not leave a blank screen. Do not silently restart a signing workflow.
class RouteLoadBoundary extends ReactComponent<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="mx-auto max-w-xl px-6 py-16"><h1 className="text-3xl font-bold">Unable to open this page</h1><p className="mt-3 text-[var(--color-ink-2)]">Reload the page to try again.</p><button type="button" className="mst-action-primary mt-6" onClick={() => window.location.reload()}>Reload page</button></main>;
    return this.props.children;
  }
}

function RoutedApp() {
  const [locationKey, setLocationKey] = useState(currentLocationKey);
  const [, setNavigationRevision] = useState(0);
  const route = routeFor(window.location.pathname);
  useEffect(() => {
    const syncLocation = () => {
      setLocationKey(currentLocationKey());
      setNavigationRevision((value) => value + 1);
    };
    const handleDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (anchor.getAttribute('href')?.startsWith('#') && url.pathname === window.location.pathname) return;
      if (!stellarWorkspaceRouteForPath(url.pathname)) return;

      event.preventDefault();
      window.history.pushState({}, '', url);
      syncLocation();
      window.scrollTo({ top: 0, left: 0 });
    };

    window.addEventListener('popstate', syncLocation);
    window.addEventListener('hashchange', syncLocation);
    window.addEventListener(WORKSPACE_NAVIGATION_EVENT, syncLocation);
    document.addEventListener('click', handleDocumentClick);
    return () => {
      window.removeEventListener('popstate', syncLocation);
      window.removeEventListener('hashchange', syncLocation);
      window.removeEventListener(WORKSPACE_NAVIGATION_EVENT, syncLocation);
      document.removeEventListener('click', handleDocumentClick);
    };
  }, []);

  useEffect(() => {
    document.title = titleFor(route.kind);
  }, [locationKey, route.kind]);

  useEffect(() => {
    if (route.redirectTo === undefined) return;
    navigateWorkspace(route.redirectTo, { replace: true });
  }, [locationKey, route.redirectTo]);

  if (route.redirectTo !== undefined) return null;
  if (route.kind === 'not-found') return <main className="mx-auto max-w-xl px-6 py-16"><h1 className="text-3xl font-bold">Page not found</h1><p className="mt-4">This page does not exist.</p><a className="mst-action-primary mt-6 inline-flex" href="/">Return to home</a></main>;
  if (route.kind === 'demo') return <RouteLoadBoundary key={locationKey}><Suspense fallback={<RouteLoading />}><DemoTreasuryApp /></Suspense></RouteLoadBoundary>;

  let Component;
  switch (route.kind) {
    case 'home': Component = StellarHomeApp; break;
    case 'inbox': Component = InboxEntryApp; break;
    case 'new': Component = NewTransactionApp; break;
    case 'templates': Component = TemplatesApp; break;
    case 'contracts': Component = ContractsApp; break;
    case 'contract-workspace': Component = ContractWorkspaceApp; break;
    case 'account-signing': Component = AccountSigningEntryApp; break;
    case 'treasury': Component = TreasuryApp; break;
    case 'treasury-settings': Component = TreasuryBoxSettingsApp; break;
    case 'bootstrap': Component = AccountSigningEntryApp; break;
    case 'address-book': Component = AddressBookApp; break;
    case 'agent-access': Component = AgentAccessApp; break;
    case 'activity': Component = ActivityApp; break;
    case 'request': Component = RequestApp; break;
    case 'authorization': Component = SorobanIntentApp; break;
    case 'receipt': Component = TransactionReceiptApp; break;
    case 'signing-room': Component = SigningRoomApp; break;
    case 'designer': Component = MultisigDesignerApp; break;
    case 'legal': Component = LegalApp; break;
    case 'integration-admin': Component = IntegrationAdminApp; break;
    case 'integration-self-service': Component = TestnetIntegrationApp; break;
  }

  return (
    <StellarWalletProvider>
      <ContractWorkspaceProvider>
        <AddressBookProvider>
          <RouteLoadBoundary key={route.kind}>
            <Suspense fallback={<RouteLoading />}>
              <Component key={route.kind === 'request' || route.kind === 'authorization' || route.kind === 'receipt' || route.kind === 'contract-workspace' || route.kind === 'new' ? locationKey : route.kind} />
            </Suspense>
          </RouteLoadBoundary>
        </AddressBookProvider>
      </ContractWorkspaceProvider>
    </StellarWalletProvider>
  );
}

const canonicalRuntimeLocation = canonicalStellarRuntimeLocationForLocation(window.location.href);
if (canonicalRuntimeLocation) window.history.replaceState(window.history.state, '', canonicalRuntimeLocation);

const savedTheme = localStorage.getItem('theme');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
if (savedTheme === 'dark' || (!savedTheme && prefersDark)) document.documentElement.classList.add('dark');
document.documentElement.classList.add('stellar-ui');

createRoot(document.getElementById('root')!).render(
  <StrictMode><RoutedApp /></StrictMode>,
);
