import {
  FeeBumpTransaction,
  Networks,
  TransactionBuilder,
} from '@stellar/stellar-sdk/base';
import type { StellarNetwork } from './types.js';

export interface SignatureMergeResult {
  mergedXdr: string;
  transactionHash: string;
  existingSignatureCount: number;
  incomingSignatureCount: number;
  addedSignatureCount: number;
  duplicateSignatureCount: number;
  totalSignatureCount: number;
}

function passphrase(network: StellarNetwork): string {
  return network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function decoratedSignatureKey(signature: { hint: { toBytes(): Uint8Array }; signature: { toBytes(): Uint8Array } }): string {
  return `${bytesToHex(signature.hint.toBytes())}:${bytesToHex(signature.signature.toBytes())}`;
}

function parseClassicTransaction(envelopeXdr: string, network: StellarNetwork) {
  const normalized = envelopeXdr.trim();
  if (!normalized) throw new Error('Paste a Stellar transaction envelope XDR.');

  const parsed = TransactionBuilder.fromXdr(normalized, passphrase(network));
  if (parsed instanceof FeeBumpTransaction) {
    throw new Error('Fee-bump signature merging is not supported yet. Finalize inner signatures before wrapping the transaction in a fee bump.');
  }
  return parsed;
}

export function transactionHashHex(envelopeXdr: string, network: StellarNetwork): string {
  return bytesToHex(parseClassicTransaction(envelopeXdr, network).hash());
}

export function mergeSignedTransactionXdr(
  baseEnvelopeXdr: string,
  incomingEnvelopeXdr: string,
  network: StellarNetwork,
): SignatureMergeResult {
  const base = parseClassicTransaction(baseEnvelopeXdr, network);
  const incoming = parseClassicTransaction(incomingEnvelopeXdr, network);
  const baseHash = base.hash();
  const incomingHash = incoming.hash();

  if (!bytesEqual(baseHash, incomingHash)) {
    throw new Error('The signed XDR contains a different transaction. Operations, source, sequence, fee, memo, or preconditions may have changed.');
  }

  const existingSignatureCount = base.signatures.length;
  const incomingSignatureCount = incoming.signatures.length;
  const existing = new Set(base.signatures.map(decoratedSignatureKey));
  const additions: typeof incoming.signatures = [];
  let duplicateSignatureCount = 0;

  for (const signature of incoming.signatures) {
    const key = decoratedSignatureKey(signature);
    if (existing.has(key)) {
      duplicateSignatureCount += 1;
      continue;
    }
    existing.add(key);
    additions.push(signature);
  }

  if (existingSignatureCount + additions.length > 20) {
    throw new Error('The merged envelope would exceed Stellar\'s 20-signature transaction limit.');
  }

  for (const signature of additions) {
    base.addDecoratedSignature(signature);
  }

  return {
    mergedXdr: base.toXdr(),
    transactionHash: bytesToHex(baseHash),
    existingSignatureCount,
    incomingSignatureCount,
    addedSignatureCount: additions.length,
    duplicateSignatureCount,
    totalSignatureCount: base.signatures.length,
  };
}
