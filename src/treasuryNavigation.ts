import type { StellarNetwork } from './stellar/types.js';
import { stellarHrefForLocation } from './workspaceNavigation.js';

export interface TreasuryRouteContext {
  accountId: string;
  network: StellarNetwork | null;
}

function withTreasuryContext(
  path: string,
  currentHref: string,
  accountId?: string,
  network?: StellarNetwork | null,
) {
  const url = new URL(stellarHrefForLocation(path, currentHref));
  if (accountId) url.searchParams.set('account', accountId);
  if (network) url.searchParams.set('network', network);
  return url.toString();
}

export function treasuryOverviewHrefForLocation(
  currentHref: string,
  accountId?: string,
  network?: StellarNetwork | null,
) {
  return withTreasuryContext('/treasury', currentHref, accountId, network);
}

export function treasuryActivityHrefForLocation(currentHref: string, accountId: string, network: StellarNetwork) {
  return withTreasuryContext('/treasury/activity', currentHref, accountId, network);
}

export function treasurySettingsHrefForLocation(currentHref: string, accountId: string, network: StellarNetwork) {
  return withTreasuryContext('/treasury/settings', currentHref, accountId, network);
}

export function treasurySigningHrefForLocation(
  currentHref: string,
  accountId: string,
  network: StellarNetwork,
  intent?: 'create-treasury',
) {
  const url = new URL(withTreasuryContext('/treasury/change-signing', currentHref, accountId, network));
  if (intent) url.searchParams.set('intent', intent);
  return url.toString();
}

export function treasurySigningBackHrefForLocation(
  currentHref: string,
  accountId: string,
  network: StellarNetwork,
  intent?: 'create-treasury',
) {
  return treasuryOverviewHrefForLocation(
    currentHref,
    intent === 'create-treasury' ? undefined : accountId,
    network,
  );
}

export function treasuryOverviewHref(accountId?: string, network?: StellarNetwork | null) {
  return treasuryOverviewHrefForLocation(window.location.href, accountId, network);
}

export function treasuryActivityHref(accountId: string, network: StellarNetwork) {
  return treasuryActivityHrefForLocation(window.location.href, accountId, network);
}

export function treasurySettingsHref(accountId: string, network: StellarNetwork) {
  return treasurySettingsHrefForLocation(window.location.href, accountId, network);
}

export function treasurySigningHref(accountId: string, network: StellarNetwork, intent?: 'create-treasury') {
  return treasurySigningHrefForLocation(window.location.href, accountId, network, intent);
}

export function parseTreasuryRoute(search: string): TreasuryRouteContext {
  const params = new URLSearchParams(search);
  const accountId = params.get('account')?.trim() ?? '';
  const networkValue = params.get('network');
  const network = networkValue === 'public' || networkValue === 'testnet' ? networkValue : null;
  return { accountId, network };
}
