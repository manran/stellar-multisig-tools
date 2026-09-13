import { Account, Memo, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk/base';
import type { StellarNetworkParameters } from './horizon.js';
import { paymentDestinationIssue, stellarAssetForChoice } from './paymentAsset.js';
import { assessPaymentSpendability, paymentSourceIssue } from './paymentPreflight.js';
import { amountFromStroops, assetForSourceKey, transferTotalsBySourceAsset } from './structuredTransfers.js';
import type { ResolvedTransferRow, TransferIssue } from './structuredTransfers.js';
import type { StellarAccountSnapshot, StellarNetwork } from './types.js';

function networkPassphrase(network: StellarNetwork) {
  return network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
}

export function transferFundingIssues(
  rows: readonly ResolvedTransferRow[],
  accounts: ReadonlyMap<string, StellarAccountSnapshot>,
  transactionSource: string,
  parameters: StellarNetworkParameters,
): TransferIssue[] {
  const issues: TransferIssue[] = [];
  const totals = transferTotalsBySourceAsset(rows);
  for (const [key, requestedStroops] of totals) {
    const separator = key.indexOf('|');
    const source = key.slice(0, separator);
    const assetKey = key.slice(separator + 1);
    const account = accounts.get(source);
    const asset = assetForSourceKey(rows, source, assetKey);
    if (!account || !asset) continue;
    try {
      const spendability = assessPaymentSpendability(
        account,
        asset,
        parameters,
        rows.length,
        0,
        source === transactionSource,
      );
      const problem = paymentSourceIssue(spendability, asset, amountFromStroops(requestedStroops));
      if (problem) issues.push({ message: `${source}: ${problem}` });
    } catch (cause) {
      issues.push({ message: cause instanceof Error ? cause.message : 'Unable to verify source balance.' });
    }
  }
  return issues;
}

export function transferDestinationIssues(
  rows: readonly ResolvedTransferRow[],
  destinationAccounts: ReadonlyMap<string, StellarAccountSnapshot | null>,
): TransferIssue[] {
  const issues: TransferIssue[] = [];
  for (const row of rows) {
    const destination = destinationAccounts.get(row.destination) ?? null;
    if (!destination) {
      issues.push({ line: row.line, message: 'Recipient account is not active on this network. Multiple-recipient and multi-party payments do not create accounts automatically.' });
      continue;
    }
    const problem = paymentDestinationIssue(row.asset, row.destination, destination, row.amount);
    if (problem) issues.push({ line: row.line, message: problem });
  }
  return issues;
}

export function buildTransferTransaction({
  rows,
  transactionSource,
  transactionSourceSequence,
  parameters,
  network,
  lifetimeSeconds,
  explicitOperationSources,
  memo,
}: {
  rows: readonly ResolvedTransferRow[];
  transactionSource: string;
  transactionSourceSequence: string;
  parameters: StellarNetworkParameters;
  network: StellarNetwork;
  lifetimeSeconds: number;
  explicitOperationSources: boolean;
  memo?: string;
}) {
  if (rows.length < 1 || rows.length > 100) throw new Error('A transfer transaction must contain between 1 and 100 operations.');
  const builder = new TransactionBuilder(new Account(transactionSource, transactionSourceSequence), {
    fee: String(parameters.baseFeeInStroops),
    networkPassphrase: networkPassphrase(network),
  });
  if (memo?.trim()) builder.addMemo(Memo.text(memo.trim()));
  for (const row of rows) {
    builder.addOperation(Operation.payment({
      ...(explicitOperationSources ? { source: row.source } : {}),
      destination: row.destination,
      asset: stellarAssetForChoice(row.asset),
      amount: row.amount,
    }));
  }
  return builder.setTimeout(lifetimeSeconds).build();
}
