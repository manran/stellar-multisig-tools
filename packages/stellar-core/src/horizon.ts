import { StrKey } from '@stellar/stellar-sdk/base';
import type { StellarAccountSnapshot, StellarNetwork } from './types.js';

const HORIZON_URLS: Record<StellarNetwork, string> = {
  public: 'https://horizon.stellar.org',
  testnet: 'https://horizon-testnet.stellar.org',
};

interface HorizonAccountResponse {
  account_id: string;
  sequence: string;
  sequence_ledger?: number;
  sequence_time?: string;
  home_domain?: string;
  subentry_count: number;
  num_sponsoring: number;
  num_sponsored: number;
  balances: Array<{
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
    balance: string;
    selling_liabilities?: string;
    buying_liabilities?: string;
    limit?: string;
    is_authorized?: boolean;
  }>;
  thresholds: {
    low_threshold: number;
    med_threshold: number;
    high_threshold: number;
  };
  signers: Array<{
    key: string;
    type: string;
    weight: number;
    sponsor?: string;
  }>;
}

interface HorizonLedgerPageResponse {
  _embedded: {
    records: Array<{
      sequence: number;
      closed_at: string;
      base_fee_in_stroops: number;
      base_reserve_in_stroops: number;
    }>;
  };
}

interface HorizonTransactionResponse {
  hash: string;
  ledger: number;
  successful: boolean;
  created_at?: string;
}

interface HorizonTransactionFailureResponse {
  title?: string;
  detail?: string;
  extras?: {
    envelope_xdr?: string;
    result_xdr?: string;
    result_codes?: {
      transaction?: string;
      operations?: string[];
    };
  };
}

export interface StellarNetworkParameters {
  ledgerSequence: number;
  ledgerClosedAt: string;
  baseFeeInStroops: number;
  baseReserveInStroops: number;
}

export interface TransactionSubmissionResult {
  hash: string;
  ledger: number;
  successful: boolean;
  createdAt?: string;
}

export class AccountNotFoundError extends Error {
  constructor(accountId: string) {
    super(`Account ${accountId} was not found on this network.`);
    this.name = 'AccountNotFoundError';
  }
}

export class TransactionSubmissionError extends Error {
  readonly httpStatus?: number;
  readonly transactionCode?: string;
  readonly operationCodes: string[];
  readonly resultXdr?: string;
  readonly outcomeUnknown: boolean;

