export type UnlockDurationSeconds = 900 | 3600 | 28800;

export const DEFAULT_UNLOCK_DURATION_SECONDS: UnlockDurationSeconds = 3600;

export const UNLOCK_DURATION_OPTIONS = [
  { seconds: 15 * 60 as UnlockDurationSeconds, label: '15 minutes', shortLabel: '15m' },
  { seconds: 60 * 60 as UnlockDurationSeconds, label: '1 hour', shortLabel: '1h' },
  { seconds: 8 * 60 * 60 as UnlockDurationSeconds, label: '8 hours', shortLabel: '8h' },
] as const;

const STORAGE_KEY = 'multisig-tools.stellar.unlock-duration.v1';

export function isUnlockDurationSeconds(value: number): value is UnlockDurationSeconds {
  return UNLOCK_DURATION_OPTIONS.some((option) => option.seconds === value);
}

export function getDefaultUnlockDuration(storage: Pick<Storage, 'getItem'>): UnlockDurationSeconds {
  try {
    const value = Number(storage.getItem(STORAGE_KEY));
    return isUnlockDurationSeconds(value) ? value : DEFAULT_UNLOCK_DURATION_SECONDS;
  } catch {
    return DEFAULT_UNLOCK_DURATION_SECONDS;
  }
}

export function setDefaultUnlockDuration(
  storage: Pick<Storage, 'setItem'>,
  seconds: number,
) {
  if (!isUnlockDurationSeconds(seconds)) {
    throw new Error('Unsupported unlock duration.');
  }
  storage.setItem(STORAGE_KEY, String(seconds));
}

export function unlockDurationLabel(seconds: number): string {
  return UNLOCK_DURATION_OPTIONS.find((option) => option.seconds === seconds)?.label ?? `${seconds} seconds`;
}
