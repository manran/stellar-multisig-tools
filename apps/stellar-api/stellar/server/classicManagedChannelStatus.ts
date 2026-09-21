import { AccountNotFoundError, loadAccount, loadNetworkParameters } from '../../../../src/stellar/horizon.js';
import type { StellarAccountSnapshot, StellarNetwork } from '../../../../src/stellar/types.js';
import {
  configuredClassicManagedChannelCreatorBalanceThresholds,
  effectiveClassicManagedChannelSoftLimit,
} from './classicManagedChannelConfig.js';
import { assessClassicManagedChannelCreatorCapacity, type ClassicManagedChannelCreatorState } from './classicManagedChannelCapacity.js';
import type { ClassicManagedChannelCreatorMonitorStore } from './classicManagedChannelCreatorMonitorStore.js';
import type {
  ClassicManagedChannelLeaseStore,
  StoredClassicManagedChannelLease,
} from './classicManagedChannelStore.js';

export type ManagedClassicLeaseState = 'active' | 'expired' | 'free' | 'unknown';
export type ManagedClassicBalanceState = 'ready' | 'missing' | 'unavailable';

export interface ManagedClassicChannelOperationalRow {
  accountId: string;
  leaseState: ManagedClassicLeaseState;
  leaseExpiresAt?: string;
  balanceState: ManagedClassicBalanceState;
  nativeBalance?: string;
}

export interface ManagedClassicCreatorOperationalStatus {
  accountId: string;
  balanceState: ManagedClassicBalanceState;
  nativeBalance?: string;
  state?: ClassicManagedChannelCreatorState;
  lowThreshold: string;
  recoveryThreshold: string;
  requiredForNextChannel?: string;
}

export interface ManagedClassicChannelOperationalStatus {
  network: StellarNetwork;
  capacity: number;
  softLimit: number;
  creator?: ManagedClassicCreatorOperationalStatus;
  leaseVisibility: 'available' | 'unavailable';
  activeLeaseCount: number | null;
  expiredLeaseCount: number | null;
  freeCapacity: number | null;
  channels: ManagedClassicChannelOperationalRow[];
}

type AccountLoader = (
  accountId: string,
  network: StellarNetwork,
) => Promise<StellarAccountSnapshot>;

function leaseForChannel(
  leases: StoredClassicManagedChannelLease[],
  accountId: string,
): StoredClassicManagedChannelLease | undefined {
  return leases.find((lease) => lease.channelAccount === accountId);
}

function leaseState(
  lease: StoredClassicManagedChannelLease | undefined,
  now: Date,
  visible: boolean,
): ManagedClassicLeaseState {
  if (!visible) return 'unknown';
  if (!lease) return 'free';
  return Date.parse(lease.expiresAt) > now.getTime() ? 'active' : 'expired';
}

async function accountVisibility(
  accountId: string,
  network: StellarNetwork,
  accountLoader: AccountLoader,
): Promise<Pick<ManagedClassicChannelOperationalRow, 'balanceState' | 'nativeBalance'>> {
  try {
    const account = await accountLoader(accountId, network);
    return {
      balanceState: 'ready',
      ...(account.nativeBalance !== undefined ? { nativeBalance: account.nativeBalance } : {}),
    };
  } catch (cause) {
    if (cause instanceof AccountNotFoundError) return { balanceState: 'missing' };
    return { balanceState: 'unavailable' };
  }
}

async function creatorVisibility(
  input: {
    network: StellarNetwork;
    accountId: string;
    monitorStore?: ClassicManagedChannelCreatorMonitorStore;
  },
  options: {
    accountLoader: AccountLoader;
    networkParametersLoader: typeof loadNetworkParameters;
  },
): Promise<ManagedClassicCreatorOperationalStatus> {
  const thresholds = configuredClassicManagedChannelCreatorBalanceThresholds();
  try {
    const account = await options.accountLoader(input.accountId, input.network);
    const parameters = await options.networkParametersLoader(input.network);
    let previousState: ClassicManagedChannelCreatorState | null = null;
    if (input.monitorStore) {
      try { previousState = (await input.monitorStore.get(input.network))?.state ?? null; } catch { previousState = null; }
    }
    const capacity = assessClassicManagedChannelCreatorCapacity(account, parameters, previousState);
    return {
      accountId: input.accountId,
      balanceState: 'ready',
      nativeBalance: capacity.nativeBalance,
      state: capacity.state,
      lowThreshold: capacity.lowThreshold,
      recoveryThreshold: capacity.recoveryThreshold,
      requiredForNextChannel: capacity.requiredForNextChannel,
    };
  } catch (cause) {
    return {
      accountId: input.accountId,
      balanceState: cause instanceof AccountNotFoundError ? 'missing' : 'unavailable',
      lowThreshold: thresholds.low,
      recoveryThreshold: thresholds.recovery,
    };
  }
}