  constructor(
    message: string,
    options: {
      httpStatus?: number;
      transactionCode?: string;
      operationCodes?: string[];
      resultXdr?: string;
      outcomeUnknown?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'TransactionSubmissionError';
    this.httpStatus = options.httpStatus;
    this.transactionCode = options.transactionCode;
    this.operationCodes = options.operationCodes ?? [];
    this.resultXdr = options.resultXdr;
    this.outcomeUnknown = options.outcomeUnknown ?? false;
  }
}

const TRANSACTION_CODE_MESSAGES: Record<string, string> = {
  tx_bad_seq: 'The source account sequence changed after this transaction was created. Rebuild the transaction and collect approvals again.',
  tx_bad_auth: 'Stellar rejected the transaction signatures or authorization.',
  tx_bad_auth_extra: 'The transaction contains an extra signature that Stellar does not accept for the current authorization state.',
  tx_insufficient_balance: 'The source account does not have enough spendable XLM for the transaction and its fee.',
  tx_insufficient_fee: 'The transaction fee is below the network requirement.',
  tx_no_source_account: 'The transaction source account does not exist on this network.',
  tx_too_early: 'The transaction is not valid yet.',
  tx_too_late: 'The transaction has expired.',
};

const OPERATION_CODE_MESSAGES: Record<string, string> = {
  op_no_destination: 'The destination account does not exist on this network. An XLM Payment cannot create a new Stellar account.',
  op_underfunded: 'The source account does not have enough spendable balance for this operation.',
  op_low_reserve: 'This operation would leave an account below Stellar minimum reserve.',
  op_no_trust: 'The destination account does not have the required trustline for this asset.',
  op_not_authorized: 'The destination account is not authorized to hold this asset.',
  op_line_full: 'The destination trustline cannot receive this amount because its limit would be exceeded.',
  op_no_issuer: 'The asset issuer does not exist on this network.',
  op_bad_auth: 'The operation source does not have the required authorization.',
  op_no_account: 'An account required by this operation does not exist on this network.',
};

function resultCodeMessage(transactionCode: string | undefined, operationCodes: string[]): string | null {
  const operationFailure = operationCodes.find((code) => code !== 'op_success');
  if (operationFailure && OPERATION_CODE_MESSAGES[operationFailure]) return OPERATION_CODE_MESSAGES[operationFailure];
  if (transactionCode && TRANSACTION_CODE_MESSAGES[transactionCode]) return TRANSACTION_CODE_MESSAGES[transactionCode];
  return null;
}

function resultCodeSuffix(transactionCode: string | undefined, operationCodes: string[]): string {
  const codes = [transactionCode, ...operationCodes.filter((code) => code !== 'op_success')].filter(Boolean);
  return codes.length > 0 ? ` Stellar result: ${codes.join(' · ')}.` : '';
}

export function horizonUrl(network: StellarNetwork): string {
  return HORIZON_URLS[network];
}

export function horizonTransactionUrl(hash: string, network: StellarNetwork): string {
  return `${horizonUrl(network)}/transactions/${encodeURIComponent(hash)}`;
}

export function isValidStellarAccountId(accountId: string): boolean {
  return StrKey.isValidEd25519PublicKey(accountId.trim());
}

export async function loadAccount(
  accountId: string,
  network: StellarNetwork,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<StellarAccountSnapshot> {
  const normalizedAccountId = accountId.trim();
  if (!isValidStellarAccountId(normalizedAccountId)) {
    throw new Error('Enter a valid Stellar G... account address.');
  }

  const response = await fetchImpl(
    `${horizonUrl(network)}/accounts/${encodeURIComponent(normalizedAccountId)}`,
    { signal },
  );

  if (response.status === 404) {
    throw new AccountNotFoundError(normalizedAccountId);
  }

  if (!response.ok) {
    let detail = `Horizon returned HTTP ${response.status}.`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // Keep the HTTP status when Horizon does not return JSON.
    }
    throw new Error(detail);
  }

  const account = (await response.json()) as HorizonAccountResponse;
  const nativeBalance = account.balances.find((balance) => balance.asset_type === 'native');
  if (!nativeBalance) {
    throw new Error('Horizon account response did not include the native XLM balance.');
  }

  return {
    accountId: account.account_id,
    sequence: account.sequence,
    sequenceLedger: account.sequence_ledger,
    sequenceTime: account.sequence_time,
    homeDomain: account.home_domain || undefined,
    subentryCount: account.subentry_count,
    numSponsoring: account.num_sponsoring,
    numSponsored: account.num_sponsored,
    nativeBalance: nativeBalance.balance,
    nativeSellingLiabilities: nativeBalance.selling_liabilities ?? '0.0000000',
    balances: account.balances.map((balance) => ({
      assetType: balance.asset_type,
      assetCode: balance.asset_type === 'native' ? 'XLM' : balance.asset_code ?? 'Unknown',
      assetIssuer: balance.asset_issuer,
      balance: balance.balance,
      sellingLiabilities: balance.selling_liabilities ?? '0.0000000',
      buyingLiabilities: balance.buying_liabilities ?? '0.0000000',
      limit: balance.limit,
      authorized: balance.is_authorized,
    })),
    thresholds: {
      low: account.thresholds.low_threshold,
      medium: account.thresholds.med_threshold,
      high: account.thresholds.high_threshold,
    },
    signers: account.signers.map((signer) => ({
      key: signer.key,
      type: signer.type,
      weight: signer.weight,
      sponsor: signer.sponsor,
    })),
  };
}

export async function loadNetworkParameters(
  network: StellarNetwork,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<StellarNetworkParameters> {
  const response = await fetchImpl(`${horizonUrl(network)}/ledgers?order=desc&limit=1`, { signal });
  if (!response.ok) {
    throw new Error(`Horizon returned HTTP ${response.status} while loading network reserve parameters.`);
  }

  const page = (await response.json()) as HorizonLedgerPageResponse;
  const latest = page._embedded.records[0];
  if (!latest) throw new Error('Horizon returned no ledger records.');
  if (!Number.isSafeInteger(latest.sequence) || latest.sequence <= 0) {
    throw new Error('Horizon returned an invalid ledger sequence.');
  }
  if (!latest.closed_at || !Number.isFinite(Date.parse(latest.closed_at))) {
    throw new Error('Horizon returned an invalid ledger close time.');
  }
  if (!Number.isSafeInteger(latest.base_reserve_in_stroops) || latest.base_reserve_in_stroops <= 0) {
    throw new Error('Horizon returned an invalid base reserve.');
  }
  if (!Number.isSafeInteger(latest.base_fee_in_stroops) || latest.base_fee_in_stroops < 0) {
    throw new Error('Horizon returned an invalid base fee.');
  }

  return {
    ledgerSequence: latest.sequence,
    ledgerClosedAt: latest.closed_at,
    baseFeeInStroops: latest.base_fee_in_stroops,
    baseReserveInStroops: latest.base_reserve_in_stroops,
  };
}

export async function loadTransactionByHash(
  hash: string,
  network: StellarNetwork,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<TransactionSubmissionResult | null> {
  const response = await fetchImpl(horizonTransactionUrl(hash, network), { signal });
  if (response.status === 404) return null;
  if (!response.ok) {
    let detail = `Horizon returned HTTP ${response.status} while checking the transaction.`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // Keep the HTTP status when Horizon does not return JSON.
    }
    throw new Error(detail);
  }

  const transaction = (await response.json()) as HorizonTransactionResponse;
  return {
    hash: transaction.hash,
    ledger: transaction.ledger,
    successful: transaction.successful,
    createdAt: transaction.created_at,
  };
}

export async function submitTransactionXdr(
  envelopeXdr: string,
  network: StellarNetwork,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<TransactionSubmissionResult> {
  const normalized = envelopeXdr.trim();
  if (!normalized) throw new Error('A signed transaction envelope XDR is required.');

  let response: Response;
  try {
    response = await fetchImpl(`${horizonUrl(network)}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ tx: normalized }).toString(),
      signal,
    });
  } catch (cause) {
    throw new TransactionSubmissionError(
      cause instanceof Error ? `Unable to reach Horizon: ${cause.message}` : 'Unable to reach Horizon.',
      { outcomeUnknown: true },
    );
  }

  if (response.ok) {
    const transaction = (await response.json()) as HorizonTransactionResponse;
    return {
      hash: transaction.hash,
      ledger: transaction.ledger,
      successful: transaction.successful,
      createdAt: transaction.created_at,
    };
  }

  let body: HorizonTransactionFailureResponse | null = null;
  try {
    body = (await response.json()) as HorizonTransactionFailureResponse;
  } catch {
    // Fall back to the HTTP status below.
  }

  const transactionCode = body?.extras?.result_codes?.transaction;
  const operationCodes = body?.extras?.result_codes?.operations ?? [];
  const outcomeUnknown = response.status === 504;
  const detail = body?.detail || body?.title;
  const humanResult = resultCodeMessage(transactionCode, operationCodes);
  const codeSuffix = resultCodeSuffix(transactionCode, operationCodes);
  const message = outcomeUnknown
    ? 'Horizon timed out while waiting for ingestion. The transaction outcome is unknown; check its hash before retrying.'
    : humanResult
      ? `${humanResult}${codeSuffix}`
      : detail
        ? `${detail}${codeSuffix}`
        : `Horizon rejected the transaction with HTTP ${response.status}.${codeSuffix}`;

  throw new TransactionSubmissionError(message, {
    httpStatus: response.status,
    transactionCode,
    operationCodes,
    resultXdr: body?.extras?.result_xdr,
    outcomeUnknown,
  });
}
