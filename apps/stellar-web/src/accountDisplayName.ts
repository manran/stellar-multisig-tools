/** Stable, user-readable fallback until a personal nickname is saved. */
export function accountDisplayName(userId: string, nickname?: string | null): string {
  const custom = nickname?.trim();
  if (custom) return custom;
  return `MST-${userId.replaceAll('-', '').slice(0, 6).toUpperCase()}`;
}
