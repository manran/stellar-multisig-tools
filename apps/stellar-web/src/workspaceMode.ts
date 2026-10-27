import type { StellarNetwork } from '../../../packages/stellar-core/src/types.js';
import { normalizedStellarWorkspacePath, stellarWorkspaceRouteForPath } from './workspaceRoutes.js';

export type WorkspaceMode = 'sign' | 'setup';

function storageKey(address: string, network: StellarNetwork) {
  return `multisig-tools.stellar.workspace-mode:${network}:${address}`;
}

function onboardingStorageKey(address: string) {
  return `multisig-tools.stellar.onboarding:v1:${address}`;
}

export function workspaceModeForExclusiveRoute(pathname: string): WorkspaceMode | null {
  return stellarWorkspaceRouteForPath(pathname)?.mode ?? null;
}

export function resolveWorkspaceMode(pathname: string, preferredMode: WorkspaceMode): WorkspaceMode {
  return workspaceModeForExclusiveRoute(pathname) ?? preferredMode;
}

export function workspaceHomePath(mode: WorkspaceMode): '/inbox' | '/treasury' {
  return mode === 'setup' ? '/treasury' : '/inbox';
}

export function onboardingModeDestination(mode: WorkspaceMode, pathname: string): '/inbox' | '/treasury' | null {
  if (mode === 'setup') return '/treasury';
  const routeMode = workspaceModeForExclusiveRoute(pathname);
  if (routeMode === 'setup' || normalizedStellarWorkspacePath(pathname) === '/') return '/inbox';
  return null;
}

export function getWorkspaceMode(
  address: string | null | undefined,
  network: StellarNetwork | null | undefined,
): WorkspaceMode {
  if (!address || !network || typeof window === 'undefined') return 'sign';
  try {
    return window.localStorage.getItem(storageKey(address, network)) === 'setup' ? 'setup' : 'sign';
  } catch {
    return 'sign';
  }
}

export function setWorkspaceMode(address: string, network: StellarNetwork, mode: WorkspaceMode) {
  try {
    window.localStorage.setItem(storageKey(address, network), mode);
  } catch {
    // Workspace mode is a UI preference. Storage failure must not block signing.
  }
}

export function hasSeenWorkspaceOnboarding(address: string | null | undefined) {
  if (!address || typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(onboardingStorageKey(address)) === 'done';
  } catch {
    return false;
  }
}

export function markWorkspaceOnboardingSeen(address: string) {
  try {
    window.localStorage.setItem(onboardingStorageKey(address), 'done');
  } catch {
    // Onboarding state is local-only. Storage failure may show it again next session.
  }
}
