import {
  FeeBumpTransaction,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  inspectAuthEntry,
  xdr,
} from '@stellar/stellar-sdk/base';
import type {
  SorobanContractAuthorizationChallenge,
  SorobanContractCredentialContribution,
} from './sorobanCustomAuthorization.js';
import type { StellarNetwork } from './types.js';

export interface SimpleEd25519ContractAccountAdapter {
  id: 'simple-ed25519-v1';
  label: 'Simple Ed25519 contract account';
  provenance: 'project-configured';
  network: StellarNetwork;
  contractAddress: string;
  ownerAddress: string;
}

export interface KnownSorobanContractAuthorizationStatus {
  supported: boolean;
  ready: boolean;
  expired: boolean;
  reason?: string;
  authorizer?: {
    entryIndex: number;
    authorizer: string;
    expirationLedger: number;
    signed: boolean;
    adapter: SimpleEd25519ContractAccountAdapter;
  };
}

function passphrase(network: StellarNetwork): string {
  return network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
}

function configuredValues(network: StellarNetwork): { contractAddress: string; ownerAddress: string } {
  return network === 'testnet'
    ? {
        contractAddress: process.env.STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_CONTRACT?.trim() ?? '',
        ownerAddress: process.env.STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_OWNER?.trim() ?? '',
      }
    : {
        contractAddress: process.env.STELLAR_SOROBAN_SIMPLE_ACCOUNT_PUBLIC_CONTRACT?.trim() ?? '',
        ownerAddress: process.env.STELLAR_SOROBAN_SIMPLE_ACCOUNT_PUBLIC_OWNER?.trim() ?? '',
      };
}

export function configuredSimpleEd25519ContractAccountAdapter(
  network: StellarNetwork,
): SimpleEd25519ContractAccountAdapter | null {
  const configured = configuredValues(network);
  if (!configured.contractAddress && !configured.ownerAddress) return null;
  if (!configured.contractAddress || !configured.ownerAddress) {
    throw new Error('Simple Ed25519 contract-account adapter configuration is incomplete.');
  }
  if (!StrKey.isValidContract(configured.contractAddress)) {
    throw new Error('Simple Ed25519 contract-account adapter has an invalid C-address.');
  }
  if (!StrKey.isValidEd25519PublicKey(configured.ownerAddress)) {
    throw new Error('Simple Ed25519 contract-account adapter has an invalid owner G-address.');
  }
  return {
    id: 'simple-ed25519-v1',
    label: 'Simple Ed25519 contract account',
    provenance: 'project-configured',
    network,
    ...configured,
  };
}

export function resolveSimpleEd25519ContractAccountAdapter(
  network: StellarNetwork,
  authorizer: string,
): SimpleEd25519ContractAccountAdapter | null {
  const adapter = configuredSimpleEd25519ContractAccountAdapter(network);
  return adapter?.contractAddress === authorizer ? adapter : null;
}

function parsedSorobanTransaction(envelopeXdr: string, network: StellarNetwork) {
  const parsed = TransactionBuilder.fromXdr(envelopeXdr.trim(), passphrase(network));
  if (parsed instanceof FeeBumpTransaction) {
    throw new Error('Known contract-account authorization does not support fee-bump envelopes yet.');
  }
  if (parsed.operations.length !== 1 || parsed.operations[0]?.type !== 'invokeHostFunction') {
    throw new Error('Known contract-account authorization requires exactly one InvokeHostFunction operation.');
  }
  const envelope = parsed.toEnvelope();
  if (envelope.type !== 'envelopeTypeTx' || envelope.value.tx.ext.type !== 'sorobanData') {
    throw new Error('Soroban execution resources must be assembled before contract-account authorization.');
  }
  return parsed;
}

