import assert from 'node:assert/strict';
import test from 'node:test';
import type { StellarNetworkParameters } from '../../../../src/stellar/horizon.js';
import type { StellarAccountSnapshot } from '../../../../src/stellar/types.js';
import { assessClassicManagedChannelCreatorCapacity } from './classicManagedChannelCapacity.js';

const parameters: StellarNetworkParameters = {
  ledgerSequence: 1,
  ledgerClosedAt: '2026-09-21T00:00:00.000Z',
  baseFeeInStroops: 100,
  baseReserveInStroops: 5_000_000,
};

function account(balance: string): StellarAccountSnapshot {
  return {
    accountId: 'GCREATOR',
    sequence: '1',
    subentryCount: 0,
    numSponsoring: 0,
    numSponsored: 0,
    nativeBalance: balance,
    nativeSellingLiabilities: '0',
    balances: [],
    thresholds: { low: 1, medium: 1, high: 1 },
    signers: [],
  };
}

test('creator capacity uses 50/60 hysteresis while allowing low-balance channel creation', () => {
  const firstLow = assessClassicManagedChannelCreatorCapacity(account('49'), parameters);
  assert.equal(firstLow.state, 'low');
  assert.equal(firstLow.canCreateNextChannel, true);
  assert.equal(firstLow.lowThreshold, '50');
  assert.equal(firstLow.recoveryThreshold, '60');
  assert.equal(firstLow.requiredForNextChannel, '3.0000100');

  assert.equal(assessClassicManagedChannelCreatorCapacity(account('55'), parameters, 'low').state, 'low');
  assert.equal(assessClassicManagedChannelCreatorCapacity(account('60'), parameters, 'low').state, 'ready');
});

test('creator capacity fails only when another channel cannot be funded while retaining reserve', () => {
  const insufficient = assessClassicManagedChannelCreatorCapacity(account('3'), parameters, 'low');
  assert.equal(insufficient.canCreateNextChannel, false);
  assert.equal(insufficient.state, 'insufficient');

  const exact = assessClassicManagedChannelCreatorCapacity(account('3.0000100'), parameters, 'low');
  assert.equal(exact.canCreateNextChannel, true);
  assert.equal(exact.state, 'low');
});
