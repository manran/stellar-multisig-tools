import { Claimant, Operation } from '@stellar/stellar-sdk/base';
import type { PaymentAssetChoice } from '../../packages/stellar-core/src/paymentAsset.js';
import { stellarAssetForChoice } from '../../packages/stellar-core/src/paymentAsset.js';
import { assessPaymentSpendability, paymentSourceIssue } from '../../packages/stellar-core/src/paymentPreflight.js';
import type { StellarNetworkParameters } from '../../packages/stellar-core/src/horizon.js';
import type { StellarAccountSnapshot } from '../../packages/stellar-core/src/types.js';

export interface ClaimWindowOption {
  seconds: number;
  label: string;
}

export const CLAIM_WINDOW_OPTIONS: readonly ClaimWindowOption[] = [
  { seconds: 7 * 24 * 60 * 60, label: '7 days' },
  { seconds: 30 * 24 * 60 * 60, label: '30 days' },
  { seconds: 90 * 24 * 60 * 60, label: '90 days' },
];

export const DEFAULT_CLAIM_WINDOW_SECONDS = 30 * 24 * 60 * 60;
export const CLAIMABLE_RECOVERY_CLAIMANT_COUNT = 2;
export const CLAIMABLE_RECOVERY_RESERVE_UNITS = CLAIMABLE_RECOVERY_CLAIMANT_COUNT + 1;

export function claimWindowLabel(seconds: number): string {
  return CLAIM_WINDOW_OPTIONS.find((option) => option.seconds === seconds)?.label
    ?? `${seconds} seconds`;
}

export function claimableSourceIssue(
  account: StellarAccountSnapshot,
  asset: PaymentAssetChoice,
  amount: string,
  parameters: StellarNetworkParameters,
): string | null {
  const spendability = assessPaymentSpendability(
    account,
    asset,
    parameters,
    1,
    CLAIMABLE_RECOVERY_RESERVE_UNITS,
    true,
  );
  const issue = paymentSourceIssue(spendability, asset, amount);
  if (!issue) return null;
  if (!spendability.feeCovered) {
    return 'This treasury does not have enough spendable XLM to create the recoverable claimable balance, preserve its balance-and-claimant reserves, and pay the network fee.';
  }
  if (!asset.issuer) {
    return `Only ${spendability.assetAvailable} XLM is currently available after preserving the claimable balance entry, its two claimant reserves, and the network fee.`;
  }
  return issue;
}

export function createRecoverableClaimableBalanceOperation({
  source,
  destination,
  asset,
  amount,
  claimWindowSeconds,
}: {
  source: string;
  destination: string;
  asset: PaymentAssetChoice;
  amount: string;
  claimWindowSeconds: number;
}) {
  if (!Number.isSafeInteger(claimWindowSeconds) || claimWindowSeconds <= 0) {
    throw new Error('Claim window must be a positive number of seconds.');
  }
  const beforeDeadline = Claimant.predicateBeforeRelativeTime(String(claimWindowSeconds));
  return Operation.createClaimableBalance({
    source,
    asset: stellarAssetForChoice(asset),
    amount,
    claimants: [
      new Claimant(destination, beforeDeadline),
      new Claimant(source, Claimant.predicateNot(Claimant.predicateBeforeRelativeTime(String(claimWindowSeconds)))),
    ],
  });
}
