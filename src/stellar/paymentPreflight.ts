import type { StellarNetworkParameters } from './horizon.js';
import type { PaymentAssetChoice } from './paymentAsset.js';
import { stellarAmountToStroops, stroopsToStellarAmount } from './reserve.js';
import type { StellarAccountSnapshot } from './types.js';

export interface PaymentSpendability {
  assetAvailableStroops: bigint;
  assetAvailable: string;
  feeStroops: bigint;
  feeCovered: boolean;
  minimumBalanceStroops: bigint;
  nativeHeadroomBeforeFeeStroops: bigint;
  sourceAuthorized: boolean;
}

function nonNegative(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

function reserveUnits(account: StellarAccountSnapshot): number {
  const units = 2 + account.subentryCount + account.numSponsoring - account.numSponsored;
  if (!Number.isSafeInteger(units) || units < 0) {
    throw new Error('Account reserve metadata is inconsistent.');
  }
  return units;
}

function validateNetworkParameters(parameters: StellarNetworkParameters, operationCount: number, addedReserveUnits: number) {
  if (!Number.isSafeInteger(parameters.baseReserveInStroops) || parameters.baseReserveInStroops <= 0) {
    throw new Error('Network base reserve is invalid.');
  }
  if (!Number.isSafeInteger(parameters.baseFeeInStroops) || parameters.baseFeeInStroops < 0) {
    throw new Error('Network base fee is invalid.');
  }
  if (!Number.isSafeInteger(operationCount) || operationCount < 1) {
    throw new Error('Payment operation count must be a positive integer.');
  }
  if (!Number.isSafeInteger(addedReserveUnits) || addedReserveUnits < 0) {
    throw new Error('Additional reserve units must be a non-negative integer.');
  }
}

export function assessPaymentSpendability(
  account: StellarAccountSnapshot,
  choice: PaymentAssetChoice,
  parameters: StellarNetworkParameters,
  operationCount = 1,
  addedReserveUnits = 0,
  paysTransactionFee = true,
): PaymentSpendability {
  validateNetworkParameters(parameters, operationCount, addedReserveUnits);
  if (account.nativeBalance === undefined || account.nativeSellingLiabilities === undefined) {
    throw new Error('Native XLM balance data is unavailable for payment preflight.');
  }

  const baseReserve = BigInt(parameters.baseReserveInStroops);
  const minimumBalanceStroops = BigInt(reserveUnits(account) + addedReserveUnits) * baseReserve;
  const nativeBalanceStroops = stellarAmountToStroops(account.nativeBalance);
  const nativeSellingLiabilitiesStroops = stellarAmountToStroops(account.nativeSellingLiabilities);
  const nativeHeadroomBeforeFeeStroops = nativeBalanceStroops
    - nativeSellingLiabilitiesStroops
    - minimumBalanceStroops;
  const feeStroops = paysTransactionFee
    ? BigInt(operationCount) * BigInt(parameters.baseFeeInStroops)
    : 0n;
  const feeCovered = nativeHeadroomBeforeFeeStroops >= feeStroops;

  if (!choice.issuer) {
    const assetAvailableStroops = nonNegative(nativeHeadroomBeforeFeeStroops - feeStroops);
    return {
      assetAvailableStroops,
      assetAvailable: stroopsToStellarAmount(assetAvailableStroops),
      feeStroops,
      feeCovered,
      minimumBalanceStroops,
      nativeHeadroomBeforeFeeStroops,
      sourceAuthorized: true,
    };
  }

  const trustline = account.balances?.find((balance) =>
    (balance.assetType === 'credit_alphanum4' || balance.assetType === 'credit_alphanum12')
    && balance.assetCode === choice.code
    && balance.assetIssuer === choice.issuer,
  );
  if (!trustline) throw new Error('The selected asset is no longer available in this treasury.');

  const sourceAuthorized = trustline.authorized !== false;
  const creditHeadroom = stellarAmountToStroops(trustline.balance)
    - stellarAmountToStroops(trustline.sellingLiabilities);
  const assetAvailableStroops = sourceAuthorized ? nonNegative(creditHeadroom) : 0n;

  return {
    assetAvailableStroops,
    assetAvailable: stroopsToStellarAmount(assetAvailableStroops),
    feeStroops,
    feeCovered,
    minimumBalanceStroops,
    nativeHeadroomBeforeFeeStroops,
    sourceAuthorized,
  };
}

export function paymentSourceIssue(
  spendability: PaymentSpendability,
  choice: PaymentAssetChoice,
  amount: string,
): string | null {
  if (!spendability.sourceAuthorized) {
    return `This treasury's ${choice.code} trustline is not authorized to send this asset.`;
  }
  if (!spendability.feeCovered) {
    return 'This treasury does not have enough spendable XLM to pay the network fee while preserving Stellar minimum reserve.';
  }
  let requested: bigint;
  try {
    requested = stellarAmountToStroops(amount);
  } catch {
    return null;
  }
  if (requested > spendability.assetAvailableStroops) {
    const basis = choice.issuer
      ? 'after current selling liabilities'
      : 'after minimum reserve, selling liabilities, and the network fee';
    return `Only ${spendability.assetAvailable} ${choice.code} is currently available to send ${basis}.`;
  }
  return null;
}
