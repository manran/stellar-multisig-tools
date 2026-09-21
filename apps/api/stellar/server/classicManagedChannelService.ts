import { createHash } from 'node:crypto';
import {
  Account,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk/base';
import {
  AccountNotFoundError,
  loadAccount,
  loadNetworkParameters,
  submitTransactionXdr,
  TransactionSubmissionError,
} from '../../../../src/stellar/horizon.js';
import { stellarAmountToStroops } from '../../../../src/stellar/reserve.js';
import type { StellarAccountSnapshot, StellarNetwork } from '../../../../src/stellar/types.js';
import {
  classicManagedChannelSoftLimit,
  configuredClassicManagedChannelInitialBalance,
  deriveClassicManagedChannelCreator,
  configuredClassicManagedChannels,
  deriveClassicManagedChannel,
} from './classicManagedChannelConfig.js';
import type {
  ClassicManagedChannelLeaseStore,
  StoredClassicManagedChannelLease,
} from './classicManagedChannelStore.js';

const CREATOR_SEQUENCE_RETRIES = 4;

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

interface IndexedChannel {
  index: number;
  keypair: Keypair;
}

function networkPassphrase(network: StellarNetwork): string {
  return network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
}

export async function provisionManagedChannelWithCreator(
  accountId: string,
  network: StellarNetwork,
  options: {
    creator?: Keypair;
    accountLoader?: AccountLoader;
    networkParametersLoader?: typeof loadNetworkParameters;
    transactionSubmitter?: typeof submitTransactionXdr;
  } = {},
): Promise<void> {
  const creator = options.creator ?? deriveClassicManagedChannelCreator(network);
  if (!creator) {
    throw new ClassicManagedChannelServiceError(
      'Managed Classic channel creator is not configured for this deployment.',
      503,
      'managed_classic_channel_creator_unavailable',
    );
  }

  const startingBalance = configuredClassicManagedChannelInitialBalance();
  const accountLoader = options.accountLoader ?? loadAccount;
  const parameters = await (options.networkParametersLoader ?? loadNetworkParameters)(network);
  const transactionSubmitter = options.transactionSubmitter ?? submitTransactionXdr;
  if (stellarAmountToStroops(startingBalance) < BigInt(parameters.baseReserveInStroops) * 2n) {
    throw new ClassicManagedChannelServiceError(
      'Managed Classic channel initial balance is below the network minimum account reserve.',
      503,
      'managed_classic_channel_creator_unavailable',
    );
  }

  for (let attempt = 0; attempt < CREATOR_SEQUENCE_RETRIES; attempt += 1) {
    try {
      await accountLoader(accountId, network);
      return;
    } catch (cause) {
      if (!(cause instanceof AccountNotFoundError)) {
        throw new ClassicManagedChannelServiceError(
          cause instanceof Error
            ? `Unable to verify managed Classic channel ${accountId}: ${cause.message}`
            : `Unable to verify managed Classic channel ${accountId}.`,
          503,
          'managed_classic_channel_creator_unavailable',
        );
      }
    }

    let source: StellarAccountSnapshot;
    try {
      source = await accountLoader(creator.publicKey(), network);
    } catch (cause) {
      throw new ClassicManagedChannelServiceError(
        cause instanceof Error
          ? `Unable to load managed Classic channel creator: ${cause.message}`
          : 'Unable to load managed Classic channel creator.',
        503,
        'managed_classic_channel_creator_unavailable',
      );
    }

    const transaction = new TransactionBuilder(new Account(source.accountId, source.sequence), {
      fee: String(parameters.baseFeeInStroops),
      networkPassphrase: networkPassphrase(network),
    })
      .addOperation(Operation.createAccount({ destination: accountId, startingBalance }))
      .setTimeout(60)
      .build();
    transaction.sign(creator);

    try {
      await transactionSubmitter(transaction.toXDR(), network);
      return;
    } catch (cause) {
      if (cause instanceof TransactionSubmissionError) {
        try {
          await accountLoader(accountId, network);
          return;
        } catch (verificationCause) {
          if (!(verificationCause instanceof AccountNotFoundError)) {
            throw new ClassicManagedChannelServiceError(
              verificationCause instanceof Error
                ? `Unable to reconcile managed Classic channel ${accountId}: ${verificationCause.message}`
                : `Unable to reconcile managed Classic channel ${accountId}.`,
              503,
              'managed_classic_channel_creator_unavailable',
            );
          }
        }
        if (
          (cause.transactionCode === 'tx_bad_seq' || cause.outcomeUnknown)
          && attempt + 1 < CREATOR_SEQUENCE_RETRIES
        ) {
          continue;
        }
      }
      throw new ClassicManagedChannelServiceError(
        cause instanceof Error
          ? `Unable to create managed Classic channel ${accountId}: ${cause.message}`
          : `Unable to create managed Classic channel ${accountId}.`,
        503,
        'managed_classic_channel_creator_unavailable',
      );
    }
  }

  throw new ClassicManagedChannelServiceError(
    'Managed Classic channel creator sequence remained busy after bounded retries.',
    503,
    'managed_classic_channel_creator_unavailable',
  );
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
    if (!(cause instanceof AccountNotFoundError)) throw cause;
    await provisioner(accountId, network);
    return accountLoader(accountId, network);
  }
}

