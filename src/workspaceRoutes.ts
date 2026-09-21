export type WorkspaceRouteMode = 'sign' | 'setup' | null;
export type StellarActivityScope = 'personal' | 'treasury';

export type StellarWorkspaceRouteKind =
  | 'home'
  | 'demo'
  | 'inbox'
  | 'new'
  | 'contracts'
  | 'contract-workspace'
  | 'account-signing'
  | 'treasury'
  | 'treasury-settings'
  | 'bootstrap'
  | 'address-book'
  | 'agent-access'
  | 'activity'
  | 'request'
  | 'authorization'
  | 'receipt'
  | 'signing-room'
  | 'designer'
  | 'docs'
  | 'legal'
  | 'integration-admin'
  | 'integration-self-service';

export interface StellarWorkspaceRoute {
  path: string;
  kind: StellarWorkspaceRouteKind;
  mode: WorkspaceRouteMode;
}

export const CANONICAL_STELLAR_ROUTES = [
  { path: '/', kind: 'home', mode: null },
  { path: '/demo', kind: 'demo', mode: null },
  { path: '/inbox', kind: 'inbox', mode: 'sign' },
  { path: '/new', kind: 'new', mode: null },
  { path: '/new/payment', kind: 'new', mode: null },
  { path: '/new/create-account', kind: 'new', mode: null },
  { path: '/new/batch', kind: 'new', mode: null },
  { path: '/new/claimable', kind: 'new', mode: null },
  { path: '/new/multi-party', kind: 'new', mode: null },
  { path: '/new/contract', kind: 'new', mode: null },
  { path: '/new/import', kind: 'new', mode: null },
  { path: '/contracts', kind: 'contracts', mode: null },
  { path: '/contract', kind: 'contract-workspace', mode: null },
  { path: '/account/signing', kind: 'account-signing', mode: 'setup' },
  { path: '/account/signing/edit', kind: 'designer', mode: 'setup' },
  { path: '/activity', kind: 'activity', mode: 'sign' },
  { path: '/address-book', kind: 'address-book', mode: 'sign' },
  { path: '/agent-access', kind: 'agent-access', mode: 'sign' },
  { path: '/treasury', kind: 'treasury', mode: 'setup' },
  { path: '/treasury/activity', kind: 'activity', mode: 'setup' },
  { path: '/treasury/settings', kind: 'treasury-settings', mode: 'setup' },
  { path: '/treasury/bootstrap', kind: 'bootstrap', mode: 'setup' },
  { path: '/treasury/change-signing', kind: 'designer', mode: 'setup' },
  { path: '/s', kind: 'request', mode: null },
  { path: '/a', kind: 'authorization', mode: null },
  { path: '/receipt', kind: 'receipt', mode: null },
  { path: '/signing-room', kind: 'signing-room', mode: null },
  { path: '/docs', kind: 'docs', mode: null },
  { path: '/developers', kind: 'docs', mode: null },
  { path: '/privacy', kind: 'legal', mode: null },
  { path: '/terms', kind: 'legal', mode: null },
  { path: '/admin/integrations', kind: 'integration-admin', mode: null },
  { path: '/developers/integrations/new', kind: 'integration-self-service', mode: null },
] as const satisfies readonly StellarWorkspaceRoute[];

export function isStellarWorkspaceHost(hostname: string) {
  return hostname === 'stellar.multisig.tools' || hostname === 'stellar-testnet.multisig.tools';
}

export function normalizedStellarWorkspacePath(pathname: string) {
  let path = pathname;
  if (path === '/stellar') path = '/';
  else if (path.startsWith('/stellar/')) path = path.slice('/stellar'.length);
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path || '/';
}

export function isCanonicalStellarContentPath(pathname: string) {
  const path = normalizedStellarWorkspacePath(pathname);
  return path === '/demo'
    || path === '/docs'
    || path.startsWith('/docs/')
    || path === '/developers'
    || path === '/privacy'
    || path === '/terms';
}

export function stellarWorkspaceRouteForPath(pathname: string): StellarWorkspaceRoute | null {
  const path = normalizedStellarWorkspacePath(pathname);
  const exact = CANONICAL_STELLAR_ROUTES.find((route) => route.path === path);
  if (exact) return exact;
  if (path.startsWith('/docs/')) return { path, kind: 'docs', mode: null };
  return null;
}

export function stellarActivityScopeForPath(pathname: string): StellarActivityScope | null {
  const path = normalizedStellarWorkspacePath(pathname);
  if (path === '/activity') return 'personal';
  if (path === '/treasury/activity') return 'treasury';
  return null;
}
