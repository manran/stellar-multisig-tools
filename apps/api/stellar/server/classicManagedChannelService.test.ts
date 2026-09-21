import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk/base';
import { AccountNotFoundError } from '../../../../src/stellar/horizon.js';
import type { StellarAccountSnapshot } from '../../../../src/stellar/types.js';
import type {
  ClassicManagedChannelLeaseStore,
  StoredClassicManagedChannelLease,
} from './classicManagedChannelStore.js';
import {
  ClassicManagedChannelServiceError,
  reserveClassicManagedChannel,
  signClassicManagedTransaction,
} from './classicManagedChannelService.js';

class MemoryStore implements ClassicManagedChannelLeaseStore {
  leases = new Map<string, StoredClassicManagedChannelLease>();

  async getLeaseForRequest(requestId: string) {
    return [...this.leases.values()].find((item) => item.requestId === requestId) ?? null;
  }

  async claimLease(record: StoredClassicManagedChannelLease) {
    const key = `${record.network}:${record.channelAccount}`;
    const current = this.leases.get(key);
    if (
      current
      && current.requestId !== record.requestId
      && Date.parse(current.expiresAt) > Date.parse(record.leasedAt)
    ) return false;
    this.leases.set(key, record);
    return true;
  }

  async releaseRequest(requestId: string) {
    for (const [key, value] of this.leases) {
      if (value.requestId === requestId) this.leases.delete(key);
    }
  }
}

function snapshot(accountId: string, sequence: string): StellarAccountSnapshot {
  return {
    accountId,
    sequence,
    subentryCount: 0,
    numSponsoring: 0,
    numSponsored: 0,
    nativeBalance: '10000',
    nativeSellingLiabilities: '0',
    balances: [{
      assetType: 'native',
      assetCode: 'XLM',
      balance: '10000',
      sellingLiabilities: '0',
      buyingLiabilities: '0',
    }],
    thresholds: { low: 1, medium: 1, high: 1 },
    signers: [{ key: accountId, type: 'ed25519_public_key', weight: 1 }],
  };
}

test('managed channel reservation reuses the same channel for the same Request id', async () => {
  const store = new MemoryStore();
  const first = Keypair.random();
  const second = Keypair.random();
  const accountLoader = async (accountId: string) => snapshot(
    accountId,
    accountId === first.publicKey() ? '10' : '20',
  );
  const input = {
    network: 'testnet' as const,
    requestId: 'R'.repeat(16),
    leaseExpiresAt: '2026-09-20T10:00:00.000Z',
  };

  const reserved = await reserveClassicManagedChannel(store, input, {
    now: new Date('2026-09-19T10:00:00.000Z'),
    accountLoader,
    channels: [first, second],
  });
  const replay = await reserveClassicManagedChannel(store, input, {
    now: new Date('2026-09-19T10:01:00.000Z'),
    accountLoader,
    channels: [first, second],
  });

  assert.equal(replay.accountId, reserved.accountId);
  assert.equal((await store.getLeaseForRequest(input.requestId))?.channelAccount, reserved.accountId);
});

test('managed channel pool refuses another active Request when every channel is leased', async () => {
  const store = new MemoryStore();
  const channel = Keypair.random();
  const accountLoader = async (accountId: string) => snapshot(accountId, '10');
  await reserveClassicManagedChannel(store, {
    network: 'testnet',
    requestId: 'A'.repeat(16),
    leaseExpiresAt: '2026-09-20T10:00:00.000Z',
  }, {
    now: new Date('2026-09-19T10:00:00.000Z'),
    accountLoader,
    channels: [channel],
  });

  await assert.rejects(
    () => reserveClassicManagedChannel(store, {
      network: 'testnet',
      requestId: 'B'.repeat(16),
      leaseExpiresAt: '2026-09-20T10:00:00.000Z',
    }, {
      now: new Date('2026-09-19T10:01:00.000Z'),
      accountLoader,
      channels: [channel],
    }),
    (cause: unknown) => cause instanceof ClassicManagedChannelServiceError
      && cause.code === 'managed_classic_channel_pool_exhausted',
  );
});

