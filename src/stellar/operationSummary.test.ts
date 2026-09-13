import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeOperation } from './operationSummary.js';

const usdc = { code: 'USDC', issuer: 'GISSUER' };

test('summarizes a payment in user-facing terms', () => {
  const result = summarizeOperation({
    type: 'payment',
    amount: '125.5000000',
    asset: usdc,
    destination: 'GDESTINATION',
  });

  assert.equal(result.title, 'Payment');
  assert.equal(result.summary, '125.5000000 USDC → GDESTINATION');
  assert.equal(result.fields.find((item) => item.label === 'Asset')?.value, 'USDC · GISSUER');
});

test('summarizes a manage sell offer without reversing the direction', () => {
  const result = summarizeOperation({
    type: 'manageSellOffer',
    selling: { code: 'XLM' },
    buying: usdc,
    amount: '100',
    price: '0.25',
    offerId: '42',
  });

  assert.equal(result.summary, 'Sell 100 XLM for USDC @ 0.25');
  assert.equal(result.fields.find((item) => item.label === 'Offer ID')?.value, '42');
});

test('summarizes signer and threshold changes as account-control changes', () => {
  const result = summarizeOperation({
    type: 'setOptions',
    masterWeight: 0,
    medThreshold: 2,
    highThreshold: 3,
    signer: { weight: 1 },
  });

  assert.equal(result.title, 'Set account options');
  assert.match(result.summary, /master weight → 0/);
  assert.match(result.summary, /signer/);
});

test('falls back safely for operations without a dedicated renderer', () => {
  const result = summarizeOperation({ type: 'futureOperation' });
  assert.equal(result.title, 'Future Operation');
  assert.equal(result.fields.length, 0);
});

test('summarizes the recoverable claimable pattern in Human terms', () => {
  const result = summarizeOperation({
    type: 'createClaimableBalance',
    amount: '100.0000000',
    asset: usdc,
    claimants: [
      { destination: 'GRECIPIENT', predicate: { type: 'claimPredicateBeforeRelativeTime', relBefore: 2_592_000n } },
      { destination: 'GRECOVERY', predicate: { type: 'claimPredicateNot', notPredicate: { type: 'claimPredicateBeforeRelativeTime', relBefore: 2_592_000n } } },
    ],
  });
  assert.equal(result.title, 'Claimable payment');
  assert.match(result.summary, /claim for 30 days, then recover/);
  assert.equal(result.fields.find((item) => item.label === 'Recipient')?.value, 'GRECIPIENT');
  assert.equal(result.fields.find((item) => item.label === 'Recovery account')?.value, 'GRECOVERY');
  assert.equal(result.fields.find((item) => item.label === 'Claim window seconds')?.value, '2592000');
});

test('summarizes trustline authorization and flags with exact identities', () => {
  const allow = summarizeOperation({ type: 'allowTrust', trustor: 'GTRUSTOR', assetCode: 'USD', authorize: 2 });
  assert.equal(allow.fields.find((item) => item.label === 'Authorization')?.value, 'Maintain liabilities only');

  const flags = summarizeOperation({
    type: 'setTrustLineFlags',
    trustor: 'GTRUSTOR',
    asset: usdc,
    flags: { authorized: true, clawbackEnabled: false },
  });
  assert.match(flags.fields.find((item) => item.label === 'Flags')?.value ?? '', /Authorized/);
  assert.match(flags.fields.find((item) => item.label === 'Flags')?.value ?? '', /Clawback disabled/);
});

test('summarizes sponsorship lifecycle operations instead of falling through to raw XDR', () => {
  const cases = [
    summarizeOperation({ type: 'beginSponsoringFutureReserves', sponsoredId: 'GSPONSORED' }),
    summarizeOperation({ type: 'endSponsoringFutureReserves' }),
    summarizeOperation({ type: 'revokeAccountSponsorship', account: 'GACCOUNT' }),
    summarizeOperation({ type: 'revokeOfferSponsorship', seller: 'GSELLER', offerId: '42' }),
    summarizeOperation({ type: 'revokeDataSponsorship', account: 'GACCOUNT', name: 'role' }),
    summarizeOperation({ type: 'revokeClaimableBalanceSponsorship', balanceId: '00abc' }),
    summarizeOperation({ type: 'revokeLiquidityPoolSponsorship', liquidityPoolId: 'pool-id' }),
    summarizeOperation({ type: 'revokeSignerSponsorship', account: 'GACCOUNT', signer: { ed25519PublicKey: 'GSIGNER' } }),
  ];
  for (const result of cases) assert.notEqual(result.summary, 'Inspect authorization and raw XDR before signing.');
  assert.equal(cases[7]?.fields.find((item) => item.label === 'Signer')?.value, 'Ed25519 · GSIGNER');
});

test('summarizes claimable balance and liquidity-pool maintenance fields', () => {
  const claim = summarizeOperation({ type: 'claimClaimableBalance', balanceId: '00claim' });
  const clawback = summarizeOperation({ type: 'clawbackClaimableBalance', balanceId: '00clawback' });
  const deposit = summarizeOperation({ type: 'liquidityPoolDeposit', liquidityPoolId: 'pool', maxAmountA: '10', maxAmountB: '20', minPrice: '0.4', maxPrice: '0.6' });
  const withdraw = summarizeOperation({ type: 'liquidityPoolWithdraw', liquidityPoolId: 'pool', amount: '5', minAmountA: '2', minAmountB: '3' });
  assert.equal(claim.fields[0]?.value, '00claim');
  assert.equal(clawback.fields[0]?.value, '00clawback');
  assert.equal(deposit.fields.find((item) => item.label === 'Maximum amount B')?.value, '20');
  assert.equal(withdraw.fields.find((item) => item.label === 'Pool shares')?.value, '5');
});

test('summarizes Soroban maintenance operation facts without pretending to decode contract intent', () => {
  const extend = summarizeOperation({ type: 'extendFootprintTtl', extendTo: 12345 });
  const restore = summarizeOperation({ type: 'restoreFootprint' });
  assert.equal(extend.fields.find((item) => item.label === 'Extend to ledger')?.value, '12345');
  assert.equal(restore.title, 'Restore Soroban footprint');
});

test('path payment summaries retain the encoded path and manage data retains exact public bytes', () => {
  const path = summarizeOperation({
    type: 'pathPaymentStrictSend',
    sendAsset: { code: 'XLM' },
    sendAmount: '10',
    destination: 'GDEST',
    destAsset: usdc,
    destMin: '9',
    path: [{ code: 'AQUA', issuer: 'GAQUA' }],
  });
  assert.equal(path.fields.find((item) => item.label === 'Path')?.value, 'AQUA · GAQUA');

  const data = summarizeOperation({ type: 'manageData', name: 'mode', value: new Uint8Array([0x61, 0x62, 0x63]) });
  assert.equal(data.fields.find((item) => item.label === 'Value (hex)')?.value, '616263');
});
