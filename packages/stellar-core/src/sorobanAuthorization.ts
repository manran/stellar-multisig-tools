import {
  FeeBumpTransaction,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  authorizeEntry,
  buildAuthorizationEntryPreimage,
  hash,
  inspectAuthEntry,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk/base';
import type { StellarAccountSnapshot, StellarNetwork } from './types.js';
import { replaceSorobanAuthorizationEntryXdr } from './sorobanEnvelope.js';

export const DEFAULT_SOROBAN_AUTH_EXPIRATION_LEDGERS = 360;
const MAX_G_ACCOUNT_AUTH_SIGNATURES = 20;

export interface SorobanAuthSignerEvidence {
  publicKey: string;
  weight: number;
}

export interface SorobanGAccountAuthorizerStatus {
  entryIndex: number;
  authorizer: string;
  credentialType: 'address' | 'addressV2';
  expirationLedger: number;
  threshold: number;
  signedWeight: number;
  signerEvidence: SorobanAuthSignerEvidence[];
  activeSigners: SorobanAuthSignerEvidence[];
  ready: boolean;
}

export interface SorobanGAccountAuthorizationStatus {
  supported: boolean;
  ready: boolean;
  expired: boolean;
  reason?: string;
  authorizers: SorobanGAccountAuthorizerStatus[];
}

export type SorobanAccountLoader = (
  accountId: string,
  network: StellarNetwork,
) => Promise<StellarAccountSnapshot>;

function passphrase(network: StellarNetwork): string {
  return network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
}

function parsedSorobanTransaction(envelopeXdr: string, network: StellarNetwork) {
  const parsed = TransactionBuilder.fromXdr(envelopeXdr.trim(), passphrase(network));
  if (parsed instanceof FeeBumpTransaction) {
    throw new Error('Soroban authorization preparation does not support fee-bump envelopes yet.');
  }
  if (parsed.operations.length !== 1 || parsed.operations[0]?.type !== 'invokeHostFunction') {
    throw new Error('Soroban authorization preparation requires exactly one InvokeHostFunction operation.');
  }
  return parsed;
}

function decodeBase64(value: string): Uint8Array {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error('The wallet returned an invalid Soroban authorization signature.');
  }
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

function comparePublicKeys(left: string, right: string): number {
  return compareBytes(
    StrKey.decodeEd25519PublicKey(left),
    StrKey.decodeEd25519PublicKey(right),
  );
}

function standardSignatureScVal(
  signatures: Array<{ publicKey: string; signature: Uint8Array }>,
): xdr.ScVal {
  return xdr.ScVal.scvVec(
    [...signatures]
      .sort((left, right) => comparePublicKeys(left.publicKey, right.publicKey))
      .map(({ publicKey, signature }) => nativeToScVal(
        {
          public_key: StrKey.decodeEd25519PublicKey(publicKey),
          signature,
        },
        {
          type: {
            public_key: ['symbol', null],
            signature: ['symbol', null],
          },
        },
      )),
  );
}

function standardGAccountSignatures(info: ReturnType<typeof inspectAuthEntry>) {
  if (info.signers.length !== 1) return null;
  const signatures = info.signers[0].signatures;
  if (signatures !== null) return signatures;
  return info.signed ? null : [];
}

export function assertSorobanTransactionPreparedForFreeze(
  envelopeXdr: string,
  network: StellarNetwork,
): void {
  const transaction = parsedSorobanTransaction(envelopeXdr, network);
  const envelope = transaction.toEnvelope();
  if (envelope.type !== 'envelopeTypeTx' || envelope.value.tx.ext.type !== 'sorobanData') {
    throw new Error('Soroban execution resources have not been assembled yet. Run RPC simulation before starting Sign.');
  }
}

function operationAuthEntries(envelopeXdr: string, network: StellarNetwork) {
  const transaction = parsedSorobanTransaction(envelopeXdr, network);
  const operation = transaction.operations[0];
  if (operation.type !== 'invokeHostFunction') throw new Error('Unexpected non-Soroban operation.');
  return { transaction, operation, authEntries: [...(operation.auth ?? [])] };
}

export function sorobanAuthorizationEntryPreimageXdr({
  entry,
  network,
  expirationLedger,
}: {
  entry: xdr.SorobanAuthorizationEntry;
  network: StellarNetwork;
  expirationLedger: number;
}): string {
  if (!Number.isInteger(expirationLedger) || expirationLedger <= 0 || expirationLedger > 0xffffffff) {
    throw new Error('Soroban authorization expiration must be a valid future ledger sequence.');
  }
  const info = inspectAuthEntry(entry);
  if (info.credentialType === 'sourceAccount') {
    throw new Error('The transaction source authorization is covered by the transaction envelope.');
  }
  if (info.credentialType === 'addressWithDelegates') {
    throw new Error('Delegated Soroban authorization is not supported in the Intent signing milestone.');
  }
  if (!info.address) {
    throw new Error('This Soroban authorization entry does not expose a detached address authorizer.');
  }
  if (info.signed && info.signatureExpirationLedger !== expirationLedger) {
    throw new Error('Existing Soroban signatures use a different expiration ledger. Start from one shared authorization window.');
  }
  return buildAuthorizationEntryPreimage(entry, expirationLedger, passphrase(network)).toXdr('base64');
}

export function sorobanAuthorizationPreimageXdr({
  envelopeXdr,
  network,
  entryIndex,
  expirationLedger,
}: {
  envelopeXdr: string;
  network: StellarNetwork;
  entryIndex: number;
  expirationLedger: number;
}): string {
  const { authEntries } = operationAuthEntries(envelopeXdr, network);
  const entry = authEntries[entryIndex];
  if (!entry) throw new Error(`Soroban authorization entry #${entryIndex + 1} does not exist.`);
  return sorobanAuthorizationEntryPreimageXdr({ entry, network, expirationLedger });
}

export async function initializeSorobanGAccountAuthorizationWindow({
  envelopeXdr,
  network,
  currentLedger,
  expirationLedgers = DEFAULT_SOROBAN_AUTH_EXPIRATION_LEDGERS,
}: {
  envelopeXdr: string;
  network: StellarNetwork;
  currentLedger: number;
  expirationLedgers?: number;
}): Promise<string> {
  if (!Number.isInteger(currentLedger) || currentLedger < 0) {
    throw new Error('A current Stellar ledger sequence is required to initialize Soroban authorization.');
  }
  if (!Number.isInteger(expirationLedgers) || expirationLedgers <= 0) {
    throw new Error('Soroban authorization lifetime must be a positive ledger count.');
  }
  const expirationLedger = currentLedger + expirationLedgers;
  if (expirationLedger > 0xffffffff) throw new Error('Soroban authorization expiration exceeds the supported ledger range.');

  let workingXdr = envelopeXdr;
  const initial = operationAuthEntries(workingXdr, network).authEntries;
  for (let entryIndex = 0; entryIndex < initial.length; entryIndex += 1) {
    const current = operationAuthEntries(workingXdr, network).authEntries[entryIndex];
    const info = inspectAuthEntry(current);
    if (info.credentialType === 'sourceAccount') continue;
    if (info.credentialType === 'addressWithDelegates') {
      throw new Error('Delegated Soroban authorization cannot use the standard G-account collaboration flow.');
    }
    if (!info.address?.startsWith('G')) continue;
    const signatures = standardGAccountSignatures(info);
    if (signatures === null) {
      throw new Error('This Soroban authorization entry does not use the standard G-account Ed25519 signature format.');
    }
    if (signatures.length > 0) {
      if ((info.signatureExpirationLedger ?? 0) <= currentLedger) {
        throw new Error('Existing Soroban authorization signatures have expired. Re-run Review to prepare a fresh authorization window.');
      }
      continue;
    }
    const initialized = await authorizeEntry(
      current,
      async () => ({ signatureScVal: standardSignatureScVal([]) }),
      expirationLedger,
      passphrase(network),
    );
    workingXdr = replaceSorobanAuthorizationEntryXdr({
      envelopeXdr: workingXdr,
      network,
      entryIndex,
      replacement: initialized,
    });
  }
  return workingXdr;
}

export async function mergeSorobanGAccountSignatureEntry({
  entry,
  network,
  signerPublicKey,
  signatureBase64,
  expirationLedger,
}: {
  entry: xdr.SorobanAuthorizationEntry;
  network: StellarNetwork;
  signerPublicKey: string;
  signatureBase64: string;
  expirationLedger: number;
}): Promise<xdr.SorobanAuthorizationEntry> {
  if (!StrKey.isValidEd25519PublicKey(signerPublicKey)) {
    throw new Error('The wallet did not return a valid Stellar Ed25519 signer address.');
  }
  const info = inspectAuthEntry(entry);
  if (info.credentialType === 'sourceAccount') {
    throw new Error('The transaction source authorization is covered by the transaction envelope.');
  }
  if (info.credentialType === 'addressWithDelegates') {
    throw new Error('Delegated Soroban authorization is not supported in the G-account signing milestone.');
  }
  if (!info.address?.startsWith('G')) {
    throw new Error('Only Stellar G-account Soroban authorizers are supported in this milestone.');
  }
  const existingSignatures = standardGAccountSignatures(info);
  if (existingSignatures === null) {
    throw new Error('This Soroban authorization entry does not use the standard G-account Ed25519 signature format.');
  }
  if (info.signed && info.signatureExpirationLedger !== expirationLedger) {
    throw new Error('Existing Soroban signatures use a different expiration ledger.');
  }

  const signature = decodeBase64(signatureBase64);
  if (signature.length !== 64) throw new Error('The wallet returned an invalid Soroban authorization signature.');
  const preimage = buildAuthorizationEntryPreimage(entry, expirationLedger, passphrase(network));
  const payload = hash(preimage.toXdr());
  if (!Keypair.fromPublicKey(signerPublicKey).verify(payload, signature)) {
    throw new Error('The wallet signature does not match this Soroban authorization payload.');
  }

  const existing = existingSignatures.map((item) => ({
    publicKey: item.publicKey,
    signature: item.signature,
  }));
  const duplicate = existing.find((item) => item.publicKey === signerPublicKey);
  if (duplicate) {
    if (compareBytes(duplicate.signature, signature) === 0) return entry;
    throw new Error('This Stellar signer already contributed a different Soroban authorization signature.');
  }
  if (existing.length >= MAX_G_ACCOUNT_AUTH_SIGNATURES) {
    throw new Error('A Soroban G-account authorization cannot carry more than 20 signatures.');
  }
  return authorizeEntry(
    entry,
    async () => ({
      signatureScVal: standardSignatureScVal([...existing, { publicKey: signerPublicKey, signature }]),
    }),
    expirationLedger,
    passphrase(network),
  );
}

export async function mergeSorobanGAccountSignature({
  envelopeXdr,
  network,
  entryIndex,
  signerPublicKey,
  signatureBase64,
  expirationLedger,
}: {
  envelopeXdr: string;
  network: StellarNetwork;
  entryIndex: number;
  signerPublicKey: string;
  signatureBase64: string;
  expirationLedger: number;
}): Promise<string> {
  const { authEntries } = operationAuthEntries(envelopeXdr, network);
  const entry = authEntries[entryIndex];
  if (!entry) throw new Error(`Soroban authorization entry #${entryIndex + 1} does not exist.`);
  const signedEntry = await mergeSorobanGAccountSignatureEntry({
    entry,
    network,
    signerPublicKey,
    signatureBase64,
    expirationLedger,
  });
  return replaceSorobanAuthorizationEntryXdr({
    envelopeXdr,
    network,
    entryIndex,
    replacement: signedEntry,
  });
}

function isCanonicalSignerOrder(signatures: Array<{ publicKey: string }>): boolean {
  for (let index = 1; index < signatures.length; index += 1) {
    if (comparePublicKeys(signatures[index - 1].publicKey, signatures[index].publicKey) >= 0) return false;
  }
  return true;
}

export async function analyzeSorobanGAccountAuthorizationEntries({
  authEntries,
  network,
  currentLedger,
  accountLoader,
}: {
  authEntries: xdr.SorobanAuthorizationEntry[];
  network: StellarNetwork;
  currentLedger: number;
  accountLoader: SorobanAccountLoader;
}): Promise<SorobanGAccountAuthorizationStatus> {
  if (!Number.isInteger(currentLedger) || currentLedger < 0) {
    throw new Error('A current Stellar ledger sequence is required to verify Soroban authorization.');
  }
  const authorizers: SorobanGAccountAuthorizerStatus[] = [];
  let expired = false;

  for (let entryIndex = 0; entryIndex < authEntries.length; entryIndex += 1) {
    const entry = authEntries[entryIndex];
    let info;
    try {
      info = inspectAuthEntry(entry);
    } catch (cause) {
      return {
        supported: false,
        ready: false,
        expired: false,
        reason: cause instanceof Error ? cause.message : 'Unable to inspect Soroban authorization credentials.',
        authorizers,
      };
    }
    if (info.credentialType === 'sourceAccount') continue;
    if (info.credentialType === 'addressWithDelegates') {
      return {
        supported: false,
        ready: false,
        expired: false,
        reason: 'Delegated Soroban authorization is not supported in the G-account signing milestone.',
        authorizers,
      };
    }
    const authorizer = info.address;
    if (authorizer && StrKey.isValidContract(authorizer)) {
      return {
        supported: false,
        ready: false,
        expired: false,
        reason: 'This C-account authorization is not handled by the G-account analyzer. Explicitly configured C-account adapters are coordinated through Soroban Intent; unknown C-account credentials remain unsupported and fail closed.',
        authorizers,
      };
    }
    if (!authorizer || !StrKey.isValidEd25519PublicKey(authorizer)) {
      return {
        supported: false,
        ready: false,
        expired: false,
        reason: 'This Soroban authorization address type is inspect-only and cannot be prepared for signing yet.',
        authorizers,
      };
    }
    const signatures = standardGAccountSignatures(info);
    if (signatures === null) {
      return {
        supported: false,
        ready: false,
        expired: false,
        reason: `Soroban authorization for ${authorizer} does not use the standard G-account Ed25519 signature format.`,
        authorizers,
      };
    }
    const expirationLedger = info.signatureExpirationLedger ?? 0;
    const entryExpired = expirationLedger <= currentLedger;
    expired ||= entryExpired;
    if (signatures.length > MAX_G_ACCOUNT_AUTH_SIGNATURES) {
      return { supported: false, ready: false, expired, reason: 'Soroban G-account authorization contains more than 20 signatures.', authorizers };
    }
    if (!isCanonicalSignerOrder(signatures)) {
      return { supported: false, ready: false, expired, reason: `Soroban authorization signatures for ${authorizer} are not in canonical public-key order.`, authorizers };
    }

    const account = await accountLoader(authorizer, network);
    const signerByKey = new Map(
      account.signers
        .filter((signer) => signer.type === 'ed25519_public_key' && signer.weight > 0)
        .map((signer) => [signer.key, signer] as const),
    );
    const activeSigners = [...signerByKey.values()].map((signer) => ({
      publicKey: signer.key,
      weight: signer.weight,
    }));
    const preimage = buildAuthorizationEntryPreimage(entry, expirationLedger, passphrase(network));
    const payload = hash(preimage.toXdr());
    const signerEvidence: SorobanAuthSignerEvidence[] = [];
    const seen = new Set<string>();
    let signedWeight = 0;
    for (const signature of signatures) {
      if (seen.has(signature.publicKey)) {
        return { supported: false, ready: false, expired, reason: `Soroban authorization for ${authorizer} contains a duplicate signer.`, authorizers };
      }
      seen.add(signature.publicKey);
      const signer = signerByKey.get(signature.publicKey);
      if (!signer) {
        return { supported: false, ready: false, expired, reason: `${signature.publicKey} is not a current Ed25519 signer for Soroban authorizer ${authorizer}.`, authorizers };
      }
      if (!Keypair.fromPublicKey(signature.publicKey).verify(payload, signature.signature)) {
        return { supported: false, ready: false, expired, reason: `Soroban authorization contains an invalid signature from ${signature.publicKey}.`, authorizers };
      }
      signedWeight += signer.weight;
      signerEvidence.push({ publicKey: signature.publicKey, weight: signer.weight });
    }
    const threshold = account.thresholds.medium;
    const ready = !entryExpired && signatures.length > 0 && signedWeight >= threshold;
    authorizers.push({
      entryIndex,
      authorizer,
      credentialType: info.credentialType,
      expirationLedger,
      threshold,
      signedWeight,
      signerEvidence,
      activeSigners,
      ready,
    });
  }

  return {
    supported: true,
    ready: !expired && authorizers.every((item) => item.ready),
    expired,
    authorizers,
  };
}

export async function analyzeSorobanGAccountAuthorization({
  envelopeXdr,
  network,
  currentLedger,
  accountLoader,
}: {
  envelopeXdr: string;
  network: StellarNetwork;
  currentLedger: number;
  accountLoader: SorobanAccountLoader;
}): Promise<SorobanGAccountAuthorizationStatus> {
  const { authEntries } = operationAuthEntries(envelopeXdr, network);
  return analyzeSorobanGAccountAuthorizationEntries({
    authEntries,
    network,
    currentLedger,
    accountLoader,
  });
}
