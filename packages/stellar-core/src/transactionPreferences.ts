export const DEFAULT_TRANSACTION_LIFETIME_SECONDS = 24 * 60 * 60;

export const TRANSACTION_LIFETIME_OPTIONS = [
  { seconds: 60 * 60, label: '1 hour', shortLabel: '1h' },
  { seconds: 24 * 60 * 60, label: '24 hours', shortLabel: '24h' },
  { seconds: 7 * 24 * 60 * 60, label: '7 days', shortLabel: '7d' },
] as const;

const STORAGE_KEY = 'multisig-tools.stellar.transaction-lifetime.v1';

export function isTransactionLifetimeSeconds(value: number): boolean {
  return TRANSACTION_LIFETIME_OPTIONS.some((option) => option.seconds === value);
}

export function getDefaultTransactionLifetime(storage: Pick<Storage, 'getItem'>): number {
  try {
    const value = Number(storage.getItem(STORAGE_KEY));
    return isTransactionLifetimeSeconds(value) ? value : DEFAULT_TRANSACTION_LIFETIME_SECONDS;
  } catch {
    return DEFAULT_TRANSACTION_LIFETIME_SECONDS;
  }
}

export function setDefaultTransactionLifetime(
  storage: Pick<Storage, 'setItem'>,
  seconds: number,
) {
  if (!isTransactionLifetimeSeconds(seconds)) {
    throw new Error('Unsupported transaction lifetime.');
  }
  storage.setItem(STORAGE_KEY, String(seconds));
}

export function transactionLifetimeLabel(seconds: number): string {
  return TRANSACTION_LIFETIME_OPTIONS.find((option) => option.seconds === seconds)?.label ?? `${seconds} seconds`;
}
