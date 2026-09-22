import assert from 'node:assert/strict';
import test from 'node:test';
import { accountAssetPresentations, assetBalanceParts, compactAssetIssuer, inspectedAssetIdentity } from './assetPresentation.js';
import type { StellarAccountSnapshot } from '../../packages/stellar-core/src/types.js';

const ISSUER_A = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const ISSUER_B = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBXJ';

function account(): StellarAccountSnapshot {
  return {
    accountId: 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
    sequence: '1',
    subentryCount: 0,
    numSponsoring: 0,
    numSponsored: 0,
    nativeBalance: '25.0000000',
    nativeSellingLiabilities: '0.0000000',
    balances: [
      { assetType: 'native', assetCode: 'XLM', balance: '25.0000000', sellingLiabilities: '0', buyingLiabilities: '0' },
      { assetType: 'credit_alphanum4', assetCode: 'USD', assetIssuer: ISSUER_A, balance: '80.5000000', sellingLiabilities: '0', buyingLiabilities: '0' },
      { assetType: 'credit_alphanum4', assetCode: 'USD', assetIssuer: ISSUER_B, balance: '3.0000000', sellingLiabilities: '0', buyingLiabilities: '0' },
      { assetType: 'credit_alphanum12', assetCode: 'CUSTOMTOKEN', assetIssuer: ISSUER_A, balance: '9.2500000', sellingLiabilities: '0', buyingLiabilities: '0' },
      { assetType: 'liquidity_pool_shares', assetCode: 'Unknown', balance: '99', sellingLiabilities: '0', buyingLiabilities: '0' },
    ],
    thresholds: { low: 1, medium: 2, high: 2 },
    signers: [],
  };
}

test('asset presentation keeps every Classic credit asset from the account without an allowlist', () => {
  const assets = accountAssetPresentations(account());
  assert.deepEqual(assets.map((asset) => asset.code), ['XLM', 'USD', 'USD', 'CUSTOMTOKEN']);
  assert.equal(assets.find((asset) => asset.code === 'CUSTOMTOKEN')?.canonicalId, `CUSTOMTOKEN:${ISSUER_A}`);
});

test('same asset code from different issuers remains two distinct identities', () => {
  const usd = accountAssetPresentations(account()).filter((asset) => asset.code === 'USD');
  assert.equal(usd.length, 2);
  assert.deepEqual(usd.map((asset) => asset.issuer), [ISSUER_A, ISSUER_B]);
  assert.notEqual(usd[0]?.canonicalId, usd[1]?.canonicalId);
  assert.notEqual(usd[0]?.key, usd[1]?.key);
});

test('native XLM has an explicit canonical identity and liquidity-pool shares stay outside payment assets', () => {
  const assets = accountAssetPresentations(account());
  assert.equal(assets[0]?.canonicalId, 'XLM:native');
  assert.equal(assets[0]?.kind, 'native');
  assert.equal(assets.some((asset) => asset.code === 'Unknown'), false);
});

test('asset balance formatting groups only the integer part without rounding precision', () => {
  assert.deepEqual(assetBalanceParts('10000.5000000'), { integer: '10,000', fraction: '.5000000' });
  assert.deepEqual(assetBalanceParts('0.0000001'), { integer: '0', fraction: '.0000001' });
  assert.deepEqual(assetBalanceParts('-1234567.8900000'), { integer: '-1,234,567', fraction: '.8900000' });
});

test('asset issuer compaction keeps the canonical issuer recoverable elsewhere', () => {
  assert.equal(compactAssetIssuer(ISSUER_A), `${ISSUER_A.slice(0, 10)}…${ISSUER_A.slice(-8)}`);
  assert.equal(compactAssetIssuer('GSHORT'), 'GSHORT');
});


test('inspected payment assets keep code and issuer as one canonical identity', () => {
  assert.deepEqual(inspectedAssetIdentity('XLM'), { code: 'XLM', canonicalId: 'XLM:native' });
  assert.deepEqual(inspectedAssetIdentity(`USD · ${ISSUER_A}`), {
    code: 'USD',
    issuer: ISSUER_A,
    canonicalId: `USD:${ISSUER_A}`,
  });
});
