import { createHmac } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk/base';
import { stellarAmountToStroops } from '../../../../src/stellar/reserve.js';
import type { StellarNetwork } from '../../../../src/stellar/types.js';

const DEFAULT_CHANNEL_COUNT = 4;
export const DEFAULT_CHANNEL_SOFT_LIMIT = 64;
const DEFAULT_CHANNEL_INITIAL_BALANCE = '2';
const DEFAULT_CREATOR_LOW_BALANCE = '50';
const DEFAULT_CREATOR_RECOVERY_BALANCE = '60';
const MIN_MASTER_SECRET_LENGTH = 32;

export class ClassicManagedChannelConfigurationError extends Error {
  readonly status = 503;
  readonly code = 'managed_classic_channel_configuration_invalid';
  constructor(message: string) {
    super(message);
    this.name = 'ClassicManagedChannelConfigurationError';
  }
}

function positiveSafeInteger(raw: string | undefined, fallback: number, variable: string): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ClassicManagedChannelConfigurationError(
      `${variable} must be a positive safe integer.`,
    );
  }
  return value;
}

function channelCount(raw = process.env.MULTISIG_CLASSIC_CHANNEL_POOL_SIZE): number {
  return positiveSafeInteger(raw, DEFAULT_CHANNEL_COUNT, 'MULTISIG_CLASSIC_CHANNEL_POOL_SIZE');
}

export function classicManagedChannelSoftLimit(
  raw = process.env.MULTISIG_CLASSIC_CHANNEL_SOFT_LIMIT,
): number {
  return positiveSafeInteger(raw, DEFAULT_CHANNEL_SOFT_LIMIT, 'MULTISIG_CLASSIC_CHANNEL_SOFT_LIMIT');
}

export function effectiveClassicManagedChannelSoftLimit(
  allocatedSlots: number,
  baseSoftLimit = classicManagedChannelSoftLimit(),
): number {
  if (!Number.isSafeInteger(allocatedSlots) || allocatedSlots < 0) {
    throw new ClassicManagedChannelConfigurationError('Allocated managed Classic channel slots must be a non-negative safe integer.');
  }
  let limit = baseSoftLimit;
  while (allocatedSlots * 2 >= limit) {
    if (limit > Math.floor(Number.MAX_SAFE_INTEGER / 2)) return Number.MAX_SAFE_INTEGER;
    limit *= 2;
  }
  return limit;
}

function normalizedMasterSecret(masterSecret = process.env.MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET): string {
  if (!masterSecret?.trim()) return '';
  const secret = masterSecret.trim();
  if (secret.length < MIN_MASTER_SECRET_LENGTH) {
    throw new ClassicManagedChannelConfigurationError(
      `MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET must contain at least ${MIN_MASTER_SECRET_LENGTH} characters of high-entropy secret material.`,
    );
  }
  return secret;
}

function derivedSeed(masterSecret: string, network: StellarNetwork, index: number): Buffer {
  return createHmac('sha256', masterSecret)
    .update('multisigtools/classic-managed-channel/v1\0')
    .update(network)
    .update('\0')
    .update(String(index))
    .digest();
}

export function deriveClassicManagedChannel(
  network: StellarNetwork,
  index: number,
  masterSecret = process.env.MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET,
): Keypair | null {
  const secret = normalizedMasterSecret(masterSecret);
  if (!secret) return null;
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new ClassicManagedChannelConfigurationError(
      'Managed Classic channel index must be a non-negative safe integer.',
    );
  }
  return Keypair.fromRawEd25519Seed(derivedSeed(secret, network, index));
}

export function configuredClassicManagedChannels(
  network: StellarNetwork,
  masterSecret = process.env.MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET,
  poolSize = process.env.MULTISIG_CLASSIC_CHANNEL_POOL_SIZE,
): Keypair[] {
  const secret = normalizedMasterSecret(masterSecret);
  if (!secret) return [];
  const count = channelCount(poolSize);
  return Array.from({ length: count }, (_, index) => (
    Keypair.fromRawEd25519Seed(derivedSeed(secret, network, index))
  ));
}

export function deriveClassicManagedChannelCreator(
  network: StellarNetwork,
  masterSecret = process.env.MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET,
): Keypair | null {
  const secret = normalizedMasterSecret(masterSecret);
  if (!secret) return null;
  const seed = createHmac('sha256', secret)
    .update('multisigtools/classic-managed-channel-creator/v1\\0')
    .update(network)
    .digest();
  return Keypair.fromRawEd25519Seed(seed);
}

function positiveStellarAmount(raw: string | undefined, fallback: string, variable: string): string {
  const value = raw?.trim() || fallback;
  try {
    if (stellarAmountToStroops(value) <= 0n) throw new Error('non-positive');
  } catch {
    throw new ClassicManagedChannelConfigurationError(
      `${variable} must be a positive Stellar XLM amount with at most 7 decimal places.`,
    );
  }
  return value;
}

export function configuredClassicManagedChannelInitialBalance(
  raw = process.env.MULTISIG_CLASSIC_CHANNEL_INITIAL_BALANCE,
): string {
  return positiveStellarAmount(raw, DEFAULT_CHANNEL_INITIAL_BALANCE, 'MULTISIG_CLASSIC_CHANNEL_INITIAL_BALANCE');
}

export function configuredClassicManagedChannelCreatorBalanceThresholds(
  lowRaw = process.env.MULTISIG_CLASSIC_CHANNEL_CREATOR_LOW_BALANCE,
  recoveryRaw = process.env.MULTISIG_CLASSIC_CHANNEL_CREATOR_RECOVERY_BALANCE,
): { low: string; recovery: string } {
  const low = positiveStellarAmount(lowRaw, DEFAULT_CREATOR_LOW_BALANCE, 'MULTISIG_CLASSIC_CHANNEL_CREATOR_LOW_BALANCE');
  const recovery = positiveStellarAmount(recoveryRaw, DEFAULT_CREATOR_RECOVERY_BALANCE, 'MULTISIG_CLASSIC_CHANNEL_CREATOR_RECOVERY_BALANCE');
  if (stellarAmountToStroops(recovery) <= stellarAmountToStroops(low)) {
    throw new ClassicManagedChannelConfigurationError(
      'MULTISIG_CLASSIC_CHANNEL_CREATOR_RECOVERY_BALANCE must be greater than the low-balance threshold.',
    );
  }
  return { low, recovery };
}
