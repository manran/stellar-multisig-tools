import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountNotFoundError } from '../../../../src/stellar/horizon.js';
import type { StellarAccountSnapshot } from '../../../../src/stellar/types.js';
import type {
  ClassicManagedChannelLeaseStore,
  StoredClassicManagedChannelLease,
} from './classicManagedChannelStore.js';
import { inspectManagedClassicChannels } from './classicManagedChannelStatus.js';
import type { ClassicManagedChannelCreatorMonitorStore } from './classicManagedChannelCreatorMonitorStore.js';

function snapshot(accountId: string, nativeBalance: string): StellarAccountSnapshot {
  return {
    accountId,
    sequence: '1',
    subentryCount: 0,
    numSponsoring: 0,
    numSponsored: 0,
    nativeBalance,
    nativeSellingLiabilities: '0',
    balances: [],
    thresholds: { low: 1, medium: 1, high: 1 },
    signers: [],
  };
}

class ReadOnlyLeaseStore implements ClassicManagedChannelLeaseStore {
  constructor(
    private readonly leases: StoredClassicManagedChannelLease[],
    private readonly fail = false,
  ) {}

  async getLeaseForRequest() { return null; }
  async claimLease() { return false; }
  async releaseRequest() {}
  async listLeases() {
    if (this.fail) throw new Error('database unavailable');
    return this.leases;
  }
}

test('managed Classic operator projection separates capacity, leases and balance availability', async () => {
  const now = new Date('2026-09-21T01:00:00.000Z');
  const store = new ReadOnlyLeaseStore([
    {
      network: 'testnet',
      channelAccount: 'channel-a',
      requestId: 'A'.repeat(16),
      leasedAt: '2026-09-21T00:00:00.000Z',
      expiresAt: '2026-09-21T02:00:00.000Z',
    },
    {
      network: 'testnet',
      channelAccount: 'channel-b',
      requestId: 'B'.repeat(16),
      leasedAt: '2026-09-20T22:00:00.000Z',
      expiresAt: '2026-09-20T23:00:00.000Z',
    },
    {
      network: 'testnet',
      channelAccount: 'old-channel',
      requestId: 'C'.repeat(16),
      leasedAt: '2026-09-20T22:00:00.000Z',
      expiresAt: '2026-09-22T00:00:00.000Z',
    },
  ]);

  const result = await inspectManagedClassicChannels({
    network: 'testnet',
    channelAccounts: ['channel-a', 'channel-b', 'channel-c'],
    softLimit: 64,
    leaseStore: store,
  }, {
    now,
    accountLoader: async (accountId) => {
      if (accountId === 'channel-a') return snapshot(accountId, '9999.5000000');
      if (accountId === 'channel-b') throw new AccountNotFoundError(accountId);
      if (accountId === 'old-channel') return snapshot(accountId, '5000.0000000');
      throw new Error('Horizon unavailable');
    },
  });

  assert.equal(result.capacity, 3);
  assert.equal(result.softLimit, 64);
  assert.equal(result.leaseVisibility, 'available');
  assert.equal(result.activeLeaseCount, 2);
  assert.equal(result.expiredLeaseCount, 1);
  assert.equal(result.freeCapacity, 1);
  assert.deepEqual(result.channels, [
    {
      accountId: 'channel-a',
      leaseState: 'active',
      leaseExpiresAt: '2026-09-21T02:00:00.000Z',
      balanceState: 'ready',
      nativeBalance: '9999.5000000',
    },
    {
      accountId: 'channel-b',
      leaseState: 'expired',
      leaseExpiresAt: '2026-09-20T23:00:00.000Z',
      balanceState: 'missing',
    },
    {
      accountId: 'channel-c',
      leaseState: 'free',
      balanceState: 'unavailable',
    },
    {
      accountId: 'old-channel',
      leaseState: 'active',
      leaseExpiresAt: '2026-09-22T00:00:00.000Z',
      balanceState: 'ready',
      nativeBalance: '5000.0000000',
    },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /AAAAAAAAAAAAAAAA|BBBBBBBBBBBBBBBB/);
});

test('managed Classic operator projection auto-grows soft limit and exposes creator capacity state', async () => {
  const leases: StoredClassicManagedChannelLease[] = [0, 1, 2, 3].map((index) => ({
    network: 'testnet',
    channelAccount: `channel-${index}`,
    channelIndex: index,
    requestId: String.fromCharCode(65 + index).repeat(16),
    leasedAt: '2026-09-21T00:00:00.000Z',
    expiresAt: '2026-09-21T02:00:00.000Z',
  }));
  const monitorStore: ClassicManagedChannelCreatorMonitorStore = {
    async get() {
      return {
        network: 'testnet',
        state: 'low',
        nativeBalanceStroops: 550_000_000n,
        observedAt: '2026-09-21T00:30:00.000Z',
      };
    },
    async observe() { return { previousState: 'low', changed: false }; },
    async markAlerted() {},
  };
  const result = await inspectManagedClassicChannels({
    network: 'testnet',
    channelAccounts: ['channel-0', 'channel-1'],
    softLimit: 8,
    leaseStore: new ReadOnlyLeaseStore(leases),
    creatorAccount: 'creator',
    creatorMonitorStore: monitorStore,
  }, {
    now: new Date('2026-09-21T01:00:00.000Z'),
    accountLoader: async (accountId) => snapshot(accountId, accountId === 'creator' ? '55' : '10'),
    networkParametersLoader: async () => ({
      ledgerSequence: 1,
      ledgerClosedAt: '2026-09-21T00:59:55.000Z',
      baseFeeInStroops: 100,
      baseReserveInStroops: 5_000_000,
    }),
  });

  assert.equal(result.softLimit, 16);
  assert.equal(result.creator?.state, 'low');
  assert.equal(result.creator?.nativeBalance, '55');
  assert.equal(result.creator?.lowThreshold, '50');
  assert.equal(result.creator?.recoveryThreshold, '60');
  assert.equal(result.creator?.requiredForNextChannel, '3.0000100');
});

test('managed Classic operator projection never reports free capacity when lease storage is unavailable', async () => {
  const result = await inspectManagedClassicChannels({
    network: 'testnet',
    channelAccounts: ['channel-a'],
    leaseStore: new ReadOnlyLeaseStore([], true),
  }, {
    accountLoader: async (accountId) => snapshot(accountId, '10000.0000000'),
  });

  assert.equal(result.softLimit, 1);
  assert.equal(result.leaseVisibility, 'unavailable');
  assert.equal(result.activeLeaseCount, null);
  assert.equal(result.expiredLeaseCount, null);
  assert.equal(result.freeCapacity, null);
  assert.equal(result.channels[0]?.leaseState, 'unknown');
  assert.equal(result.channels[0]?.balanceState, 'ready');
});
