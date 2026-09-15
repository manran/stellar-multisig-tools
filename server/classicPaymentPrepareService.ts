import type { StellarNetworkParameters } from '../src/stellar/horizon.js';
import {
  AccountNotFoundError,
  isValidStellarAccountId,
  loadAccount,
  loadNetworkParameters,
} from '../src/stellar/horizon.js';
import { isValidStellarTextMemo } from '../src/stellar/memo.js';
import { paymentAssetChoices, paymentDestinationIssue } from '../src/stellar/paymentAsset.js';
import { stellarAmountToStroops } from '../src/stellar/reserve.js';
import { transactionHashHex } from '../src/stellar/signatureMerge.js';
import { DEFAULT_TRANSACTION_LIFETIME_SECONDS, isTransactionLifetimeSeconds } from '../src/stellar/transactionPreferences.js';
import { inspectTransactionXdr } from '../src/stellar/transactionXdr.js';
import { buildTransferTransaction, transferFundingIssues } from '../src/stellar/transferTransactions.js';
import type { ResolvedTransferRow } from '../src/stellar/structuredTransfers.js';
import type { StellarAccountSnapshot, StellarNetwork } from '../src/stellar/types.js';

const MAX_PAYMENTS = 100;
const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/;

export type ClassicPaymentAssetInput =
  | { type: 'native' }
  | { type: 'credit'; code: string; issuer: string };

export interface ClassicPaymentInstruction {
  network: unknown;
  sourceAccount: unknown;
  payments: unknown;
  memo?: unknown;
  lifetimeSeconds?: unknown;
}

export interface ClassicPaymentPreparation {
  operation: 'classic.payment.prepare';
  version: 1;
  network: StellarNetwork;
  sourceAccount: string;
  sourceSequence: string;
  paymentCount: number;
  feeStroops: string;
  validUntil: string;
  transactionHash: string;
  xdr: string;
}

export interface ClassicPaymentPrepareDependencies {
  accountLoader?: (accountId: string, network: StellarNetwork) => Promise<StellarAccountSnapshot>;
  networkParametersLoader?: (network: StellarNetwork) => Promise<StellarNetworkParameters>;
}

export class ClassicPaymentPrepareError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'ClassicPaymentPrepareError';
  }
}

function networkFor(value: unknown): StellarNetwork {
  if (value === 'public' || value === 'testnet') return value;
  throw new ClassicPaymentPrepareError('Network must be public or testnet.', 400, 'invalid_network');
}

function accountFor(value: unknown, field: string): string {
  const account = typeof value === 'string' ? value.trim() : '';
  if (!isValidStellarAccountId(account)) {
    throw new ClassicPaymentPrepareError(`${field} must be a valid Stellar G... account.`, 400, 'invalid_account');
  }
  return account;
}

function amountFor(value: unknown, index: number): string {
  const amount = typeof value === 'string' ? value.trim() : '';
  if (!AMOUNT_PATTERN.test(amount)) {
    throw new ClassicPaymentPrepareError(`Payment ${index}: amount must be greater than 0 with at most 7 decimal places.`, 400, 'invalid_payment_amount');
  }
  try {
    if (stellarAmountToStroops(amount) <= 0n) throw new Error('non-positive');
  } catch {
    throw new ClassicPaymentPrepareError(`Payment ${index}: amount must be greater than 0 with at most 7 decimal places.`, 400, 'invalid_payment_amount');
  }
  return amount;
}

function assetFor(value: unknown, index: number): ClassicPaymentAssetInput {
  if (!value || typeof value !== 'object') {
    throw new ClassicPaymentPrepareError(`Payment ${index}: asset is required.`, 400, 'invalid_payment_asset');
  }
  const record = value as Record<string, unknown>;
  if (record.type === 'native') return { type: 'native' };
  if (record.type !== 'credit') {
    throw new ClassicPaymentPrepareError(`Payment ${index}: asset type must be native or credit.`, 400, 'invalid_payment_asset');
  }
  const code = typeof record.code === 'string' ? record.code.trim() : '';
  const issuer = accountFor(record.issuer, `Payment ${index} asset issuer`);
  if (!/^[A-Za-z0-9]{1,12}$/.test(code)) {
    throw new ClassicPaymentPrepareError(`Payment ${index}: credit asset code is invalid.`, 400, 'invalid_payment_asset');
  }
  return { type: 'credit', code, issuer };
}

function paymentRows(value: unknown): Array<{ destination: string; amount: string; asset: ClassicPaymentAssetInput }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PAYMENTS) {
    throw new ClassicPaymentPrepareError(`payments must contain between 1 and ${MAX_PAYMENTS} entries.`, 400, 'invalid_payments');
  }
  return value.map((item, offset) => {
    const index = offset + 1;
    if (!item || typeof item !== 'object') {
      throw new ClassicPaymentPrepareError(`Payment ${index} is invalid.`, 400, 'invalid_payments');
    }
    const record = item as Record<string, unknown>;
    return {
      destination: accountFor(record.destination, `Payment ${index} destination`),
      amount: amountFor(record.amount, index),
      asset: assetFor(record.asset, index),
    };
  });
}

function memoFor(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ClassicPaymentPrepareError('Memo must be text.', 400, 'invalid_memo');
  const memo = value.trim();
  if (!isValidStellarTextMemo(memo)) {
    throw new ClassicPaymentPrepareError('Stellar text memos can contain at most 28 UTF-8 bytes.', 400, 'invalid_memo');
  }
  return memo || undefined;
}

function lifetimeFor(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_TRANSACTION_LIFETIME_SECONDS;
  if (typeof value !== 'number' || !isTransactionLifetimeSeconds(value)) {
    throw new ClassicPaymentPrepareError('Unsupported transaction lifetime.', 400, 'invalid_transaction_lifetime');
  }
  return value;
}

