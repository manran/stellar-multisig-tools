import { StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import AgentAccessApp from './AgentAccessApp';
import ActivityApp from './ActivityApp';
import AddressBookApp from './AddressBookApp';
import { AddressBookProvider } from './AddressBookContext';
import AccountSigningEntryApp from './AccountSigningEntryApp';
import ContractsApp from './ContractsApp';
import ContractWorkspaceApp from './ContractWorkspaceApp';
import { ContractWorkspaceProvider } from './ContractWorkspaceContext';
import DemoTreasuryApp from './DemoTreasuryApp';
import DocsApp from './DocsApp';
import InboxEntryApp from './InboxEntryApp';
import IntegrationAdminApp from './IntegrationAdminApp';
import TestnetIntegrationApp from './TestnetIntegrationApp';
import LegalApp from './LegalApp';
import MultisigDesignerApp from './MultisigDesignerApp';
import NewTransactionApp from './NewTransactionApp';
import RequestApp from './RequestApp';
import SigningRoomApp from './SigningRoomApp';
import SorobanIntentApp from './SorobanIntentApp';
import StellarHomeApp from './StellarHomeApp';
import { StellarWalletProvider } from './StellarWalletContext';
import TreasuryApp from './TreasuryApp';
import TreasuryBoxSettingsApp from './TreasuryBoxSettingsApp';
import TransactionReceiptApp from './TransactionReceiptApp';
import { canonicalStellarContentLocationForLocation, canonicalStellarRuntimeLocationForLocation, navigateWorkspace, WORKSPACE_NAVIGATION_EVENT } from './workspaceNavigation';
import { fixedClientStellarDeploymentNetwork } from './stellar/deploymentNetwork';
import { isCanonicalStellarContentPath, isStellarWorkspaceHost, stellarWorkspaceRouteForPath } from './workspaceRoutes';
import type { StellarWorkspaceRouteKind } from './workspaceRoutes';

const App = lazy(() => import('./App.tsx'));

type RouteKind = 'directory' | StellarWorkspaceRouteKind;

interface RouteMatch {
  kind: RouteKind;
  isStellar: boolean;
  redirectTo?: string;
}

function routeFor(pathname: string, hostname = window.location.hostname): RouteMatch {
  const isStellarHost = isStellarWorkspaceHost(hostname);
  const isStellarPath = isStellarHost || pathname === '/stellar' || pathname.startsWith('/stellar/');
  if (!isStellarPath) return { kind: 'directory', isStellar: false };

  const matched = stellarWorkspaceRouteForPath(pathname);
  if (matched) return { kind: matched.kind, isStellar: true };

  return { kind: 'inbox', isStellar: true, redirectTo: '' };
}

function titleFor(kind: RouteKind) {
  switch (kind) {
    case 'home': return 'MultiSig Tools for Stellar | Shared authorization without shared custody';
    case 'demo': return 'Interactive Demo | MultiSig Tools';
    case 'inbox': return 'Inbox | MultiSig Tools';
    case 'new': return 'New transaction | MultiSig Tools';
    case 'contracts': return 'Contracts | MultiSig Tools';
    case 'contract-workspace': return 'Contract Workspace | MultiSig Tools';
    case 'account-signing': return 'Set up multisig | MultiSig Tools';
    case 'treasury': return 'Treasury | MultiSig Tools';
    case 'treasury-settings': return 'Treasury settings | MultiSig Tools';
    case 'bootstrap': return 'Set up multisig offline | MultiSig Tools';
    case 'address-book': return 'Address Book | MultiSig Tools';
    case 'agent-access': return 'Agent access | MultiSig Tools';
    case 'activity': return 'Activity | MultiSig Tools';
    case 'request': return 'Transaction | MultiSig Tools';
    case 'authorization': return 'Contract authorization | MultiSig Tools';
    case 'receipt': return 'Transaction receipt | MultiSig Tools';
    case 'signing-room': return 'Review transaction | MultiSig Tools';
    case 'designer': return 'Change account signing | MultiSig Tools';
    case 'docs': return 'Docs | MultiSig Tools';
    case 'legal': return 'Legal | MultiSig Tools';
    case 'integration-admin': return 'Integration administration | MultiSig Tools';
    case 'integration-self-service': return 'Create Testnet Integration | MultiSig Tools';
    default: return 'MultiSig Tools - The Ultimate Directory for Multi-Signature Solutions';
  }
}

function currentLocationKey() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function RoutedApp() {
  const [locationKey, setLocationKey] = useState(currentLocationKey);
  const [, setNavigationRevision] = useState(0);
  const route = routeFor(window.location.pathname);
  const canonicalContentRedirect = fixedClientStellarDeploymentNetwork() === 'testnet'
    && isCanonicalStellarContentPath(window.location.pathname)
    ? canonicalStellarContentLocationForLocation(window.location.href)
    : null;

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
      if (!routeFor(url.pathname, url.hostname).isStellar) return;

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
    if (!canonicalContentRedirect) return;
    window.location.replace(canonicalContentRedirect);
  }, [canonicalContentRedirect, locationKey]);

  useEffect(() => {
    document.documentElement.classList.toggle('stellar-ui', route.isStellar);
    if (route.kind !== 'docs') document.title = titleFor(route.kind);
  }, [locationKey, route.isStellar, route.kind]);

  useEffect(() => {
    if (route.redirectTo === undefined) return;
    navigateWorkspace(route.redirectTo, { replace: true });
  }, [locationKey, route.redirectTo]);

  if (canonicalContentRedirect) return null;

  if (!route.isStellar) {
    return (
      <Suspense fallback={null}>
        <App />
      </Suspense>
    );
  }

  if (route.redirectTo !== undefined) return null;

  if (route.kind === 'demo') return <DemoTreasuryApp />;

  let Component;
  switch (route.kind) {
    case 'home': Component = StellarHomeApp; break;
    case 'inbox': Component = InboxEntryApp; break;
    case 'new': Component = NewTransactionApp; break;
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
    case 'docs': Component = DocsApp; break;
    case 'legal': Component = LegalApp; break;
    case 'integration-admin': Component = IntegrationAdminApp; break;
    case 'integration-self-service': Component = TestnetIntegrationApp; break;
    default: Component = InboxEntryApp;
  }

  return (
    <StellarWalletProvider>
      <ContractWorkspaceProvider>
        <AddressBookProvider>
          <Component key={route.kind === 'request' || route.kind === 'authorization' || route.kind === 'receipt' || route.kind === 'contract-workspace' ? locationKey : route.kind} />
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
if (routeFor(window.location.pathname).isStellar) document.documentElement.classList.add('stellar-ui');

createRoot(document.getElementById('root')!).render(
  <StrictMode><RoutedApp /></StrictMode>,
);
