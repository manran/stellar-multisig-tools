import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyTreasuryRelationship, hasSharedSigningControl } from '../../../../packages/stellar-core/src/treasuryModel.js';
import type { StellarAccountSnapshot } from '../../../../packages/stellar-core/src/types.js';

const WALLET = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const B = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWCF';
const TREASURY = 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCMZX';

function account(overrides: Partial<StellarAccountSnapshot> = {}): StellarAccountSnapshot {
  return {
    accountId: WALLET,
    sequence: '1',
    subentryCount: 0,
    numSponsoring: 0,
    numSponsored: 0,
    thresholds: { low: 1, medium: 1, high: 1 },
    signers: [{ key: WALLET, type: 'ed25519_public_key', weight: 1 }],
    ...overrides,
  };
}

test('keeps the connected ordinary single-signature account out of Treasury by default', () => {
  assert.equal(classifyTreasuryRelationship(account(), WALLET), 'personal_account');
  assert.equal(hasSharedSigningControl(account()), false);
});

test('shared signing capability is derived from active signers, not approval count', () => {
  const oneOfTwo = account({
    accountId: TREASURY,
    thresholds: { low: 1, medium: 1, high: 1 },
    signers: [
      { key: TREASURY, type: 'ed25519_public_key', weight: 1 },
      { key: WALLET, type: 'ed25519_public_key', weight: 1 },
    ],
  });

  assert.equal(hasSharedSigningControl(oneOfTwo), true);
});

test('suggests obvious multisig accounts as treasuries without making suggestion a saved preference', () => {
  const multisig = account({
    accountId: TREASURY,
    thresholds: { low: 2, medium: 2, high: 2 },
    signers: [
      { key: TREASURY, type: 'ed25519_public_key', weight: 1 },
      { key: WALLET, type: 'ed25519_public_key', weight: 1 },
      { key: B, type: 'ed25519_public_key', weight: 1 },
    ],
  });
  assert.equal(classifyTreasuryRelationship(multisig, WALLET), 'suggested_treasury');
  assert.equal(hasSharedSigningControl(multisig), true);
});