export function analyzeKnownSorobanContractAuthorizationEntries({
  authEntries,
  network,
  currentLedger,
}: {
  authEntries: readonly xdr.SorobanAuthorizationEntry[];
  network: StellarNetwork;
  currentLedger: number;
}): KnownSorobanContractAuthorizationStatus {
  const detached = authEntries
    .map((entry, entryIndex) => ({ entryIndex, info: inspectAuthEntry(entry) }))
    .filter(({ info }) => info.credentialType !== 'sourceAccount');
  if (detached.length !== 1) {
    return {
      supported: false,
      ready: false,
      expired: false,
      reason: 'Known contract-account authorization supports exactly one detached contract authorizer in this milestone.',
    };
  }
  const [{ entryIndex, info }] = detached;
  if (info.credentialType === 'addressWithDelegates') {
    return {
      supported: false,
      ready: false,
      expired: false,
      reason: 'Delegated contract authorization requires a different explicit adapter.',
    };
  }
  if (!info.address || !StrKey.isValidContract(info.address)) {
    return {
      supported: false,
      ready: false,
      expired: false,
      reason: 'This detached Soroban authorizer is not a supported contract account.',
    };
  }
  const adapter = resolveSimpleEd25519ContractAccountAdapter(network, info.address);
  if (!adapter) {
    return {
      supported: false,
      ready: false,
      expired: false,
      reason: 'This contract account has no explicitly configured authorization adapter and remains read-only.',
    };
  }
  const expirationLedger = info.signatureExpirationLedger ?? 0;
  const expired = expirationLedger > 0 && expirationLedger <= currentLedger;
  return {
    supported: true,
    ready: info.signed && !expired,
    expired,
    authorizer: {
      entryIndex,
      authorizer: info.address,
      expirationLedger,
      signed: info.signed,
      adapter,
    },
  };
}

export function analyzeKnownSorobanContractAuthorization({
  envelopeXdr,
  network,
  currentLedger,
}: {
  envelopeXdr: string;
  network: StellarNetwork;
  currentLedger: number;
}): KnownSorobanContractAuthorizationStatus {
  const parsed = parsedSorobanTransaction(envelopeXdr, network);
  const operation = parsed.operations[0];
  if (operation.type !== 'invokeHostFunction') throw new Error('Unexpected non-Soroban operation.');
  return analyzeKnownSorobanContractAuthorizationEntries({
    authEntries: operation.auth ?? [],
    network,
    currentLedger,
  });
}

function decodeHex32(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error('Contract-account authorization challenge has an invalid payload hash.');
  }
  return Uint8Array.from(
    value.match(/../g) ?? [],
    (byte) => Number.parseInt(byte, 16),
  );
}

function decodeBase64Signature(value: string): Uint8Array {
  let decoded: Uint8Array;
  try {
    const binary = atob(value);
    decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error('The wallet returned an invalid contract-account authorization signature.');
  }
  if (decoded.length !== 64) {
    throw new Error('Simple Ed25519 contract-account authorization requires an exact 64-byte signature.');
  }
  return decoded;
}

export function simpleEd25519ContractCredentialContribution({
  challenge,
  adapter,
  signerAddress,
  signatureBase64,
}: {
  challenge: SorobanContractAuthorizationChallenge;
  adapter: SimpleEd25519ContractAccountAdapter;
  signerAddress: string;
  signatureBase64: string;
}): SorobanContractCredentialContribution {
  if (adapter.network !== challenge.network || adapter.contractAddress !== challenge.authorizer) {
    throw new Error('The configured contract-account adapter does not own this authorization challenge.');
  }
  if (signerAddress !== adapter.ownerAddress) {
    throw new Error('The selected wallet is not the configured owner of this contract account.');
  }
  const signature = decodeBase64Signature(signatureBase64);
  const payload = decodeHex32(challenge.payloadHashHex);
  if (payload.length !== 32 || !Keypair.fromPublicKey(adapter.ownerAddress).verify(payload, signature)) {
    throw new Error('The wallet signature does not verify against the configured contract-account owner and Review challenge.');
  }
  return {
    version: 1,
    network: challenge.network,
    entryIndex: challenge.entryIndex,
    authorizer: challenge.authorizer,
    expirationLedger: challenge.expirationLedger,
    payloadHashHex: challenge.payloadHashHex,
    signatureScValXdr: xdr.ScVal.scvBytes(signature).toXdr('base64'),
  };
}
