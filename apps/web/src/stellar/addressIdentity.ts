export interface AddressLabelCandidate {
  address: string;
  label: string;
  createdAt: string;
  updatedAt: string;
}

export function preferredAddressEntry<T extends AddressLabelCandidate>(entries: T[], address: string): T | null {
  let preferred: T | null = null;
  for (const entry of entries) {
    if (entry.address !== address) continue;
    if (!preferred) {
      preferred = entry;
      continue;
    }
    const byUpdated = entry.updatedAt.localeCompare(preferred.updatedAt);
    if (byUpdated > 0 || (byUpdated === 0 && entry.createdAt.localeCompare(preferred.createdAt) > 0)) {
      preferred = entry;
    }
  }
  return preferred;
}

export function preferredAddressLabel(entries: AddressLabelCandidate[], address: string): string {
  return preferredAddressEntry(entries, address)?.label ?? '';
}
