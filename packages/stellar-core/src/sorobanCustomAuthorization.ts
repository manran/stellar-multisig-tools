import {
  FeeBumpTransaction,
  Networks,
  StrKey,
  TransactionBuilder,
  authorizeEntry,
  buildAuthorizationEntryPreimage,
  hash,
  inspectAuthEntry,
  xdr,
} from '@stellar/stellar-sdk/base';
import { DEFAULT_SOROBAN_AUTH_EXPIRATION_LEDGERS } from './sorobanAuthorization.js';
import type { StellarNetwork } from './types.js';
import { replaceSorobanAuthorizationEntryXdr } from './sorobanEnvelope.js';

export interface SorobanContractAuthorizationChallenge {
  version: 1;
  network: StellarNetwork;
  entryIndex: number;
  authorizer: string;
  expirationLedger: number;
  preimageXdr: string;
  payloadHashHex: string;
}

export interface SorobanContractCredentialContribution {
  version: 1;
  network: StellarNetwork;
  entryIndex: number;
  authorizer: string;
  expirationLedger: number;
  payloadHashHex: string;
  signatureScValXdr: string;
}

export interface StagedSorobanContractCredential {
  envelopeXdr: string;
  challenge: SorobanContractAuthorizationChallenge;
  validation: 'requires-rpc-enforce';
}

export interface StagedSorobanContractCredentialEntry {
  entry: xdr.SorobanAuthorizationEntry;
  challenge: SorobanContractAuthorizationChallenge;
  validation: 'requires-rpc-enforce';
}

