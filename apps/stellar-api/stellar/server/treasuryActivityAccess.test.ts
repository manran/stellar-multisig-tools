import assert from 'node:assert/strict';
import test from 'node:test';
import { canViewTreasuryActivity } from './treasuryActivityAccess.js';
import type { StellarAccountSnapshot } from '../../../../packages/stellar-core/src/types.js';

const TREASURY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const ACTIVE = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWCF';
const REMOVED = 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCMZX';

function account(): StellarAccountSnapshot {
  return {
    accountId: TREASURY,
    sequence: '1',
    subentryCount: 0,
    numSponsoring: 0,
    numSponsored: 0,
    thresholds: { low: 1, medium: 2, high: 2 },
    signers: [
      { key: TREASURY, type: 'ed25519_public_key', weight: 1 },
      { key: ACTIVE, type: 'ed25519_public_key', weight: 1 },
      { key: REMOVED, type: 'ed25519_public_key', weight: 0 },
    ],
  };
}

test('Treasury Activity is available only to current active signers', () => {
  const treasury = account();
  assert.equal(canViewTreasuryActivity(treasury, ACTIVE), true);
  assert.equal(canViewTreasuryActivity(treasury, TREASURY), true);
  assert.equal(canViewTreasuryActivity(treasury, REMOVED), false);
});
