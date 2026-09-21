import { createHmac } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk/base';
import type { StellarNetwork } from '../../../../src/stellar/types.js';

const DEFAULT_CHANNEL_COUNT = 4;
export const MAX_CHANNELS_PER_NETWORK = 64;
const MIN_MASTER_SECRET_LENGTH = 32;

export class ClassicManagedChannelConfigurationError extends Error {
  readonly status = 503;
  readonly code = 'managed_classic_channel_configuration_invalid';
  constructor(message: string) {
    super(message);
    this.name = 'ClassicManagedChannelConfigurationError';
  }
}

function channelCount(raw = process.env.MULTISIG_CLASSIC_CHANNEL_POOL_SIZE): number {
  if (!raw?.trim()) return DEFAULT_CHANNEL_COUNT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_CHANNELS_PER_NETWORK) {
    throw new ClassicManagedChannelConfigurationError(
      `MULTISIG_CLASSIC_CHANNEL_POOL_SIZE must be an integer from 1 to ${MAX_CHANNELS_PER_NETWORK}.`,
    );
  }
  return value;
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
  if (!Number.isInteger(index) || index < 0 || index >= MAX_CHANNELS_PER_NETWORK) {
    throw new ClassicManagedChannelConfigurationError(
      `Managed Classic channel index must be an integer from 0 to ${MAX_CHANNELS_PER_NETWORK - 1}.`,
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

export function expandableClassicManagedChannels(
  network: StellarNetwork,
  masterSecret = process.env.MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET,
  poolSize = process.env.MULTISIG_CLASSIC_CHANNEL_POOL_SIZE,
): Keypair[] {
  if (network !== 'testnet') return [];
  const secret = normalizedMasterSecret(masterSecret);
  if (!secret) return [];
  const baselineCount = channelCount(poolSize);
  return Array.from({ length: MAX_CHANNELS_PER_NETWORK - baselineCount }, (_, offset) => (
    Keypair.fromRawEd25519Seed(derivedSeed(secret, network, baselineCount + offset))
  ));
}
