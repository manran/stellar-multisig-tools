import { Keypair } from '@stellar/stellar-sdk/base';
import type { StellarNetwork } from '../../../../src/stellar/types.js';

const MAX_CHANNELS_PER_NETWORK = 64;

export class ClassicManagedChannelConfigurationError extends Error {
  readonly status = 503;
  readonly code = 'managed_classic_channel_configuration_invalid';
  constructor(message: string) {
    super(message);
    this.name = 'ClassicManagedChannelConfigurationError';
  }
}

function parseNetworkSecrets(value: unknown, network: StellarNetwork): Keypair[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ClassicManagedChannelConfigurationError(
      `Managed Classic channel config for ${network} must be an array of Stellar secret seeds.`,
    );
  }
  if (value.length > MAX_CHANNELS_PER_NETWORK) {
    throw new ClassicManagedChannelConfigurationError(
      `Managed Classic channel config for ${network} exceeds ${MAX_CHANNELS_PER_NETWORK} accounts.`,
    );
  }
  const byAccount = new Map<string, Keypair>();
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new ClassicManagedChannelConfigurationError(
        `Managed Classic channel config for ${network} contains an invalid secret seed.`,
      );
    }
    let keypair: Keypair;
    try {
      keypair = Keypair.fromSecret(entry.trim());
    } catch {
      throw new ClassicManagedChannelConfigurationError(
        `Managed Classic channel config for ${network} contains an invalid secret seed.`,
      );
    }
    byAccount.set(keypair.publicKey(), keypair);
  }
  return [...byAccount.values()];
}

export function configuredClassicManagedChannels(
  network: StellarNetwork,
  raw = process.env.MULTISIG_CLASSIC_CHANNEL_SECRETS_JSON,
): Keypair[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ClassicManagedChannelConfigurationError(
      'MULTISIG_CLASSIC_CHANNEL_SECRETS_JSON must be valid JSON.',
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ClassicManagedChannelConfigurationError(
      'MULTISIG_CLASSIC_CHANNEL_SECRETS_JSON must be an object keyed by testnet/public.',
    );
  }
  const record = parsed as Record<string, unknown>;
  return parseNetworkSecrets(record[network], network);
}