function orderedChannels(requestId: string, channels: IndexedChannel[]): IndexedChannel[] {
  if (channels.length < 2) return channels;
  const digest = createHash('sha256').update(requestId).digest();
  const offset = digest.readUInt32BE(0) % channels.length;
  return [...channels.slice(offset), ...channels.slice(0, offset)];
}

function indexedChannels(channels: Keypair[], start = 0): IndexedChannel[] {
  return channels.map((keypair, offset) => ({ index: start + offset, keypair }));
}

function legacyLeaseKeypair(
  accountId: string,
  network: StellarNetwork,
  baselineCount: number,
  softLimit: number,
  leaseCount: number,
): Keypair | null {
  const scanEnd = Math.max(softLimit, baselineCount + leaseCount + 1);
  for (let index = 0; index <= scanEnd; index += 1) {
    const candidate = deriveClassicManagedChannel(network, index);
    if (candidate?.publicKey() === accountId) return candidate;
  }
  return null;
}

function dynamicExpansionChannels(
  network: StellarNetwork,
  baselineCount: number,
  leases: StoredClassicManagedChannelLease[],
): IndexedChannel[] {
  const highestIndexedLease = leases.reduce(
    (highest, lease) => lease.channelIndex === undefined ? highest : Math.max(highest, lease.channelIndex),
    -1,
  );
  const lastIndex = Math.max(
    baselineCount,
    highestIndexedLease + 1,
    baselineCount + leases.length,
  );
  const channels: IndexedChannel[] = [];
  for (let index = baselineCount; index <= lastIndex; index += 1) {
    const keypair = deriveClassicManagedChannel(network, index);
    if (!keypair) break;
    channels.push({ index, keypair });
  }
  return channels;
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
    expansionChannels?: Keypair[];
    channelProvisioner?: ChannelProvisioner;
  } = {},
): Promise<ReservedClassicManagedChannel> {
  const baselineKeypairs = options.channels ?? configuredClassicManagedChannels(input.network);
  if (baselineKeypairs.length === 0) {
    throw new ClassicManagedChannelServiceError(
      'MultiSigTools-managed Classic execution is not configured for this network.',
      503,
      'managed_classic_execution_unavailable',
    );
  }

  const baselineChannels = indexedChannels(baselineKeypairs);
  const leases = await store.listLeases(input.network);
  const softLimit = classicManagedChannelSoftLimit();
  const expansionChannels = options.expansionChannels
    ? indexedChannels(options.expansionChannels, baselineChannels.length)
    : options.channels
      ? []
      : dynamicExpansionChannels(input.network, baselineChannels.length, leases);
  const customCandidates = [...baselineChannels, ...expansionChannels];

  const existing = await store.getLeaseForRequest(input.requestId);
  if (existing) {
    if (existing.network !== input.network) {
      throw new ClassicManagedChannelServiceError(
        'This Request id is already bound to a managed Classic channel on another network.',
        409,
        'managed_classic_channel_conflict',
      );
    }

    let keypair = customCandidates.find((candidate) => (
      candidate.keypair.publicKey() === existing.channelAccount
      || candidate.index === existing.channelIndex
    ))?.keypair ?? null;

    if (!keypair && options.channels === undefined) {
      keypair = existing.channelIndex !== undefined
        ? deriveClassicManagedChannel(input.network, existing.channelIndex)
        : legacyLeaseKeypair(
          existing.channelAccount,
          input.network,
          baselineChannels.length,
          softLimit,
          leases.length,
        );
    }

    if (!keypair || keypair.publicKey() !== existing.channelAccount) {
      throw new ClassicManagedChannelServiceError(
        'The managed Classic channel reserved for this Request can no longer be derived.',
        503,
        'managed_classic_channel_unavailable',
      );
    }

    const account = await loadManagedChannelAccount(
      existing.channelAccount,
      input.network,
      options.accountLoader ?? loadAccount,
      options.channelProvisioner ?? provisionManagedChannelWithCreator,
    );
    return { accountId: existing.channelAccount, sequence: account.sequence, account, keypair };
  }

  const now = options.now ?? new Date();
  const leasedAt = now.toISOString();
  const accountLoader = options.accountLoader ?? loadAccount;
  const channelProvisioner = options.channelProvisioner ?? provisionManagedChannelWithCreator;
  const reservationOrder = [
    ...orderedChannels(input.requestId, baselineChannels),
    ...expansionChannels,
  ];

  for (const candidate of reservationOrder) {
    const channelAccount = candidate.keypair.publicKey();
    const claimed = await store.claimLease({
      network: input.network,
      channelAccount,
      channelIndex: candidate.index,
      requestId: input.requestId,
      leasedAt,
      expiresAt: input.leaseExpiresAt,
    });
    if (!claimed) continue;

    if (candidate.index >= softLimit) {
      console.warn('Managed Classic channel soft limit exceeded.', {
        network: input.network,
        channelIndex: candidate.index,
        softLimit,
      });
    }

    try {
      const account = await loadManagedChannelAccount(
        channelAccount,
        input.network,
        accountLoader,
        channelProvisioner,
      );
      return {
        accountId: channelAccount,
        sequence: account.sequence,
        account,
        keypair: candidate.keypair,
      };
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
    'All currently derivable managed Classic execution channels are in use.',
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
    networkPassphrase(network),
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