function allocatedSlots(channelCount: number, leases: StoredClassicManagedChannelLease[]): number {
  const highestIndexedLease = leases.reduce(
    (highest, lease) => lease.channelIndex === undefined ? highest : Math.max(highest, lease.channelIndex),
    -1,
  );
  return Math.max(channelCount, leases.length, highestIndexedLease + 1);
}

export async function inspectManagedClassicChannels(
  input: {
    network: StellarNetwork;
    channelAccounts: string[];
    softLimit?: number;
    leaseStore?: ClassicManagedChannelLeaseStore;
    creatorAccount?: string;
    creatorMonitorStore?: ClassicManagedChannelCreatorMonitorStore;
  },
  options: {
    now?: Date;
    accountLoader?: AccountLoader;
    networkParametersLoader?: typeof loadNetworkParameters;
  } = {},
): Promise<ManagedClassicChannelOperationalStatus> {
  const now = options.now ?? new Date();
  const accountLoader = options.accountLoader ?? loadAccount;
  const networkParametersLoader = options.networkParametersLoader ?? loadNetworkParameters;
  let leases: StoredClassicManagedChannelLease[] = [];
  let leaseVisibility: ManagedClassicChannelOperationalStatus['leaseVisibility'] = 'unavailable';

  if (input.leaseStore?.listLeases) {
    try {
      leases = await input.leaseStore.listLeases(input.network);
      leaseVisibility = 'available';
    } catch {
      leaseVisibility = 'unavailable';
    }
  }

  const baseSoftLimit = input.softLimit ?? input.channelAccounts.length;
  const softLimit = leaseVisibility === 'available'
    ? effectiveClassicManagedChannelSoftLimit(allocatedSlots(input.channelAccounts.length, leases), baseSoftLimit)
    : baseSoftLimit;
  const creator = input.creatorAccount
    ? await creatorVisibility({
        network: input.network,
        accountId: input.creatorAccount,
        monitorStore: input.creatorMonitorStore,
      }, { accountLoader, networkParametersLoader })
    : undefined;

  const visibleAccounts = [...new Set([
    ...input.channelAccounts,
    ...leases.map((lease) => lease.channelAccount),
  ])];
  const visibleLeases = leases.filter((lease) => visibleAccounts.includes(lease.channelAccount));
  const channels = await Promise.all(visibleAccounts.map(async (accountId) => {
    const lease = leaseForChannel(visibleLeases, accountId);
    const state = leaseState(lease, now, leaseVisibility === 'available');
    const balance = await accountVisibility(accountId, input.network, accountLoader);
    return {
      accountId,
      leaseState: state,
      ...(lease && leaseVisibility === 'available' ? { leaseExpiresAt: lease.expiresAt } : {}),
      ...balance,
    } satisfies ManagedClassicChannelOperationalRow;
  }));

  if (leaseVisibility === 'unavailable') {
    return {
      network: input.network,
      capacity: input.channelAccounts.length,
      softLimit,
      ...(creator ? { creator } : {}),
      leaseVisibility,
      activeLeaseCount: null,
      expiredLeaseCount: null,
      freeCapacity: null,
      channels,
    };
  }

  const activeLeaseCount = channels.filter((channel) => channel.leaseState === 'active').length;
  const expiredLeaseCount = channels.filter((channel) => channel.leaseState === 'expired').length;
  return {
    network: input.network,
    capacity: input.channelAccounts.length,
    softLimit,
    ...(creator ? { creator } : {}),
    leaseVisibility,
    activeLeaseCount,
    expiredLeaseCount,
    freeCapacity: Math.max(0, input.channelAccounts.length - activeLeaseCount),
    channels,
  };
}