export interface NormalizedClassicPaymentInstruction {
  network: StellarNetwork;
  sourceAccount: string;
  payments: Array<{ destination: string; amount: string; asset: ClassicPaymentAssetInput }>;
  memo?: string;
  lifetimeSeconds: number;
}

export function normalizeClassicPaymentInstruction(
  input: ClassicPaymentInstruction,
): NormalizedClassicPaymentInstruction {
  const memo = memoFor(input.memo);
  return {
    network: networkFor(input.network),
    sourceAccount: accountFor(input.sourceAccount, 'Source account'),
    payments: paymentRows(input.payments),
    ...(memo ? { memo } : {}),
    lifetimeSeconds: lifetimeFor(input.lifetimeSeconds),
  };
}

function dependencyError(message: string): ClassicPaymentPrepareError {
  return new ClassicPaymentPrepareError(message, 503, 'classic_payment_prepare_unavailable');
}

export async function prepareClassicPayment(
  input: ClassicPaymentInstruction,
  dependencies: ClassicPaymentPrepareDependencies = {},
): Promise<ClassicPaymentPreparation> {
  const normalized = normalizeClassicPaymentInstruction(input);
  const { network, sourceAccount, payments, memo, lifetimeSeconds } = normalized;
  const accountLoader = dependencies.accountLoader ?? loadAccount;
  const networkParametersLoader = dependencies.networkParametersLoader ?? loadNetworkParameters;

  let source: StellarAccountSnapshot;
  let parameters: StellarNetworkParameters;
  try {
    [source, parameters] = await Promise.all([
      accountLoader(sourceAccount, network),
      networkParametersLoader(network),
    ]);
  } catch (cause) {
    if (cause instanceof AccountNotFoundError) {
      throw new ClassicPaymentPrepareError('The source account does not exist on this network.', 409, 'classic_payment_source_not_found');
    }
    throw dependencyError(cause instanceof Error ? `Unable to load current Stellar state: ${cause.message}` : 'Unable to load current Stellar state.');
  }

  const choices = paymentAssetChoices(source);
  const rows: ResolvedTransferRow[] = [];
  const seen = new Map<string, number>();
  for (let offset = 0; offset < payments.length; offset += 1) {
    const index = offset + 1;
    const payment = payments[offset];
    let asset;
    if (payment.asset.type === 'native') {
      asset = choices.find((choice) => !choice.issuer);
    } else {
      const credit = payment.asset;
      asset = choices.find((choice) => choice.code === credit.code && choice.issuer === credit.issuer);
    }
    if (!asset) {
      throw new ClassicPaymentPrepareError(`Payment ${index}: the source account does not currently hold the requested asset.`, 409, 'classic_payment_asset_unavailable');
    }
    const duplicateKey = `${payment.destination}|${asset.key}`;
    const earlier = seen.get(duplicateKey);
    if (earlier !== undefined) {
      throw new ClassicPaymentPrepareError(`Payment ${index}: this recipient and asset already appear in payment ${earlier}.`, 400, 'duplicate_payment');
    }
    seen.set(duplicateKey, index);
    rows.push({ line: index, source: sourceAccount, destination: payment.destination, amount: payment.amount, asset });
  }

  const fundingIssues = transferFundingIssues(rows, new Map([[sourceAccount, source]]), sourceAccount, parameters);
  if (fundingIssues.length > 0) {
    throw new ClassicPaymentPrepareError(fundingIssues.map((item) => item.message).join('\n'), 409, 'classic_payment_source_unavailable');
  }

  const destinations = new Map<string, StellarAccountSnapshot>();
  for (const destination of [...new Set(rows.map((row) => row.destination))]) {
    try {
      destinations.set(destination, await accountLoader(destination, network));
    } catch (cause) {
      if (cause instanceof AccountNotFoundError) {
        throw new ClassicPaymentPrepareError(
          `Destination ${destination} is not active on this network. classic.payment.prepare never silently changes a Payment into CreateAccount.`,
          409,
          'classic_payment_destination_not_active',
        );
      }
      throw dependencyError(cause instanceof Error ? `Unable to verify destination ${destination}: ${cause.message}` : `Unable to verify destination ${destination}.`);
    }
  }

  for (const row of rows) {
    const issue = paymentDestinationIssue(row.asset, row.destination, destinations.get(row.destination) ?? null, row.amount);
    if (issue) throw new ClassicPaymentPrepareError(`Payment ${row.line}: ${issue}`, 409, 'classic_payment_destination_unavailable');
  }

  const transaction = buildTransferTransaction({
    rows,
    transactionSource: sourceAccount,
    transactionSourceSequence: source.sequence,
    parameters,
    network,
    lifetimeSeconds,
    explicitOperationSources: false,
    memo,
  });
  const xdr = transaction.toXDR();
  const inspection = inspectTransactionXdr(xdr, network);
  const maxTime = inspection.timeBounds?.maxTime;
  if (!maxTime || maxTime === '0' || !Number.isFinite(Number(maxTime))) {
    throw new ClassicPaymentPrepareError('Prepared transaction has no finite validity window.', 500, 'classic_payment_prepare_invalid');
  }

  return {
    operation: 'classic.payment.prepare',
    version: 1,
    network,
    sourceAccount,
    sourceSequence: source.sequence,
    paymentCount: rows.length,
    feeStroops: String(parameters.baseFeeInStroops * rows.length),
    validUntil: new Date(Number(maxTime) * 1000).toISOString(),
    transactionHash: transactionHashHex(xdr, network),
    xdr,
  };
}
