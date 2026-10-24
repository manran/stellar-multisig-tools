import { STELLAR_MAINNET_ORIGIN } from '../../../packages/stellar-core/src/deploymentOrigins.js';
import { isStellarWorkspaceHost, normalizedStellarWorkspacePath } from './workspaceRoutes.js';

export const WORKSPACE_NAVIGATION_EVENT = 'multisig-tools:workspace-navigate';

const WORKSPACE_DOCUMENT_STATE_KEY = '__multisigToolsDocumentId';
const WORKSPACE_DOCUMENT_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Internal call-site aliases only. Public route matching is defined separately in
// workspaceRoutes.ts and intentionally does not accept these retired URL paths.
export function canonicalStellarPath(path: string) {
  if (path === '/request') return '/s';
  if (path === '/account' || path === '/accounts') return '/treasury';
  if (path === '/signers') return '/address-book';
  if (path === '/designer') return '/treasury/change-signing';
  return path;
}

export function stellarHrefForLocation(path: string, currentHref: string) {
  const url = new URL(currentHref);
  const prefix = isStellarWorkspaceHost(url.hostname) ? '' : '/stellar';
  const publicPath = canonicalStellarPath(path);
  url.pathname = `${prefix}${publicPath}` || '/';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function stellarHref(path: string) {
  return stellarHrefForLocation(path, window.location.href);
}

export function canonicalStellarRuntimeLocationForLocation(currentHref: string) {
  const current = new URL(currentHref);
  if (!isStellarWorkspaceHost(current.hostname)) return null;
  if (current.pathname !== '/stellar' && !current.pathname.startsWith('/stellar/')) return null;
  current.pathname = normalizedStellarWorkspacePath(current.pathname);
  return current.toString();
}

export function canonicalStellarContentHref(path: string) {
  const url = new URL(STELLAR_MAINNET_ORIGIN);
  url.pathname = canonicalStellarPath(path) || '/';
  return url.toString();
}

export function canonicalStellarContentLocationForLocation(currentHref: string) {
  const current = new URL(currentHref);
  const canonical = new URL(STELLAR_MAINNET_ORIGIN);
  canonical.pathname = normalizedStellarWorkspacePath(current.pathname);
  canonical.search = current.search;
  canonical.hash = current.hash;
  return canonical.toString();
}

export function stellarHrefWithSearchForLocation(
  path: string,
  currentHref: string,
  params: Record<string, string | null | undefined>,
) {
  const url = new URL(stellarHrefForLocation(path, currentHref));
  for (const [name, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(name, value);
  }
  return url.toString();
}

export function stellarHrefWithSearch(
  path: string,
  params: Record<string, string | null | undefined>,
) {
  return stellarHrefWithSearchForLocation(path, window.location.href, params);
}

export function isCurrentWorkspaceNavigationState(state: unknown) {
  if (!state || typeof state !== 'object') return false;
  return (state as Record<string, unknown>)[WORKSPACE_DOCUMENT_STATE_KEY] === WORKSPACE_DOCUMENT_ID;
}

interface WorkspaceNavigationOptions {
  replace?: boolean;
  hash?: string;
  search?: string;
  state?: unknown;
}

export function navigateWorkspace(path: string, options?: WorkspaceNavigationOptions) {
  const url = new URL(stellarHref(path));
  if (options?.search) url.search = options.search.startsWith('?') ? options.search : `?${options.search}`;
  if (options?.hash) url.hash = options.hash.startsWith('#') ? options.hash : `#${options.hash}`;
  const providedState = options?.state;
  const state = {
    ...(providedState && typeof providedState === 'object' ? providedState as Record<string, unknown> : {}),
    [WORKSPACE_DOCUMENT_STATE_KEY]: WORKSPACE_DOCUMENT_ID,
  };
  if (options?.replace) window.history.replaceState(state, '', url);
  else window.history.pushState(state, '', url);
  window.dispatchEvent(new Event(WORKSPACE_NAVIGATION_EVENT));
}
