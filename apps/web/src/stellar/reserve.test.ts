import assert from 'node:assert/strict';
import test from 'node:test';
import { assessMultisigReserve, stellarAmountToStroops, stroopsToStellarAmount, stroopsToXlm, xlmToStroops } from '../../../../packages/stellar-core/src/reserve.js';
import type { StellarAccountSnapshot } from '../../../../packages/stellar-core/src/types.js';

const MASTER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

function account(overrides: Partial<StellarAccountSnapshot> = {}): StellarAccountSnapshot {
  return {
    accountId: MASTER,
    sequence: '1',
    subentryCount: 0,
    numSponsoring: 0,
    numSponsored: 0,
    nativeBalance: '3.0000000',
    nativeSellingLiabilities: '0.0000000',
    thresholds: { low: 0, medium: 0, high: 0 },
    signers: [{ key: MASTER, type: 'ed25519_public_key', weight: 1 }],
    ...overrides,
  };
}

test('converts Stellar 7-decimal amounts without floating point', () => {
  assert.equal(stellarAmountToStroops('12.3456789'), 123456789n);
  assert.equal(xlmToStroops('12.3456789'), 123456789n);
  assert.equal(xlmToStroops('1'), 10000000n);
  assert.equal(stroopsToStellarAmount(123456789n), '12.3456789');
  assert.equal(stroopsToXlm(123456789n), '12.3456789');
  assert.equal(stroopsToXlm(-1n), '-0.0000001');
});

test('includes new signer reserves and the setup transaction fee', () => {
  const result = assessMultisigReserve(account(), 2, 5_000_000, 100);
  assert.equal(result.currentMinimumStroops, 10_000_000n);
  assert.equal(result.addedReserveStroops, 10_000_000n);
  assert.equal(result.setupFeeStroops, 300n);
  assert.equal(result.requiredBeforeSubmitStroops, 20_000_300n);
  assert.equal(result.sufficient, true);
  assert.equal(result.headroomAfterSetupStroops, 9_999_700n);
});

test('selling liabilities can make an otherwise funded setup fail reserve preflight', () => {
  const result = assessMultisigReserve(account({ nativeSellingLiabilities: '1.2000000' }), 2, 5_000_000, 100);
  assert.equal(result.currentMinimumStroops, 22_000_000n);
  assert.equal(result.requiredBeforeSubmitStroops, 32_000_300n);
  assert.equal(result.sufficient, false);
  assert.equal(result.shortfallStroops, 2_000_300n);
});

test('uses sponsorship counters in the Stellar minimum balance formula', () => {
  const result = assessMultisigReserve(account({
    nativeBalance: '10.0000000',
    subentryCount: 4,
    numSponsoring: 2,
    numSponsored: 3,
  }), 1, 5_000_000, 100);
  assert.equal(result.currentMinimumStroops, 25_000_000n);
  assert.equal(result.addedReserveStroops, 5_000_000n);
  assert.equal(result.setupFeeStroops, 200n);
});

test('uses an explicit operation count for existing multisig changes', () => {
  const result = assessMultisigReserve(account(), 0, 5_000_000, 100, 3);
  assert.equal(result.addedReserveStroops, 0n);
  assert.equal(result.setupFeeStroops, 300n);
});
