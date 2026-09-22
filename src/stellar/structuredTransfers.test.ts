import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk/base';
import { parseStructuredTransfers, resolveAssetToken, transferTotals, validateTransferRows } from '../../packages/stellar-core/src/structuredTransfers.js';
import type { StellarAccountSnapshot } from '../../packages/stellar-core/src/types.js';

const ALICE = Keypair.random().publicKey();
const BOB = Keypair.random().publicKey();
const CAROL = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();

function account(id: string): StellarAccountSnapshot {
  return {
    accountId: id,
    sequence: '1',
    subentryCount: 1,
    numSponsoring: 0,
    numSponsored: 0,
    nativeBalance: '100.0000000',
    nativeSellingLiabilities: '0',
    balances: [
      { assetType: 'native', assetCode: 'XLM', balance: '100.0000000', sellingLiabilities: '0', buyingLiabilities: '0' },
      { assetType: 'credit_alphanum4', assetCode: 'USDC', assetIssuer: ISSUER, balance: '500.0000000', sellingLiabilities: '0', buyingLiabilities: '0', authorized: true },
    ],
    thresholds: { low: 1, medium: 1, high: 1 },
    signers: [],
  };
}

test('batch parser accepts CSV, tabular aliases, and a header without inventing addresses', () => {
  const parsed = parseStructuredTransfers('batch', `recipient,amount,asset\nAlice,150,USDC\n${BOB}\t27.5\tXLM`, [
    { address: ALICE, label: 'Alice' },
  ]);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.rows, [
    { line: 2, destination: ALICE, amount: '150', assetToken: 'USDC' },
    { line: 3, destination: BOB, amount: '27.5', assetToken: 'XLM' },
  ]);
});

test('batch parser fails closed for unknown or ambiguous saved names', () => {
  const unknown = parseStructuredTransfers('batch', 'Nobody 1 XLM', []);
  assert.match(unknown.issues[0]?.message ?? '', /not a Stellar address or a unique saved name/);
  const ambiguous = parseStructuredTransfers('batch', 'Alice 1 XLM', [
    { address: ALICE, label: 'Alice' },
    { address: BOB, label: 'alice' },
  ]);
  assert.match(ambiguous.issues[0]?.message ?? '', /more than one saved address/);
});

test('multi-party parser requires at least two source accounts', () => {
  const parsed = parseStructuredTransfers('multi_party', `${ALICE} ${BOB} 1 XLM\n${ALICE} ${CAROL} 2 XLM`, []);
  assert.match(parsed.issues.at(-1)?.message ?? '', /at least two independent source accounts/);
});

test('asset resolver uses source holdings and rejects ambiguous asset codes', () => {
  const source = account(ALICE);
  assert.equal(resolveAssetToken('XLM', source).asset?.key, 'native');
  assert.equal(resolveAssetToken('usdc', source).asset?.issuer, ISSUER);
  const ambiguous = {
    ...source,
    balances: [
      ...(source.balances ?? []),
      { assetType: 'credit_alphanum4', assetCode: 'USDC', assetIssuer: BOB, balance: '1', sellingLiabilities: '0', buyingLiabilities: '0', authorized: true },
    ],
  };
  assert.match(resolveAssetToken('USDC', ambiguous).issue ?? '', /more than one issuer/);
});

test('resolved batch rows flag exact duplicate transfers and summarize totals deterministically', () => {
  const parsed = parseStructuredTransfers('batch', `Alice 100 USDC\nAlice 50 USDC\nBob 27.5 XLM`, [
    { address: ALICE, label: 'Alice' },
    { address: BOB, label: 'Bob' },
  ]);
  const accounts = new Map([[CAROL, account(CAROL)]]);
  const validated = validateTransferRows('batch', parsed.rows, accounts, CAROL);
  assert.match(validated.issues[0]?.message ?? '', /already appears on line 1/);
  assert.deepEqual(transferTotals(validated.rows).map((item) => [item.code, item.amount]), [
    ['USDC', '150.0000000'],
    ['XLM', '27.5000000'],
  ]);
});
