import { Account, Memo, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk/base';
import {
  AccountNotFoundError,
  isValidStellarAccountId,
  loadAccount,
  loadNetworkParameters,
} from './horizon.js';
import type { StellarNetworkParameters } from './horizon.js';
import { isValidStellarTextMemo } from './memo.js';
import { paymentAssetChoices } from './paymentAsset.js';
import { hexToBytes } from './privateCommitment.js';
import { stellarAmountToStroops, stroopsToStellarAmount } from './reserve.js';
import { transactionHashHex } from './signatureMerge.js';
import { DEFAULT_TRANSACTION_LIFETIME_SECONDS, isTransactionLifetimeSeconds } from './transactionPreferences.js';
import { inspectTransactionXdr } from './transactionXdr.js';
import { transferFundingIssues } from './transferTransactions.js';
import type { ResolvedTransferRow } from './structuredTransfers.js';
import type { StellarAccountSnapshot, StellarNetwork } from './types.js';

const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/;

export interface ClassicCreateAccountInstruction {
  network: unknown;
  sourceAccount: unknown;
  destination: unknown;
  startingBalance: unknown;
  memo?: unknown;
  memoHashHex?: unknown;
  lifetimeSeconds?: unknown;
}

export interface ClassicCreateAccountPreparation {
  operation: 'classic.account.create.prepare';
  version: 1;
  network: StellarNetwork;
  sourceAccount: string;
  sourceSequence: string;
  destination: string;
  startingBalance: string;
  feeStroops: string;
  validUntil: string;
  transactionHash: string;
  xdr: string;
}

export interface ClassicCreateAccountPrepareDependencies {
  accountLoader?: (accountId: string, network: StellarNetwork) => Promise<StellarAccountSnapshot>;
  networkParametersLoader?: (network: StellarNetwork) => Promise<StellarNetworkParameters>;
}

export class ClassicCreateAccountPrepareError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'ClassicCreateAccountPrepareError';
  }
}

function networkFor(value: unknown): StellarNetwork {
  if (value === 'public' || value === 'testnet') return value;
  throw new ClassicCreateAccountPrepareError('Network must be public or testnet.', 400, 'invalid_network');
}

function accountFor(value: unknown, field: string): string {
  const account = typeof value === 'string' ? value.trim() : '';
  if (!isValidStellarAccountId(account)) {
    throw new ClassicCreateAccountPrepareError(`${field} must be a valid Stellar G... account.`, 400, 'invalid_account');
  }
  return account;
}

function amountFor(value: unknown): string {
  const amount = typeof value === 'string' ? value.trim() : '';
  if (!AMOUNT_PATTERN.test(amount)) {
    throw new ClassicCreateAccountPrepareError('Starting balance must be greater than 0 with at most 7 decimal places.', 400, 'invalid_starting_balance');
  }
  try {
    if (stellarAmountToStroops(amount) <= 0n) throw new Error('non-positive');
  } catch {
    throw new ClassicCreateAccountPrepareError('Starting balance must be greater than 0 with at most 7 decimal places.', 400, 'invalid_starting_balance');
  }
  return amount;
}

function memoFor(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ClassicCreateAccountPrepareError('Memo must be text.', 400, 'invalid_memo');
  const memo = value.trim();
  if (!isValidStellarTextMemo(memo)) {
    throw new ClassicCreateAccountPrepareError('Stellar text memos can contain at most 28 UTF-8 bytes.', 400, 'invalid_memo');
  }
  return memo || undefined;
}

function memoHashFor(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const hash = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new ClassicCreateAccountPrepareError('Hash memo must be exactly 32 bytes encoded as 64 hexadecimal characters.', 400, 'invalid_memo_hash');
  }
  return hash;
}

function lifetimeFor(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_TRANSACTION_LIFETIME_SECONDS;
  if (typeof value !== 'number' || !isTransactionLifetimeSeconds(value)) {
    throw new ClassicCreateAccountPrepareError('Unsupported transaction lifetime.', 400, 'invalid_transaction_lifetime');
  }
  return value;
}

