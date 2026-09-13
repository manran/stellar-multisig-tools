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

function contractEntryForChallenge(
  envelopeXdr: string,
  network: StellarNetwork,
  entryIndex: number,
) {
  const authEntries = operationAuthEntries(envelopeXdr, network);
  const entry = authEntries[entryIndex];
  if (!entry) throw new Error(`Soroban authorization entry #${entryIndex + 1} does not exist.`);
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
  return { entry, info };
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
  if (!Number.isInteger(expirationLedger) || expirationLedger <= 0 || expirationLedger > 0xffffffff) {
    throw new Error('Soroban authorization expiration must be a valid future ledger sequence.');
  }
  const { entry, info } = contractEntryForChallenge(envelopeXdr, network, entryIndex);
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

export async function stageSorobanContractCredentialContribution({
  envelopeXdr,
  challenge,
  contribution,
}: {
  envelopeXdr: string;
  challenge: SorobanContractAuthorizationChallenge;
  contribution: SorobanContractCredentialContribution;
}): Promise<StagedSorobanContractCredential> {
  if (challenge.version !== 1 || contribution.version !== 1) {
    throw new Error('Unsupported contract authorization challenge or contribution version.');
  }
  const currentChallenge = createSorobanContractAuthorizationChallenge({
    envelopeXdr,
    network: challenge.network,
    entryIndex: challenge.entryIndex,
    expirationLedger: challenge.expirationLedger,
  });
  if (
    challenge.authorizer !== currentChallenge.authorizer
    || challenge.preimageXdr !== currentChallenge.preimageXdr
    || challenge.payloadHashHex.toLowerCase() !== currentChallenge.payloadHashHex
  ) {
    throw new Error('The contract authorization challenge is stale or belongs to a different transaction state.');
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
  const { entry } = contractEntryForChallenge(
    envelopeXdr,
    challenge.network,
    challenge.entryIndex,
  );
  const signedEntry = await authorizeEntry(
    entry,
    async () => ({ signatureScVal }),
    challenge.expirationLedger,
    passphrase(challenge.network),
  );
  return {
    envelopeXdr: replaceSorobanAuthorizationEntryXdr({
      envelopeXdr,
      network: challenge.network,
      entryIndex: challenge.entryIndex,
      replacement: signedEntry,
    }),
    challenge: currentChallenge,
    validation: 'requires-rpc-enforce',
  };
}
