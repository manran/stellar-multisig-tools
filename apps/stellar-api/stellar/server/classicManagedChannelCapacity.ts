import { stellarAmountToStroops, stroopsToStellarAmount } from '../../../../packages/stellar-core/src/reserve.js';
import type { StellarNetworkParameters } from '../../../../packages/stellar-core/src/horizon.js';
import type { StellarAccountSnapshot } from '../../../../packages/stellar-core/src/types.js';
import {
  configuredClassicManagedChannelCreatorBalanceThresholds,
  configuredClassicManagedChannelInitialBalance,
} from './classicManagedChannelConfig.js';

export type ClassicManagedChannelCreatorState = 'ready' | 'low' | 'insufficient';

export interface ClassicManagedChannelCreatorCapacity {
  state: ClassicManagedChannelCreatorState;
  nativeBalance: string;
  lowThreshold: string;
  recoveryThreshold: string;
  requiredForNextChannel: string;
  canCreateNextChannel: boolean;
}

function creatorMinimumReserveStroops(
  account: StellarAccountSnapshot,
  parameters: StellarNetworkParameters,
): bigint {
  const reserveUnits = 2 + account.subentryCount + account.numSponsoring - account.numSponsored;
  if (reserveUnits < 0) throw new Error('Managed Classic channel creator reserve metadata is inconsistent.');
  const sellingLiabilities = stellarAmountToStroops(account.nativeSellingLiabilities ?? '0');
  return (BigInt(reserveUnits) * BigInt(parameters.baseReserveInStroops)) + sellingLiabilities;
}

export function assessClassicManagedChannelCreatorCapacity(
  account: StellarAccountSnapshot,
  parameters: StellarNetworkParameters,
  previousState: ClassicManagedChannelCreatorState | null = null,
): ClassicManagedChannelCreatorCapacity {
  if (!account.nativeBalance) {
    throw new Error('Managed Classic channel creator native balance is unavailable.');
  }
  const { low, recovery } = configuredClassicManagedChannelCreatorBalanceThresholds();
  const balance = stellarAmountToStroops(account.nativeBalance);
  const lowStroops = stellarAmountToStroops(low);
  const recoveryStroops = stellarAmountToStroops(recovery);
  const initialBalance = stellarAmountToStroops(configuredClassicManagedChannelInitialBalance());
  const currentMinimum = creatorMinimumReserveStroops(account, parameters);
  const transactionFee = BigInt(parameters.baseFeeInStroops);
  const requiredForNextChannel = currentMinimum + initialBalance + transactionFee;
  const canCreateNextChannel = balance >= requiredForNextChannel;

  let state: ClassicManagedChannelCreatorState;
  if (!canCreateNextChannel) {
    state = 'insufficient';
  } else if (previousState === 'low' || previousState === 'insufficient') {
    state = balance >= recoveryStroops ? 'ready' : 'low';
  } else {
    state = balance < lowStroops ? 'low' : 'ready';
  }

  return {
    state,
    nativeBalance: account.nativeBalance,
    lowThreshold: low,
    recoveryThreshold: recovery,
    requiredForNextChannel: stroopsToStellarAmount(requiredForNextChannel),
    canCreateNextChannel,
  };
}
