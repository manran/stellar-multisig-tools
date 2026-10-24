import {
  FeeBumpTransaction,
  Networks,
  SignerKey,
  TransactionBuilder,
  extractBaseAddress,
} from '@stellar/stellar-sdk/base';
import { summarizeOperation } from './operationSummary.js';
import type { OperationDisplayField } from './operationSummary.js';
import { inspectSorobanOperation } from './sorobanInspection.js';
import type { SorobanOperationInspection } from './sorobanInspection.js';
import { thresholdLevelForOperation } from './operationThreshold.js';
import { summarizeTransactionSources } from './transactionRequirements.js';
import type { SourceAuthorizationRequirement } from './transactionRequirements.js';
import type { StellarNetwork, ThresholdLevel } from './types.js';

interface OperationShape {
  type: string;
  source?: string | null;
  signer?: unknown;
  masterWeight?: number | null;
  lowThreshold?: number | null;
  medThreshold?: number | null;
  highThreshold?: number | null;
}

export interface InspectedOperation {
  index: number;
  type: string;
  source: string;
  sourceAccount: string;
  threshold: ThresholdLevel;
  title: string;
  summary: string;
  fields: OperationDisplayField[];
  soroban?: SorobanOperationInspection;
}

export interface InspectedMemo {
  type: string;
  value?: string;
}

export interface TransactionXdrInspection {
  network: StellarNetwork;
  envelopeType: 'transaction' | 'fee_bump';
  transactionSource: string;
  transactionSourceAccount: string;
  feeSource?: string;
  feeSourceAccount?: string;
  fee: string;
  innerFee: string;
  sequence: string;
  memo: InspectedMemo;
  timeBounds?: { minTime: string; maxTime: string };
  ledgerBounds?: { minLedger: number; maxLedger: number };
  minAccountSequence?: string;
  minAccountSequenceAge?: string;
  minAccountSequenceLedgerGap?: number;
  innerSignatureCount: number;
  outerSignatureCount: number;
  extraSigners: string[];
  operations: InspectedOperation[];
  sourceRequirements: SourceAuthorizationRequirement[];
}

function networkPassphrase(network: StellarNetwork): string {
  return network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
}

function baseAccount(address: string): string {
  return extractBaseAddress(address);
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function inspectMemo(memo: { type: string; value: unknown }): InspectedMemo {
  if (memo.type === 'none' || memo.value == null) return { type: memo.type };
  if (typeof memo.value === 'string') return { type: memo.type, value: memo.value };
  if (memo.value instanceof Uint8Array) {
    if (memo.type === 'text') {
      return { type: memo.type, value: new TextDecoder().decode(memo.value) };
    }
    return { type: memo.type, value: bytesToHex(memo.value) };
  }
  return { type: memo.type, value: String(memo.value) };
}

function setOptionsChangesAuthorization(operation: OperationShape): boolean {
  return operation.signer != null
    || operation.masterWeight != null
    || operation.lowThreshold != null
    || operation.medThreshold != null
    || operation.highThreshold != null;
}

export function inspectTransactionXdr(
  envelopeXdr: string,
  network: StellarNetwork,
): TransactionXdrInspection {
  const normalized = envelopeXdr.trim();
  if (!normalized) throw new Error('Paste a Stellar transaction envelope XDR.');

  const parsed = TransactionBuilder.fromXdr(normalized, networkPassphrase(network));
  const isFeeBump = parsed instanceof FeeBumpTransaction;
  const transaction = isFeeBump ? parsed.innerTransaction : parsed;
  const transactionSource = transaction.source;
  const transactionSourceAccount = baseAccount(transactionSource);

  const operations = transaction.operations.map((rawOperation: unknown, index: number): InspectedOperation => {
    const operation = rawOperation as OperationShape;
    const source = operation.source ?? transactionSource;
    const threshold = thresholdLevelForOperation(operation.type, {
      setOptionsChangesAuthorization: operation.type === 'setOptions'
        ? setOptionsChangesAuthorization(operation)
        : undefined,
    });
    const display = summarizeOperation(rawOperation);
    const soroban = inspectSorobanOperation(rawOperation);
    const contractCall = soroban?.contractCall;
    const fields = contractCall
      ? [
          { label: 'Contract', value: contractCall.contractAddress, mono: true },
          { label: 'Function', value: contractCall.functionName },
          ...contractCall.argumentPreviews.map((value, argumentIndex) => ({
            label: `Argument ${argumentIndex + 1}`,
            value,
            mono: true,
          })),
          { label: 'Soroban authorization entries', value: String(soroban.authorizationEntries.length) },
        ]
      : display.fields;

    return {
      index,
      type: operation.type,
      source,
      sourceAccount: baseAccount(source),
      threshold,
      title: contractCall ? 'Call Soroban contract' : display.title,
      summary: contractCall
        ? `${contractCall.functionName} on ${contractCall.contractAddress}`
        : display.summary,
      fields,
      soroban: soroban ?? undefined,
    };
  });

  const feeSource = isFeeBump ? parsed.feeSource : undefined;
  const feeSourceAccount = feeSource ? baseAccount(feeSource) : undefined;
  const sourceRequirements = summarizeTransactionSources(
    transactionSourceAccount,
    operations.map((operation) => ({
      index: operation.index,
      type: operation.type,
      sourceAccount: operation.sourceAccount,
      threshold: operation.threshold,
    })),
    feeSourceAccount,
  );

  return {
    network,
    envelopeType: isFeeBump ? 'fee_bump' : 'transaction',
    transactionSource,
    transactionSourceAccount,
    feeSource,
    feeSourceAccount,
    fee: parsed.fee,
    innerFee: transaction.fee,
    sequence: transaction.sequence,
    memo: inspectMemo(transaction.memo),
    timeBounds: transaction.timeBounds,
    ledgerBounds: transaction.ledgerBounds,
    minAccountSequence: transaction.minAccountSequence,
    minAccountSequenceAge: transaction.minAccountSequenceAge?.toString(),
    minAccountSequenceLedgerGap: transaction.minAccountSequenceLedgerGap,
    innerSignatureCount: transaction.signatures.length,
    outerSignatureCount: isFeeBump ? parsed.signatures.length : 0,
    extraSigners: transaction.extraSigners?.map(SignerKey.encodeSignerKey) ?? [],
    operations,
    sourceRequirements,
  };
}
