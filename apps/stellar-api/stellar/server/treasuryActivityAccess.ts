import type { StellarAccountSnapshot } from '../../../../packages/stellar-core/src/types.js';

export function canViewTreasuryActivity(
  account: StellarAccountSnapshot,
  address: string,
): boolean {
  const normalized = address.trim();
  return account.signers.some((signer) => signer.weight > 0 && signer.key === normalized);
}