function dependencyError(message: string): ClassicCreateAccountPrepareError {
  return new ClassicCreateAccountPrepareError(message, 503, 'classic_account_create_prepare_unavailable');
}

export async function prepareClassicCreateAccount(
  input: ClassicCreateAccountInstruction,
  dependencies: ClassicCreateAccountPrepareDependencies = {},
): Promise<ClassicCreateAccountPreparation> {
  const network = networkFor(input.network);
  const sourceAccount = accountFor(input.sourceAccount, 'Source account');
  const destination = accountFor(input.destination, 'Destination');
  const startingBalance = amountFor(input.startingBalance);
  const memo = memoFor(input.memo);
  const memoHashHex = memoHashFor(input.memoHashHex);
  if (memo && memoHashHex) throw new ClassicCreateAccountPrepareError('Choose either a text memo or a hash memo, not both.', 400, 'invalid_memo');
  const lifetimeSeconds = lifetimeFor(input.lifetimeSeconds);
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
      throw new ClassicCreateAccountPrepareError('The source account does not exist on this network.', 409, 'classic_account_create_source_not_found');
    }
    throw dependencyError(cause instanceof Error ? `Unable to load current Stellar state: ${cause.message}` : 'Unable to load current Stellar state.');
  }

  try {
    await accountLoader(destination, network);
    throw new ClassicCreateAccountPrepareError(
      `Destination ${destination} is already active on this network. Use Payment instead of CreateAccount.`,
      409,
      'classic_account_create_destination_already_active',
    );
  } catch (cause) {
    if (!(cause instanceof AccountNotFoundError)) throw cause;
  }

  const minimumStartingBalance = BigInt(parameters.baseReserveInStroops) * 2n;
  if (stellarAmountToStroops(startingBalance) < minimumStartingBalance) {
    throw new ClassicCreateAccountPrepareError(
      `Creating this account requires at least ${stroopsToStellarAmount(minimumStartingBalance)} XLM.`,
      409,
      'classic_account_create_starting_balance_too_low',
    );
  }

  const native = paymentAssetChoices(source).find((choice) => !choice.issuer);
  if (!native) throw new ClassicCreateAccountPrepareError('The source account cannot fund XLM account creation.', 409, 'classic_account_create_source_unavailable');
  const fundingRow: ResolvedTransferRow = {
    line: 1,
    source: sourceAccount,
    destination,
    amount: startingBalance,
    asset: native,
  };
  const fundingIssues = transferFundingIssues([fundingRow], new Map([[sourceAccount, source]]), sourceAccount, parameters);
  if (fundingIssues.length > 0) {
    throw new ClassicCreateAccountPrepareError(fundingIssues.map((item) => item.message).join('\n'), 409, 'classic_account_create_source_unavailable');
  }

  const builder = new TransactionBuilder(new Account(sourceAccount, source.sequence), {
    fee: String(parameters.baseFeeInStroops),
    networkPassphrase: network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC,
  }).addOperation(Operation.createAccount({ destination, startingBalance }));
  if (memo) builder.addMemo(Memo.text(memo));
  if (memoHashHex) builder.addMemo(Memo.hash(hexToBytes(memoHashHex)));
  const transaction = builder.setTimeout(lifetimeSeconds).build();
  const xdr = transaction.toXDR();
  const inspection = inspectTransactionXdr(xdr, network);
  const maxTime = inspection.timeBounds?.maxTime;
  if (!maxTime || maxTime === '0' || !Number.isFinite(Number(maxTime))) {
    throw new ClassicCreateAccountPrepareError('Prepared transaction has no finite validity window.', 500, 'classic_account_create_prepare_invalid');
  }

  return {
    operation: 'classic.account.create.prepare',
    version: 1,
    network,
    sourceAccount,
    sourceSequence: source.sequence,
    destination,
    startingBalance,
    feeStroops: String(parameters.baseFeeInStroops),
    validUntil: new Date(Number(maxTime) * 1000).toISOString(),
    transactionHash: transactionHashHex(xdr, network),
    xdr,
  };
}
