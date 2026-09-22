import type { StellarAccountSnapshot } from './types.js';

const STROOPS_PER_XLM = 10_000_000n;

export interface MultisigReservePreflight {
  sufficient: boolean;
  balanceStroops: bigint;
  sellingLiabilitiesStroops: bigint;
  currentMinimumStroops: bigint;
  addedReserveStroops: bigint;
  setupFeeStroops: bigint;
  requiredBeforeSubmitStroops: bigint;
  headroomAfterSetupStroops: bigint;
  shortfallStroops: bigint;
}

export function stellarAmountToStroops(value: string): bigint {
  const normalized = value.trim();
  const match = /^(\d+)(?:\.(\d{1,7}))?$/.exec(normalized);
  if (!match) throw new Error(`Invalid Stellar amount: ${value}`);
  const whole = BigInt(match[1]);
  const fractional = (match[2] ?? '').padEnd(7, '0');
  return whole * STROOPS_PER_XLM + BigInt(fractional || '0');
}

export function xlmToStroops(value: string): bigint {
  return stellarAmountToStroops(value);
}

export function stroopsToStellarAmount(stroops: bigint): string {
  const sign = stroops < 0n ? '-' : '';
  const absolute = stroops < 0n ? -stroops : stroops;
  const whole = absolute / STROOPS_PER_XLM;
  const fractional = (absolute % STROOPS_PER_XLM).toString().padStart(7, '0');
  return `${sign}${whole}.${fractional}`;
}

export function stroopsToXlm(stroops: bigint): string {
  return stroopsToStellarAmount(stroops);
}

export function assessMultisigReserve(
  account: StellarAccountSnapshot,
  additionalSignerCount: number,
  baseReserveInStroops: number,
  baseFeeInStroops: number,
  operationCount = additionalSignerCount + 1,
): MultisigReservePreflight {
  if (account.nativeBalance === undefined || account.nativeSellingLiabilities === undefined) {
    throw new Error('Native XLM balance data is unavailable for reserve preflight.');
  }
  if (!Number.isSafeInteger(additionalSignerCount) || additionalSignerCount < 0) {
    throw new Error('Additional signer count must be a non-negative integer.');
  }
  if (!Number.isSafeInteger(operationCount) || operationCount < 1) {
    throw new Error('Operation count must be a positive integer.');
  }
  if (!Number.isSafeInteger(baseReserveInStroops) || baseReserveInStroops <= 0) {
    throw new Error('Network base reserve is invalid.');
  }
  if (!Number.isSafeInteger(baseFeeInStroops) || baseFeeInStroops < 0) {
    throw new Error('Network base fee is invalid.');
  }

  const balanceStroops = xlmToStroops(account.nativeBalance);
  const sellingLiabilitiesStroops = xlmToStroops(account.nativeSellingLiabilities);
  const reserveUnits = 2 + account.subentryCount + account.numSponsoring - account.numSponsored;
  if (reserveUnits < 0) throw new Error('Account reserve metadata is inconsistent.');

  const baseReserve = BigInt(baseReserveInStroops);
  const currentMinimumStroops = BigInt(reserveUnits) * baseReserve + sellingLiabilitiesStroops;
  const addedReserveStroops = BigInt(additionalSignerCount) * baseReserve;
  const setupFeeStroops = BigInt(operationCount) * BigInt(baseFeeInStroops);
  const requiredBeforeSubmitStroops = currentMinimumStroops + addedReserveStroops + setupFeeStroops;
  const headroomAfterSetupStroops = balanceStroops - requiredBeforeSubmitStroops;
  const shortfallStroops = headroomAfterSetupStroops < 0n ? -headroomAfterSetupStroops : 0n;

  return {
    sufficient: shortfallStroops === 0n,
    balanceStroops,
    sellingLiabilitiesStroops,
    currentMinimumStroops,
    addedReserveStroops,
    setupFeeStroops,
    requiredBeforeSubmitStroops,
    headroomAfterSetupStroops,
    shortfallStroops,
  };
}
