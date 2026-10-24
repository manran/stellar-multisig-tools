export function treasuryDisplayLabel(
  sharedTreasuryName: string | null | undefined,
  personalLabel: string | null | undefined,
): string {
  const shared = sharedTreasuryName?.trim() ?? '';
  const personal = personalLabel?.trim() ?? '';
  if (shared && personal && shared !== personal) return `${shared} (${personal})`;
  return shared || personal;
}
