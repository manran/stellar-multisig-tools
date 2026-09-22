import assert from 'node:assert/strict';
import test from 'node:test';
import type { StellarNetworkParameters } from '../../../../packages/stellar-core/src/horizon.js';
import type { PaymentAssetChoice } from '../../../../packages/stellar-core/src/paymentAsset.js';
import { assessPaymentSpendability, paymentSourceIssue } from '../../../../packages/stellar-core/src/paymentPreflight.js';
import type { StellarAccountSnapshot } from '../../../../packages/stellar-core/src/types.js';

const MASTER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const ISSUER = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

function account(overrides: Partial<StellarAccountSnapshot> = {}): StellarAccountSnapshot {
  return {
    accountId: MASTER,
    sequence: '1',
    subentryCount: 2,
    numSponsoring: 1,
    numSponsored: 0,
    nativeBalance: '10.0000000',
    nativeSellingLiabilities: '1.0000000',
    balances: [
      { assetType: 'native', assetCode: 'XLM', balance: '10.0000000', sellingLiabilities: '1.0000000', buyingLiabilities: '0' },
      { assetType: 'credit_alphanum4', assetCode: 'USDC', assetIssuer: ISSUER, balance: '80.0000000', sellingLiabilities: '12.5000000', buyingLiabilities: '0', authorized: true },
    ],
    thresholds: { low: 1, medium: 2, high: 2 },
    signers: [],
    ...overrides,
  };
}

const parameters: StellarNetworkParameters = {
  ledgerSequence: 1,
  ledgerClosedAt: '2026-09-01T00:00:00Z',
  baseFeeInStroops: 100,
  baseReserveInStroops: 5_000_000,
};

const xlm: PaymentAssetChoice = { key: 'native', code: 'XLM', balance: '10.0000000' };
const usdc: PaymentAssetChoice = { key: `credit:USDC:${ISSUER}`, code: 'USDC', issuer: ISSUER, balance: '80.0000000' };

test('XLM spendability subtracts liabilities, sponsored reserve units, and the transaction fee', () => {
  const result = assessPaymentSpendability(account(), xlm, parameters);
  assert.equal(result.minimumBalanceStroops, 25_000_000n);
  assert.equal(result.assetAvailable, '6.4999900');
  assert.equal(result.feeCovered, true);
  assert.equal(paymentSourceIssue(result, xlm, '6.5'), 'Only 6.4999900 XLM is currently available to send after minimum reserve, selling liabilities, and the network fee.');
});

test('credit spendability subtracts selling liabilities while XLM separately funds the fee', () => {
  const result = assessPaymentSpendability(account(), usdc, parameters);
  assert.equal(result.assetAvailable, '67.5000000');
  assert.equal(result.feeCovered, true);
  assert.equal(paymentSourceIssue(result, usdc, '67.5000000'), null);
  assert.match(paymentSourceIssue(result, usdc, '67.5000001') ?? '', /Only 67.5000000 USDC/);
});

test('credit payment is blocked when the treasury cannot preserve reserve and pay the XLM fee', () => {
  const result = assessPaymentSpendability(account({ nativeBalance: '3.5000000' }), usdc, parameters);
  assert.equal(result.feeCovered, false);
  assert.match(paymentSourceIssue(result, usdc, '1') ?? '', /network fee while preserving Stellar minimum reserve/);
});

test('unauthorized source trustline has zero spendable credit balance', () => {
  const result = assessPaymentSpendability(account({
    balances: [
      { assetType: 'native', assetCode: 'XLM', balance: '10.0000000', sellingLiabilities: '0', buyingLiabilities: '0' },
      { assetType: 'credit_alphanum4', assetCode: 'USDC', assetIssuer: ISSUER, balance: '80.0000000', sellingLiabilities: '0', buyingLiabilities: '0', authorized: false },
    ],
    nativeSellingLiabilities: '0',
  }), usdc, parameters);
  assert.equal(result.assetAvailable, '0.0000000');
  assert.match(paymentSourceIssue(result, usdc, '1') ?? '', /not authorized to send/);
});

test('spendability supports multi-operation fees, added reserve, and a non-fee-paying operation source', () => {
  const withExtraReserve = assessPaymentSpendability(account({ subentryCount: 0, numSponsoring: 0, nativeSellingLiabilities: '0' }), xlm, parameters, 3, 2, true);
  assert.equal(withExtraReserve.minimumBalanceStroops, 20_000_000n);
  assert.equal(withExtraReserve.feeStroops, 300n);
  assert.equal(withExtraReserve.assetAvailable, '7.9999700');

  const operationSource = assessPaymentSpendability(account({ subentryCount: 0, numSponsoring: 0, nativeSellingLiabilities: '0' }), xlm, parameters, 3, 0, false);
  assert.equal(operationSource.feeStroops, 0n);
  assert.equal(operationSource.assetAvailable, '9.0000000');
});
