import {
  FeeBumpTransaction,
  Networks,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk/base';
import type { StellarNetwork } from './types.js';

function passphrase(network: StellarNetwork): string {
  return network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
}

export function replaceSorobanAuthorizationEntryXdr({
  envelopeXdr,
  network,
  entryIndex,
  replacement,
}: {
  envelopeXdr: string;
  network: StellarNetwork;
  entryIndex: number;
  replacement: xdr.SorobanAuthorizationEntry;
}): string {
  const transaction = TransactionBuilder.fromXdr(envelopeXdr.trim(), passphrase(network));
  if (transaction instanceof FeeBumpTransaction) {
    throw new Error('Soroban authorization entry replacement does not support fee-bump envelopes yet.');
  }
  if (transaction.operations.length !== 1 || transaction.operations[0]?.type !== 'invokeHostFunction') {
    throw new Error('Soroban authorization entry replacement requires exactly one InvokeHostFunction operation.');
  }
  if (transaction.signatures.length > 0) {
    throw new Error('Soroban authorization must be finalized before transaction-envelope signatures are collected.');
  }
  const envelope = transaction.toEnvelope();
  if (envelope.type !== 'envelopeTypeTx') {
    throw new Error('Soroban authorization entry replacement requires a v1 transaction envelope.');
  }
  const tx = envelope.value.tx;
  const operation = tx.operations[0];
  if (!operation || operation.body.type !== 'invokeHostFunction') {
    throw new Error('Unexpected non-Soroban operation.');
  }
  const authEntries = [...operation.body.value.auth];
  if (!authEntries[entryIndex]) {
    throw new Error(`Soroban authorization entry #${entryIndex + 1} does not exist.`);
  }
  authEntries[entryIndex] = replacement;
  const body = xdr.OperationBody.invokeHostFunction(
    new xdr.InvokeHostFunctionOp({
      hostFunction: operation.body.value.hostFunction,
      auth: authEntries,
    }),
  );
  const replacementOperation = new xdr.Operation({
    sourceAccount: operation.sourceAccount,
    body,
  });
  const replacementTransaction = new xdr.Transaction({
    sourceAccount: tx.sourceAccount,
    fee: tx.fee,
    seqNum: tx.seqNum,
    cond: tx.cond,
    memo: tx.memo,
    operations: [replacementOperation],
    ext: tx.ext,
  });
  return xdr.TransactionEnvelope.envelopeTypeTx(
    new xdr.TransactionV1Envelope({
      tx: replacementTransaction,
      signatures: [],
    }),
  ).toXdr('base64');
}
