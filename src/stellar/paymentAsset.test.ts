import assert from 'node:assert/strict';
import test from 'node:test';
import { paymentAssetChoices, paymentDestinationIssue } from './paymentAsset.js';
import type { StellarAccountSnapshot } from './types.js';

function account(overrides: Partial<StellarAccountSnapshot> = {}): StellarAccountSnapshot {
  return {
    accountId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    sequence: '1',
    subentryCount: 0,
    numSponsoring: 0,
    numSponsored: 0,
    nativeBalance: '25.0000000',
    nativeSellingLiabilities: '0.0000000',
    thresholds: { low: 1, medium: 2, high: 2 },
    signers: [],
    ...overrides,
  };
}

test('payment asset choices retain XLM and supported credit balances from Horizon', () => {
  const choices = paymentAssetChoices(account({
    balances: [
      { assetType: 'native', assetCode: 'XLM', balance: '25.0000000', sellingLiabilities: '0', buyingLiabilities: '0' },
      { assetType: 'credit_alphanum4', assetCode: 'USDC', assetIssuer: 'GISSUER', balance: '80.5000000', sellingLiabilities: '0', buyingLiabilities: '0', authorized: true },
      { assetType: 'liquidity_pool_shares', assetCode: 'Unknown', balance: '99', sellingLiabilities: '0', buyingLiabilities: '0' },
    ],
  }));
  assert.deepEqual(choices.map((choice) => [choice.code, choice.balance]), [['XLM', '25.0000000'], ['USDC', '80.5000000']]);
});

test('credit payment refuses to silently reinterpret a missing destination account', () => {
  const choice = { key: 'credit:USDC:GISSUER', code: 'USDC', issuer: 'GISSUER', balance: '10' };
  assert.match(paymentDestinationIssue(choice, 'GDEST', null) ?? '', /Create it with XLM first/);
});

test('credit payment requires the destination trustline', () => {
  const choice = { key: 'credit:USDC:GISSUER', code: 'USDC', issuer: 'GISSUER', balance: '10' };
  assert.match(paymentDestinationIssue(choice, 'GDEST', account({ balances: [] })) ?? '', /does not have a USDC trustline/);
});

test('credit payment checks destination trustline receiving capacity', () => {
  const choice = { key: 'credit:USDC:GISSUER', code: 'USDC', issuer: 'GISSUER', balance: '10' };
  const destination = account({ balances: [{
    assetType: 'credit_alphanum4', assetCode: 'USDC', assetIssuer: 'GISSUER', balance: '7.0000000',
    sellingLiabilities: '0', buyingLiabilities: '1.5000000', limit: '10.0000000', authorized: true,
  }] });
  assert.equal(paymentDestinationIssue(choice, 'GDEST', destination, '1.5000000'), null);
  assert.match(paymentDestinationIssue(choice, 'GDEST', destination, '1.5000001') ?? '', /at most 1.5000000 USDC/);
});
