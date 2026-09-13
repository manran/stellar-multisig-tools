import type { StellarNetwork } from './types.js';

const TREASURY_STORAGE_PREFIX = 'multisig-tools.stellar.treasuries.v1';
const TREASURY_ONBOARDING_DISMISSED_PREFIX = 'multisig-tools.stellar.treasury-onboarding-dismissed.v1';

function storageKey(walletAddress: string, network: StellarNetwork) {
  return `${TREASURY_STORAGE_PREFIX}:${network}:${walletAddress}`;
}

/**
 * User preference only. These account IDs are accounts the wallet intentionally
 * added to its Treasury workspace; they do not grant signer authority and do
 * not imply the account still has shared signing control.
 */
export function loadAdoptedTreasuryAccountIds(
  storage: Pick<Storage, 'getItem'>,
  walletAddress: string,
  network: StellarNetwork,
): string[] {
  try {
    const raw = storage.getItem(storageKey(walletAddress, network));
    if (!raw) return [];
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.startsWith('G')))];
  } catch {
    return [];
  }
}

export function saveAdoptedTreasuryAccountIds(
  storage: Pick<Storage, 'setItem'>,
  walletAddress: string,
  network: StellarNetwork,
  accountIds: string[],
) {
  storage.setItem(storageKey(walletAddress, network), JSON.stringify([...new Set(accountIds)]));
}


function onboardingDismissedStorageKey(walletAddress: string, network: StellarNetwork) {
  return `${TREASURY_ONBOARDING_DISMISSED_PREFIX}:${network}:${walletAddress}`;
}

export function loadTreasuryOnboardingDismissed(
  storage: Pick<Storage, 'getItem'>,
  walletAddress: string,
  network: StellarNetwork,
): boolean {
  return storage.getItem(onboardingDismissedStorageKey(walletAddress, network)) === '1';
}

export function saveTreasuryOnboardingDismissed(
  storage: Pick<Storage, 'setItem'>,
  walletAddress: string,
  network: StellarNetwork,
) {
  storage.setItem(onboardingDismissedStorageKey(walletAddress, network), '1');
}