test('Testnet pool expands deterministically only after every baseline channel is leased', async () => {
  const store = new MemoryStore();
  const baseline = [Keypair.random(), Keypair.random()];
  const expansion = [Keypair.random(), Keypair.random()];
  const provisioned: string[] = [];
  const accountLoader = async (accountId: string) => {
    if (expansion.some((channel) => channel.publicKey() === accountId)) throw new AccountNotFoundError(accountId);
    return snapshot(accountId, '10');
  };
  const provisioner = async (accountId: string, network: 'testnet' | 'public') => {
    assert.equal(network, 'testnet');
    provisioned.push(accountId);
  };
  const expandedLoader = async (accountId: string) => snapshot(accountId, '0');
  const now = new Date('2026-09-19T10:00:00.000Z');

  for (const [index, channel] of baseline.entries()) {
    store.leases.set(`testnet:${channel.publicKey()}`, {
      network: 'testnet',
      channelAccount: channel.publicKey(),
      requestId: String.fromCharCode(65 + index).repeat(16),
      leasedAt: now.toISOString(),
      expiresAt: '2026-09-20T10:00:00.000Z',
    });
  }

  let loads = 0;
  const reserved = await reserveClassicManagedChannel(store, {
    network: 'testnet',
    requestId: 'Z'.repeat(16),
    leaseExpiresAt: '2026-09-20T10:00:00.000Z',
  }, {
    now,
    channels: baseline,
    expansionChannels: expansion,
    accountLoader: async (accountId) => {
      loads += 1;
      if (loads === 1) return accountLoader(accountId);
      return expandedLoader(accountId);
    },
    channelProvisioner: provisioner,
  });

  assert.equal(baseline.some((channel) => channel.publicKey() === reserved.accountId), false);
  assert.equal(reserved.accountId, expansion[0]?.publicKey());
  assert.deepEqual(provisioned, [reserved.accountId]);
});

test('expired channel lease can be reclaimed without sequence pipelining', async () => {
  const store = new MemoryStore();
  const channel = Keypair.random();
  const accountLoader = async (accountId: string) => snapshot(accountId, '11');
  await reserveClassicManagedChannel(store, {
    network: 'testnet',
    requestId: 'A'.repeat(16),
    leaseExpiresAt: '2026-09-19T10:05:00.000Z',
  }, {
    now: new Date('2026-09-19T10:00:00.000Z'),
    accountLoader,
    channels: [channel],
  });

  const reclaimed = await reserveClassicManagedChannel(store, {
    network: 'testnet',
    requestId: 'B'.repeat(16),
    leaseExpiresAt: '2026-09-19T11:00:00.000Z',
  }, {
    now: new Date('2026-09-19T10:06:00.000Z'),
    accountLoader,
    channels: [channel],
  });
  assert.equal(reclaimed.accountId, channel.publicKey());
  assert.equal((await store.getLeaseForRequest('B'.repeat(16)))?.channelAccount, channel.publicKey());
});

test('missing Testnet channel is provisioned once before Horizon is reloaded', async () => {
  const store = new MemoryStore();
  const channel = Keypair.random();
  let provisioned = 0;
  let loads = 0;
  const reserved = await reserveClassicManagedChannel(store, {
    network: 'testnet',
    requestId: 'P'.repeat(16),
    leaseExpiresAt: '2026-09-20T10:00:00.000Z',
  }, {
    now: new Date('2026-09-19T10:00:00.000Z'),
    channels: [channel],
    accountLoader: async (accountId) => {
      loads += 1;
      if (loads === 1) throw new AccountNotFoundError(accountId);
      return snapshot(accountId, '0');
    },
    channelProvisioner: async (accountId, network) => {
      assert.equal(accountId, channel.publicKey());
      assert.equal(network, 'testnet');
      provisioned += 1;
    },
  });
  assert.equal(reserved.accountId, channel.publicKey());
  assert.equal(provisioned, 1);
  assert.equal(loads, 2);
});

test('missing Mainnet channel is never auto-provisioned', async () => {
  const store = new MemoryStore();
  const channel = Keypair.random();
  let provisioned = 0;
  await assert.rejects(
    () => reserveClassicManagedChannel(store, {
      network: 'public',
      requestId: 'M'.repeat(16),
      leaseExpiresAt: '2026-09-20T10:00:00.000Z',
    }, {
      now: new Date('2026-09-19T10:00:00.000Z'),
      channels: [channel],
      accountLoader: async (accountId) => { throw new AccountNotFoundError(accountId); },
      channelProvisioner: async () => { provisioned += 1; },
    }),
    (cause: unknown) => cause instanceof ClassicManagedChannelServiceError
      && cause.code === 'managed_classic_channel_unavailable',
  );
  assert.equal(provisioned, 0);
});

test('managed channel signer adds only the transaction-source signature', () => {
  const channel = Keypair.random();
  const treasury = Keypair.random();
  const transaction = new TransactionBuilder(new Account(channel.publicKey(), '7'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({
      source: treasury.publicKey(),
      destination: Keypair.random().publicKey(),
      asset: Asset.native(),
      amount: '1',
    }))
    .setTimeout(3600)
    .build();

  const signed = signClassicManagedTransaction(transaction.toXDR(), 'testnet', {
    accountId: channel.publicKey(),
    sequence: '7',
    account: snapshot(channel.publicKey(), '7'),
    keypair: channel,
  });
  const parsed = TransactionBuilder.fromXdr(signed, Networks.TESTNET);
  if ('innerTransaction' in parsed) assert.fail('Expected a classic transaction.');
  assert.equal(parsed.source, channel.publicKey());
  assert.equal(parsed.operations[0].source, treasury.publicKey());
  assert.equal(parsed.signatures.length, 1);
});
