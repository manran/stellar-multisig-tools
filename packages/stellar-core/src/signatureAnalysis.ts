import {
  FeeBumpTransaction,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  hash,
} from '@stellar/stellar-sdk/base';
import { simulateCoreSignatureCheck } from './coreSignatureSimulation.js';
import type { CoreSignerKind, CoreSignerMatch } from './coreSignatureSimulation.js';
import type { StellarNetwork, StellarSigner } from './types.js';

export type SignatureScope = 'inner' | 'outer';

export interface MatchedSignerSignature {
  signerKey: string;
  signerType: string;
  weight: number;
  automatic: boolean;
  signatureIndex?: number;
}

export interface SignatureAnalysis {
  scope: SignatureScope;
  transactionHash: Uint8Array;
  signatureCount: number;
  matchedSigners: MatchedSignerSignature[];
  matchedWeight: number;
  unmatchedSignatureIndexes: number[];
  unsupportedSignerKeys: string[];
}

export interface CoreEnvelopeSignatureCheck {
  scope: SignatureScope;
  transactionHash: Uint8Array;
  signatureCount: number;
  satisfied: boolean;
  matchedSigners: MatchedSignerSignature[];
  matchedWeight: number;
  usedSignatureIndexes: number[];
  unsupportedSignerKeys: string[];
}

interface SignatureBytes {
  hint: Uint8Array;
  signature: Uint8Array;
}

