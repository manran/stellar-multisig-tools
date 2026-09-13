import assert from 'node:assert/strict';
import test from 'node:test';
import { batchAssetToken, batchPromotionDraft } from './paymentBatchPromotion.js';

test('single-recipient payment promotes into the first deterministic batch row', () => {
  assert.deepEqual(batchPromotionDraft({
    source: ' GSOURCE ',
    destination: ' GDEST ',
    amount: '12.5',
    asset: { code: 'USDC', issuer: 'GISSUER' },
    memo: 'invoice-42',
    privateNote: 'Finance approved.',
    lifetimeSeconds: 3600,
  }), {
    source: 'GSOURCE',
    input: 'GDEST, 12.5, USDC:GISSUER',
    memo: 'invoice-42',
    privateNote: 'Finance approved.',
    lifetimeSeconds: 3600,
  });
});

test('batch promotion uses XLM token for native and avoids an empty phantom row', () => {
  assert.equal(batchAssetToken({ code: 'XLM' }), 'XLM');
  assert.equal(batchPromotionDraft({
    source: '',
    destination: '',
    amount: '',
    asset: { code: 'XLM' },
    memo: '',
    privateNote: '',
    lifetimeSeconds: 900,
  }).input, '');
});
