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
import { AccountNotFoundError, TransactionSubmissionError } from '../../../../packages/stellar-core/src/horizon.js';
import { deriveClassicManagedChannel } from './classicManagedChannelConfig.js';
import type { StellarAccountSnapshot } from '../../../../packages/stellar-core/src/types.js';
import type {
  ClassicManagedChannelLeaseStore,
  StoredClassicManagedChannelLease,
} from './classicManagedChannelStore.js';
import type {
  ClassicManagedChannelCreatorMonitorStore,
  StoredClassicManagedChannelCreatorMonitor,
} from './classicManagedChannelCreatorMonitorStore.js';
import {
  ClassicManagedChannelServiceError,
  provisionManagedChannelWithCreator,
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

  async listLeases(network: 'testnet' | 'public') {
    return [...this.leases.values()].filter((item) => item.network === network);
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

test('managed channel soft limit does not cap deterministic expansion', async () => {
  const previousMaster = process.env.MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET;
  const previousPool = process.env.MULTISIG_CLASSIC_CHANNEL_POOL_SIZE;
  const previousSoft = process.env.MULTISIG_CLASSIC_CHANNEL_SOFT_LIMIT;
  process.env.MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.MULTISIG_CLASSIC_CHANNEL_POOL_SIZE = '1';
  process.env.MULTISIG_CLASSIC_CHANNEL_SOFT_LIMIT = '2';
  try {
    const store = new MemoryStore();
    const now = new Date('2026-09-19T10:00:00.000Z');
    const occupied = [0, 1, 2].map((index) => deriveClassicManagedChannel('testnet', index)!);
    for (const [index, channel] of occupied.entries()) {
      store.leases.set(`testnet:${channel.publicKey()}`, {
        network: 'testnet',
        channelAccount: channel.publicKey(),
        channelIndex: index,
        requestId: String.fromCharCode(65 + index).repeat(16),
        leasedAt: now.toISOString(),
        expiresAt: '2026-09-20T10:00:00.000Z',
      });
    }

    const reserved = await reserveClassicManagedChannel(store, {
      network: 'testnet',
      requestId: 'Z'.repeat(16),
      leaseExpiresAt: '2026-09-20T10:00:00.000Z',
    }, {
      now,
      accountLoader: async (accountId) => snapshot(accountId, '10'),
    });

    assert.equal(reserved.accountId, deriveClassicManagedChannel('testnet', 3)?.publicKey());
    assert.equal((await store.getLeaseForRequest('Z'.repeat(16)))?.channelIndex, 3);
  } finally {
    if (previousMaster === undefined) delete process.env.MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET;
    else process.env.MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET = previousMaster;
    if (previousPool === undefined) delete process.env.MULTISIG_CLASSIC_CHANNEL_POOL_SIZE;
    else process.env.MULTISIG_CLASSIC_CHANNEL_POOL_SIZE = previousPool;
    if (previousSoft === undefined) delete process.env.MULTISIG_CLASSIC_CHANNEL_SOFT_LIMIT;
    else process.env.MULTISIG_CLASSIC_CHANNEL_SOFT_LIMIT = previousSoft;
  }
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

test('channel provisioning is network-neutral once the deployment supplies a creator path', async () => {
  const store = new MemoryStore();
  const channel = Keypair.random();
  let provisioned = 0;
  let loads = 0;
  const reserved = await reserveClassicManagedChannel(store, {
    network: 'public',
    requestId: 'M'.repeat(16),
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
      assert.equal(network, 'public');
      provisioned += 1;
    },
  });
  assert.equal(reserved.accountId, channel.publicKey());
  assert.equal(provisioned, 1);
});

test('creator provisioning reconciles outcome-unknown and rebuilds with the latest creator sequence', async () => {
  const creator = Keypair.random();
  const target = Keypair.random();
  let targetExists = false;
  let creatorLoads = 0;
  const submittedSequences: string[] = [];

  await provisionManagedChannelWithCreator(target.publicKey(), 'testnet', {
    creator,
    accountLoader: async (accountId) => {
      if (accountId === target.publicKey()) {
        if (!targetExists) throw new AccountNotFoundError(accountId);
        return snapshot(accountId, '0');
      }
      assert.equal(accountId, creator.publicKey());
      creatorLoads += 1;
      return snapshot(accountId, creatorLoads === 1 ? '10' : '11');
    },
    networkParametersLoader: async () => ({
      ledgerSequence: 1,
      ledgerClosedAt: '2026-09-21T00:00:00.000Z',
      baseFeeInStroops: 100,
      baseReserveInStroops: 5_000_000,
    }),
    transactionSubmitter: async (xdr) => {
      const transaction = TransactionBuilder.fromXdr(xdr, Networks.TESTNET);
      if ('innerTransaction' in transaction) assert.fail('Expected classic transaction.');
      submittedSequences.push(transaction.sequence);
      if (submittedSequences.length === 1) {
        throw new TransactionSubmissionError('outcome unknown', { outcomeUnknown: true });
      }
      targetExists = true;
      return { hash: 'a'.repeat(64), ledger: 1, successful: true };
    },
  });

  assert.equal(targetExists, true);
  assert.equal(creatorLoads, 3);
  assert.equal(submittedSequences.length, 2);
  assert.notEqual(submittedSequences[0], submittedSequences[1]);
});

test('creator provisioning treats an outcome-unknown transaction as success when the target account exists', async () => {
  const creator = Keypair.random();
  const target = Keypair.random();
  let targetExists = false;
  let submissions = 0;

  await provisionManagedChannelWithCreator(target.publicKey(), 'testnet', {
    creator,
    accountLoader: async (accountId) => {
      if (accountId === target.publicKey()) {
        if (!targetExists) throw new AccountNotFoundError(accountId);
        return snapshot(accountId, '0');
      }
      return snapshot(accountId, '20');
    },
    networkParametersLoader: async () => ({
      ledgerSequence: 1,
      ledgerClosedAt: '2026-09-21T00:00:00.000Z',
      baseFeeInStroops: 100,
      baseReserveInStroops: 5_000_000,
    }),
    transactionSubmitter: async () => {
      submissions += 1;
      targetExists = true;
      throw new TransactionSubmissionError('outcome unknown', { outcomeUnknown: true });
    },
  });

  assert.equal(submissions, 1);
  assert.equal(targetExists, true);
});

test('creator capacity exhaustion blocks only new channel provisioning with a user-safe error', async () => {
  const creator = Keypair.random();
  const target = Keypair.random();
  let submissions = 0;

  await assert.rejects(
    provisionManagedChannelWithCreator(target.publicKey(), 'testnet', {
      creator,
      accountLoader: async (accountId) => {
        if (accountId === target.publicKey()) throw new AccountNotFoundError(accountId);
        const value = snapshot(accountId, '10');
        value.nativeBalance = '2';
        return value;
      },
      networkParametersLoader: async () => ({
        ledgerSequence: 1,
        ledgerClosedAt: '2026-09-21T00:00:00.000Z',
        baseFeeInStroops: 100,
        baseReserveInStroops: 5_000_000,
      }),
      transactionSubmitter: async () => {
        submissions += 1;
        return { hash: 'a'.repeat(64), ledger: 1, successful: true };
      },
    }),
    (cause: unknown) => cause instanceof ClassicManagedChannelServiceError
      && cause.code === 'managed_execution_capacity_temporarily_unavailable'
      && /Existing requests are unaffected/.test(cause.message),
  );
  assert.equal(submissions, 0);
});

test('unconfigured alert hook records low creator state without claiming delivery', async () => {
  const creator = Keypair.random();
  const target = Keypair.random();
  let record: StoredClassicManagedChannelCreatorMonitor | null = null;
  const monitorStore: ClassicManagedChannelCreatorMonitorStore = {
    async get() { return record; },
    async observe(next) {
      const previousState = record?.state ?? null;
      const alertedAt = previousState === next.state ? record?.alertedAt : undefined;
      record = { ...next, ...(alertedAt ? { alertedAt } : {}) };
      return { previousState, changed: previousState !== next.state };
    },
    async claimAlert(_network, state, claimedAt) {
      if (!record || record.state !== state || record.alertedAt) return false;
      record.alertedAt = claimedAt;
      return true;
    },
    async releaseAlertClaim(_network, state, claimedAt) {
      if (record?.state === state && record.alertedAt === claimedAt) delete record.alertedAt;
    },
  };
  const previousWebhook = process.env.MULTISIG_CLASSIC_CHANNEL_ALERT_WEBHOOK_URL;
  delete process.env.MULTISIG_CLASSIC_CHANNEL_ALERT_WEBHOOK_URL;
  try {
    await provisionManagedChannelWithCreator(target.publicKey(), 'testnet', {
      creator,
      creatorMonitorStore: monitorStore,
      accountLoader: async (accountId) => {
        if (accountId === target.publicKey()) throw new AccountNotFoundError(accountId);
        const value = snapshot(accountId, '10');
        value.nativeBalance = '49';
        return value;
      },
      networkParametersLoader: async () => ({
        ledgerSequence: 1,
        ledgerClosedAt: '2026-09-21T00:00:00.000Z',
        baseFeeInStroops: 100,
        baseReserveInStroops: 5_000_000,
      }),
      transactionSubmitter: async () => ({ hash: 'a'.repeat(64), ledger: 1, successful: true }),
    });
  } finally {
    if (previousWebhook === undefined) delete process.env.MULTISIG_CLASSIC_CHANNEL_ALERT_WEBHOOK_URL;
    else process.env.MULTISIG_CLASSIC_CHANNEL_ALERT_WEBHOOK_URL = previousWebhook;
  }

  assert.equal(record?.state, 'low');
  assert.equal(record?.alertedAt, undefined);
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
