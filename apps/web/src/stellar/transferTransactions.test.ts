import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { buildTransferTransaction, transferFundingIssues } from '../../../../packages/stellar-core/src/transferTransactions.js';
import type { StellarNetworkParameters } from '../../../../packages/stellar-core/src/horizon.js';
import type { ResolvedTransferRow } from '../../../../packages/stellar-core/src/structuredTransfers.js';
import type { StellarAccountSnapshot } from '../../../../packages/stellar-core/src/types.js';

const A = Keypair.random().publicKey();
const B = Keypair.random().publicKey();
const DEST = Keypair.random().publicKey();
const parameters: StellarNetworkParameters = { ledgerSequence: 1, ledgerClosedAt: '2026-09-03T00:00:00Z', baseFeeInStroops: 100, baseReserveInStroops: 5_000_000 };

function account(id: string, balance: string): StellarAccountSnapshot {
  return {
    accountId: id, sequence: '7', subentryCount: 0, numSponsoring: 0, numSponsored: 0,
    nativeBalance: balance, nativeSellingLiabilities: '0',
    balances: [{ assetType: 'native', assetCode: 'XLM', balance, sellingLiabilities: '0', buyingLiabilities: '0' }],
    thresholds: { low: 1, medium: 1, high: 1 }, signers: [],
  };
}

function row(source: string, amount: string): ResolvedTransferRow {
  return { line: 1, source, destination: DEST, amount, asset: { key: 'native', code: 'XLM', balance: '100' } };
}

test('multi-party preflight charges the whole transaction fee only to the transaction source', () => {
  const rows = [row(A, '8.9999800'), row(B, '9.0000000')];
  const accounts = new Map([[A, account(A, '10')], [B, account(B, '10')]]);
  assert.deepEqual(transferFundingIssues(rows, accounts, A, parameters), []);
  const tooMuch = [row(A, '8.9999900'), row(B, '9.0000000')];
  assert.match(transferFundingIssues(tooMuch, accounts, A, parameters)[0]?.message ?? '', /Only 8.9999800 XLM/);
});

test('multi-party transaction keeps each payment operation source explicit', () => {
  const rows = [row(A, '1'), row(B, '2')];
  const tx = buildTransferTransaction({ rows, transactionSource: A, transactionSourceSequence: '7', parameters, network: 'testnet', lifetimeSeconds: 3600, explicitOperationSources: true, memo: 'atomic-42' });
  const parsed = TransactionBuilder.fromXdr(tx.toXDR(), Networks.TESTNET);
  assert.equal(parsed.operations.length, 2);
  assert.equal(parsed.operations[0].source, A);
  assert.equal(parsed.operations[1].source, B);
  assert.equal(parsed.fee, '200');
  if (!('memo' in parsed)) assert.fail('Expected a classic transaction.');
  assert.equal(parsed.memo.type, 'text');
  assert.equal(new TextDecoder().decode(parsed.memo.value as Uint8Array), 'atomic-42');
});