function passphrase(network: StellarNetwork): string {
  return network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parsedSorobanTransaction(envelopeXdr: string, network: StellarNetwork) {
  const parsed = TransactionBuilder.fromXdr(envelopeXdr.trim(), passphrase(network));
  if (parsed instanceof FeeBumpTransaction) {
    throw new Error('Contract-account authorization does not support fee-bump envelopes yet.');
  }
  if (parsed.operations.length !== 1 || parsed.operations[0]?.type !== 'invokeHostFunction') {
    throw new Error('Contract-account authorization requires exactly one InvokeHostFunction operation.');
  }
  const envelope = parsed.toEnvelope();
  if (envelope.type !== 'envelopeTypeTx' || envelope.value.tx.ext.type !== 'sorobanData') {
    throw new Error('Soroban execution resources must be assembled before contract-account authorization.');
  }
  if (parsed.signatures.length > 0) {
    throw new Error('Contract-account authorization must be finalized before transaction-envelope signatures are collected.');
  }
  return parsed;
}

function operationAuthEntries(envelopeXdr: string, network: StellarNetwork) {
  const transaction = parsedSorobanTransaction(envelopeXdr, network);
  const operation = transaction.operations[0];
  if (operation.type !== 'invokeHostFunction') throw new Error('Unexpected non-Soroban operation.');
  return [...(operation.auth ?? [])];
}

function contractEntryForChallengeValue(
  entry: xdr.SorobanAuthorizationEntry,
  entryIndex: number,
) {
  const info = inspectAuthEntry(entry);
  if (info.credentialType === 'sourceAccount') {
    throw new Error('Transaction-source authorization is covered by the transaction envelope.');
  }
  if (info.credentialType === 'addressWithDelegates') {
    throw new Error('Delegated contract authorization requires its own adapter and is not accepted as a direct C-account credential.');
  }
  if (!info.address || !StrKey.isValidContract(info.address)) {
    throw new Error('A contract-account authorization challenge requires a C-address authorizer.');
  }
  if (info.signed) {
    throw new Error('This contract-account authorization entry already contains credential evidence. Start from a fresh recorded authorization entry.');
  }
  return { entry, info, entryIndex };
}

function contractEntryForChallenge(
  envelopeXdr: string,
  network: StellarNetwork,
  entryIndex: number,
) {
  const authEntries = operationAuthEntries(envelopeXdr, network);
  const entry = authEntries[entryIndex];
  if (!entry) throw new Error(`Soroban authorization entry #${entryIndex + 1} does not exist.`);
  return contractEntryForChallengeValue(entry, entryIndex);
}

export function createSorobanContractAuthorizationChallengeForEntry({
  entry,
  network,
  entryIndex,
  expirationLedger,
}: {
  entry: xdr.SorobanAuthorizationEntry;
  network: StellarNetwork;
  entryIndex: number;
  expirationLedger: number;
}): SorobanContractAuthorizationChallenge {
  if (!Number.isInteger(expirationLedger) || expirationLedger <= 0 || expirationLedger > 0xffffffff) {
    throw new Error('Soroban authorization expiration must be a valid future ledger sequence.');
  }
  const { info } = contractEntryForChallengeValue(entry, entryIndex);
  const preimage = buildAuthorizationEntryPreimage(entry, expirationLedger, passphrase(network));
  return {
    version: 1,
    network,
    entryIndex,
    authorizer: info.address!,
    expirationLedger,
    preimageXdr: preimage.toXdr('base64'),
    payloadHashHex: bytesToHex(hash(preimage.toXdr())),
  };
}

export function createSorobanContractAuthorizationChallenge({
  envelopeXdr,
  network,
  entryIndex,
  expirationLedger,
}: {
  envelopeXdr: string;
  network: StellarNetwork;
  entryIndex: number;
  expirationLedger: number;
}): SorobanContractAuthorizationChallenge {
  const { entry } = contractEntryForChallenge(envelopeXdr, network, entryIndex);
  return createSorobanContractAuthorizationChallengeForEntry({ entry, network, entryIndex, expirationLedger });
}

export async function initializeSorobanContractAccountAuthorizationWindow({
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
    throw new Error('A current Stellar ledger sequence is required to initialize contract-account authorization.');
  }
  if (!Number.isInteger(expirationLedgers) || expirationLedgers <= 0) {
    throw new Error('Soroban authorization lifetime must be a positive ledger count.');
  }
  const expirationLedger = currentLedger + expirationLedgers;
  if (expirationLedger > 0xffffffff) throw new Error('Soroban authorization expiration exceeds the supported ledger range.');

  let workingXdr = envelopeXdr;
  const initial = operationAuthEntries(workingXdr, network);
  for (let entryIndex = 0; entryIndex < initial.length; entryIndex += 1) {
    const current = operationAuthEntries(workingXdr, network)[entryIndex];
    const info = inspectAuthEntry(current);
    if (info.credentialType === 'sourceAccount') continue;
    if (info.credentialType === 'addressWithDelegates') {
      throw new Error('Delegated contract authorization requires its own adapter and is not supported by Intent coordination.');
    }
    if (!info.address || !StrKey.isValidContract(info.address)) continue;
    if (info.signed) {
      throw new Error('Existing contract-account credential evidence cannot be re-windowed. Start from an unsigned authorization entry.');
    }
    const existingExpiration = info.signatureExpirationLedger ?? 0;
    if (existingExpiration > 0) {
      if (existingExpiration <= currentLedger) {
        throw new Error('Existing contract-account authorization has expired. Create a fresh Soroban Intent.');
      }
      continue;
    }
    const initialized = await authorizeEntry(
      current,
      async () => ({ signatureScVal: xdr.ScVal.scvVoid() }),
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

function decodeSignatureScVal(value: string): xdr.ScVal {
  let signatureScVal: xdr.ScVal;
  try {
    signatureScVal = xdr.ScVal.fromXdr(value.trim(), 'base64');
  } catch {
    throw new Error('The contract credential is not a valid ScVal XDR payload.');
  }
  if (signatureScVal.type === 'scvVoid') {
    throw new Error('The contract credential cannot use an empty ScVal payload.');
  }
  return signatureScVal;
}

export async function stageSorobanContractCredentialContributionEntry({
  entry,
  challenge,
  contribution,
}: {
  entry: xdr.SorobanAuthorizationEntry;
  challenge: SorobanContractAuthorizationChallenge;
  contribution: SorobanContractCredentialContribution;
}): Promise<StagedSorobanContractCredentialEntry> {
  if (challenge.version !== 1 || contribution.version !== 1) {
    throw new Error('Unsupported contract authorization challenge or contribution version.');
  }
  const currentChallenge = createSorobanContractAuthorizationChallengeForEntry({
    entry,
    network: challenge.network,
    entryIndex: challenge.entryIndex,
    expirationLedger: challenge.expirationLedger,
  });
  if (
    challenge.authorizer !== currentChallenge.authorizer
    || challenge.preimageXdr !== currentChallenge.preimageXdr
    || challenge.payloadHashHex.toLowerCase() !== currentChallenge.payloadHashHex
  ) {
    throw new Error('The contract authorization challenge is stale or belongs to a different authorization state.');
  }
  if (
    contribution.network !== challenge.network
    || contribution.entryIndex !== challenge.entryIndex
    || contribution.expirationLedger !== challenge.expirationLedger
    || contribution.authorizer !== challenge.authorizer
  ) {
    throw new Error('The contract credential does not answer this exact authorization challenge.');
  }
  if (contribution.payloadHashHex.toLowerCase() !== challenge.payloadHashHex.toLowerCase()) {
    throw new Error('The contract credential does not match this exact Soroban authorization payload.');
  }
  const signatureScVal = decodeSignatureScVal(contribution.signatureScValXdr);
  const { entry: currentEntry } = contractEntryForChallengeValue(entry, challenge.entryIndex);
  const signedEntry = await authorizeEntry(
    currentEntry,
    async () => ({ signatureScVal }),
    challenge.expirationLedger,
    passphrase(challenge.network),
  );
  return { entry: signedEntry, challenge: currentChallenge, validation: 'requires-rpc-enforce' };
}

export async function stageSorobanContractCredentialContribution({
  envelopeXdr,
  challenge,
  contribution,
}: {
  envelopeXdr: string;
  challenge: SorobanContractAuthorizationChallenge;
  contribution: SorobanContractCredentialContribution;
}): Promise<StagedSorobanContractCredential> {
  const { entry } = contractEntryForChallenge(envelopeXdr, challenge.network, challenge.entryIndex);
  const staged = await stageSorobanContractCredentialContributionEntry({ entry, challenge, contribution });
  return {
    envelopeXdr: replaceSorobanAuthorizationEntryXdr({
      envelopeXdr,
      network: challenge.network,
      entryIndex: challenge.entryIndex,
      replacement: staged.entry,
    }),
    challenge: staged.challenge,
    validation: staged.validation,
  };
}
