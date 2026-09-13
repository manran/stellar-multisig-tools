import type { StellarAccountSnapshot } from './types.js';

export type TreasuryRelationshipKind = 'personal_account' | 'suggested_treasury' | 'other_controlled';

function activeSigners(account: StellarAccountSnapshot) {
  return account.signers.filter((signer) => signer.weight > 0);
}

/**
 * Chain-derived capability only. This does not mean the user has added the
 * account to the Treasury workspace; it means the current account policy has
 * more than one active signer. Approval thresholds are a separate fact, so
 * 1-of-2 still qualifies under the existing product rule.
 */
export function hasSharedSigningControl(account: StellarAccountSnapshot): boolean {
  return activeSigners(account).length >= 2;
}

/**
 * Product projection from live Stellar account state. This is a suggestion / relationship
 * classification, not persisted Treasury workspace membership.
 */
export function classifyTreasuryRelationship(
  account: StellarAccountSnapshot,
  walletAddress: string,
): TreasuryRelationshipKind {
  const active = activeSigners(account);
  const master = active.find((signer) => signer.key === account.accountId);
  const additional = active.filter((signer) => signer.key !== account.accountId);
  const obviousMultisig = hasSharedSigningControl(account)
    || additional.length > 0 && (account.thresholds.medium > 1 || account.thresholds.high > 1);

  if (obviousMultisig) return 'suggested_treasury';

  const personalSingleSig = account.accountId === walletAddress
    && Boolean(master)
    && additional.length === 0
    && account.thresholds.medium <= (master?.weight ?? 0)
    && account.thresholds.high <= (master?.weight ?? 0);

  return personalSingleSig ? 'personal_account' : 'other_controlled';
}
