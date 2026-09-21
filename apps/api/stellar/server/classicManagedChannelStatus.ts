import { AccountNotFoundError, loadAccount } from '../../../../src/stellar/horizon.js';
import type { StellarAccountSnapshot, StellarNetwork } from '../../../../src/stellar/types.js';
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

export interface ManagedClassicChannelOperationalStatus {
  network: StellarNetwork;
  capacity: number;
  elasticLimit: number;
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

export async function inspectManagedClassicChannels(
  input: {
    network: StellarNetwork;
    channelAccounts: string[];
    elasticLimit?: number;
    leaseStore?: ClassicManagedChannelLeaseStore;
  },
  options: {
    now?: Date;
    accountLoader?: AccountLoader;
  } = {},
): Promise<ManagedClassicChannelOperationalStatus> {
  const now = options.now ?? new Date();
  const accountLoader = options.accountLoader ?? loadAccount;
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
      elasticLimit: input.elasticLimit ?? input.channelAccounts.length,
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
    elasticLimit: input.elasticLimit ?? input.channelAccounts.length,
    leaseVisibility,
    activeLeaseCount,
    expiredLeaseCount,
    freeCapacity: Math.max(0, input.channelAccounts.length - activeLeaseCount),
    channels,
  };
}