interface EnvelopeSignatureContext {
  transactionHash: Uint8Array;
  candidates: SignatureBytes[];
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

function lastFour(bytes: Uint8Array): Uint8Array {
  return bytes.slice(Math.max(0, bytes.length - 4));
}

function hintMatches(expected: Uint8Array, actual: Uint8Array): boolean {
  return expected.length === 4 && actual.length === 4 && bytesEqual(expected, actual);
}

function decodeSignedPayload(key: string): { publicKey: Uint8Array; payload: Uint8Array; hint: Uint8Array } {
  const raw = StrKey.decodeSignedPayload(key);
  if (raw.length < 40) throw new Error('Malformed signed-payload signer.');

  const publicKey = raw.slice(0, 32);
  const view = new DataView(raw.buffer, raw.byteOffset + 32, 4);
  const payloadLength = view.getUint32(0, false);
  if (payloadLength === 0 || payloadLength > 64 || raw.length < 36 + payloadLength) {
    throw new Error('Malformed signed-payload signer.');
  }

  const payload = raw.slice(36, 36 + payloadLength);
  const payloadHint = new Uint8Array(4);
  if (payload.length >= 4) payloadHint.set(payload.slice(payload.length - 4));
  else payloadHint.set(payload);

  const publicHint = lastFour(publicKey);
  const signerHint = new Uint8Array(4);
  for (let index = 0; index < 4; index += 1) {
    signerHint[index] = publicHint[index] ^ payloadHint[index];
  }

  return { publicKey, payload, hint: signerHint };
}

function signerMatchesSignature(
  signer: StellarSigner,
  transactionHash: Uint8Array,
  candidate: SignatureBytes,
): boolean {
  if (signer.key.startsWith('G')) {
    const rawKey = StrKey.decodeEd25519PublicKey(signer.key);
    if (!hintMatches(lastFour(rawKey), candidate.hint)) return false;
    return Keypair.fromPublicKey(signer.key).verify(transactionHash, candidate.signature);
  }

  if (signer.key.startsWith('X')) {
    const signerHash = StrKey.decodeSha256Hash(signer.key);
    if (!hintMatches(lastFour(signerHash), candidate.hint)) return false;
    return bytesEqual(hash(candidate.signature), signerHash);
  }

  if (signer.key.startsWith('P')) {
    const signedPayload = decodeSignedPayload(signer.key);
    if (!hintMatches(signedPayload.hint, candidate.hint)) return false;
    const publicKey = StrKey.encodeEd25519PublicKey(signedPayload.publicKey);
    return Keypair.fromPublicKey(publicKey).verify(signedPayload.payload, candidate.signature);
  }

  return false;
}

function automaticPreauthMatch(signer: StellarSigner, transactionHash: Uint8Array): boolean {
  return signer.key.startsWith('T') && bytesEqual(StrKey.decodePreAuthTx(signer.key), transactionHash);
}

function signerKind(signer: StellarSigner): CoreSignerKind | null {
  if (signer.key.startsWith('T')) return 'preauth';
  if (signer.key.startsWith('X')) return 'hashx';
  if (signer.key.startsWith('G')) return 'ed25519';
  if (signer.key.startsWith('P')) return 'signed_payload';
  return null;
}

function envelopeContext(
  envelopeXdr: string,
  network: StellarNetwork,
  scope: SignatureScope,
): EnvelopeSignatureContext {
  const parsed = TransactionBuilder.fromXdr(envelopeXdr.trim(), passphrase(network));
  const isFeeBump = parsed instanceof FeeBumpTransaction;

  if (scope === 'outer' && !isFeeBump) {
    throw new Error('Outer signature scope is only available for fee-bump transactions.');
  }

  const transaction = scope === 'outer' ? parsed : isFeeBump ? parsed.innerTransaction : parsed;
  return {
    transactionHash: transaction.hash(),
    candidates: transaction.signatures.map((decorated) => ({
      hint: decorated.hint.toBytes(),
      signature: decorated.signature.toBytes(),
    })),
  };
}

function buildCoreSignerMatches(
  signers: StellarSigner[],
  context: EnvelopeSignatureContext,
): { matches: CoreSignerMatch[]; unsupportedSignerKeys: string[] } {
  const matches: CoreSignerMatch[] = [];
  const unsupportedSignerKeys: string[] = [];

  for (const signer of signers.filter((item) => item.weight > 0)) {
    const kind = signerKind(signer);
    if (!kind) {
      unsupportedSignerKeys.push(signer.key);
      continue;
    }

    if (kind === 'preauth') {
      matches.push({
        signerKey: signer.key,
        signerType: signer.type,
        weight: signer.weight,
        kind,
        automaticMatch: automaticPreauthMatch(signer, context.transactionHash),
      });
      continue;
    }

    const matchingSignatureIndexes: number[] = [];
    for (let index = 0; index < context.candidates.length; index += 1) {
      if (signerMatchesSignature(signer, context.transactionHash, context.candidates[index])) {
        matchingSignatureIndexes.push(index);
      }
    }

    matches.push({
      signerKey: signer.key,
      signerType: signer.type,
      weight: signer.weight,
      kind,
      matchingSignatureIndexes,
    });
  }

  return { matches, unsupportedSignerKeys };
}

export function simulateEnvelopeSignatureCheck(
  envelopeXdr: string,
  network: StellarNetwork,
  signers: StellarSigner[],
  neededWeight: number,
  scope: SignatureScope = 'inner',
): CoreEnvelopeSignatureCheck {
  const context = envelopeContext(envelopeXdr, network, scope);
  const { matches, unsupportedSignerKeys } = buildCoreSignerMatches(signers, context);
  const result = simulateCoreSignatureCheck(matches, context.candidates.length, neededWeight);

  return {
    scope,
    transactionHash: context.transactionHash,
    signatureCount: context.candidates.length,
    satisfied: result.satisfied,
    matchedSigners: result.matchedSigners,
    matchedWeight: result.matchedWeight,
    usedSignatureIndexes: result.usedSignatureIndexes,
    unsupportedSignerKeys,
  };
}

export function analyzeEnvelopeSignatures(
  envelopeXdr: string,
  network: StellarNetwork,
  signers: StellarSigner[],
  scope: SignatureScope = 'inner',
): SignatureAnalysis {
  const analysis = simulateEnvelopeSignatureCheck(
    envelopeXdr,
    network,
    signers,
    Number.MAX_SAFE_INTEGER,
    scope,
  );
  const used = new Set(analysis.usedSignatureIndexes);

  return {
    scope,
    transactionHash: analysis.transactionHash,
    signatureCount: analysis.signatureCount,
    matchedSigners: analysis.matchedSigners,
    matchedWeight: analysis.matchedWeight,
    unmatchedSignatureIndexes: Array.from({ length: analysis.signatureCount }, (_, index) => index)
      .filter((index) => !used.has(index)),
    unsupportedSignerKeys: analysis.unsupportedSignerKeys,
  };
}
