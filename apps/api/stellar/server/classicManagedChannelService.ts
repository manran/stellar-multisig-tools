import { createHash } from 'node:crypto';
import { Networks, TransactionBuilder, type Keypair } from '@stellar/stellar-sdk/base';
import { AccountNotFoundError, loadAccount } from '../../../../src/stellar/horizon.js';
import type { StellarAccountSnapshot, StellarNetwork } from '../../../../src/stellar/types.js';
import { configuredClassicManagedChannels } from './classicManagedChannelConfig.js';
import type { ClassicManagedChannelLeaseStore } from './classicManagedChannelStore.js';

export class ClassicManagedChannelServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ClassicManagedChannelServiceError';
  }
}

export interface ReservedClassicManagedChannel {
  accountId: string;
  sequence: string;
  account: StellarAccountSnapshot;
  keypair: Keypair;
}

type AccountLoader = (
  accountId: string,
  network: StellarNetwork,
) => Promise<StellarAccountSnapshot>;

type ChannelProvisioner = (
  accountId: string,
  network: StellarNetwork,
) => Promise<void>;

async function provisionTestnetChannel(accountId: string, network: StellarNetwork): Promise<void> {
  if (network !== 'testnet') {
    throw new ClassicManagedChannelServiceError(
      'Automatic managed Classic channel provisioning is available only on Testnet.',
      503,
      'managed_classic_channel_unavailable',
    );
  }
  const response = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(accountId)}`);
  if (!response.ok) {
    throw new ClassicManagedChannelServiceError(
      `Unable to provision managed Classic Testnet channel ${accountId}: Friendbot returned HTTP ${response.status}.`,
      503,
      'managed_classic_channel_unavailable',
    );
  }
}

async function loadManagedChannelAccount(
  accountId: string,
  network: StellarNetwork,
  accountLoader: AccountLoader,
  provisioner: ChannelProvisioner,
): Promise<StellarAccountSnapshot> {
  try {
    return await accountLoader(accountId, network);
  } catch (cause) {
    if (!(cause instanceof AccountNotFoundError) || network !== 'testnet') throw cause;
    await provisioner(accountId, network);
    return accountLoader(accountId, network);
  }
}

function orderedChannels(requestId: string, channels: Keypair[]): Keypair[] {
  if (channels.length < 2) return channels;
  const digest = createHash('sha256').update(requestId).digest();
  const offset = digest.readUInt32BE(0) % channels.length;
  return [...channels.slice(offset), ...channels.slice(0, offset)];
}

export async function reserveClassicManagedChannel(
  store: ClassicManagedChannelLeaseStore,
  input: {
    network: StellarNetwork;
    requestId: string;
    leaseExpiresAt: string;
  },
  options: {
    now?: Date;
    accountLoader?: AccountLoader;
    channels?: Keypair[];
    channelProvisioner?: ChannelProvisioner;
  } = {},
): Promise<ReservedClassicManagedChannel> {
  const channels = options.channels ?? configuredClassicManagedChannels(input.network);
  if (channels.length === 0) {
    throw new ClassicManagedChannelServiceError(
      'MultiSigTools-managed Classic execution is not configured for this network.',
      503,
      'managed_classic_execution_unavailable',
    );
  }

  const existing = await store.getLeaseForRequest(input.requestId);
  if (existing) {
    if (existing.network !== input.network) {
      throw new ClassicManagedChannelServiceError(
        'This Request id is already bound to a managed Classic channel on another network.',
        409,
        'managed_classic_channel_conflict',
      );
    }
    const keypair = channels.find((candidate) => candidate.publicKey() === existing.channelAccount);
    if (!keypair) {
      throw new ClassicManagedChannelServiceError(
        'The managed Classic channel reserved for this Request is no longer configured.',
        503,
        'managed_classic_channel_unavailable',
      );
    }
    const account = await loadManagedChannelAccount(
      existing.channelAccount,
      input.network,
      options.accountLoader ?? loadAccount,
      options.channelProvisioner ?? provisionTestnetChannel,
    );
    return { accountId: existing.channelAccount, sequence: account.sequence, account, keypair };
  }

  const now = options.now ?? new Date();
  const leasedAt = now.toISOString();
  const accountLoader = options.accountLoader ?? loadAccount;
  const channelProvisioner = options.channelProvisioner ?? provisionTestnetChannel;
  for (const keypair of orderedChannels(input.requestId, channels)) {
    const channelAccount = keypair.publicKey();
    const claimed = await store.claimLease({
      network: input.network,
      channelAccount,
      requestId: input.requestId,
      leasedAt,
      expiresAt: input.leaseExpiresAt,
    });
    if (!claimed) continue;
    try {
      const account = await loadManagedChannelAccount(
        channelAccount,
        input.network,
        accountLoader,
        channelProvisioner,
      );
      return { accountId: channelAccount, sequence: account.sequence, account, keypair };
    } catch (cause) {
      await store.releaseRequest(input.requestId).catch(() => undefined);
      throw new ClassicManagedChannelServiceError(
        cause instanceof Error
          ? `Unable to load managed Classic channel ${channelAccount}: ${cause.message}`
          : `Unable to load managed Classic channel ${channelAccount}.`,
        503,
        'managed_classic_channel_unavailable',
      );
    }
  }

  throw new ClassicManagedChannelServiceError(
    'All managed Classic execution channels are currently in use. Retry after an active Request completes or expires.',
    503,
    'managed_classic_channel_pool_exhausted',
  );
}

export function signClassicManagedTransaction(
  xdr: string,
  network: StellarNetwork,
  channel: ReservedClassicManagedChannel,
): string {
  const parsed = TransactionBuilder.fromXdr(
    xdr,
    network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC,
  );
  if ('innerTransaction' in parsed) {
    throw new ClassicManagedChannelServiceError(
      'Managed Classic execution does not use fee-bump envelopes in this version.',
      400,
      'managed_classic_fee_bump_unsupported',
    );
  }
  if (parsed.source !== channel.accountId) {
    throw new ClassicManagedChannelServiceError(
      'Prepared Classic transaction is not bound to the reserved managed channel.',
      500,
      'managed_classic_channel_mismatch',
    );
  }
  parsed.sign(channel.keypair);
  return parsed.toXDR();
}
