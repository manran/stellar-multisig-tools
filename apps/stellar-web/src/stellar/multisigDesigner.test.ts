import assert from 'node:assert/strict';
import test from 'node:test';
import { assessExistingMultisigSource, assessSetupSource, designExactMultisigPolicy, designExistingMultisigPolicy } from './multisigDesigner.js';
import type { StellarAccountSnapshot } from '../../../../packages/stellar-core/src/types.js';

const MASTER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const B = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWCF';
const C = 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCMZX';

function freshAccount(): StellarAccountSnapshot {
  return {
    accountId: MASTER,
    sequence: '100',
    subentryCount: 0,
    numSponsoring: 0,
    numSponsored: 0,
    thresholds: { low: 0, medium: 0, high: 0 },
    signers: [{ key: MASTER, type: 'ed25519_public_key', weight: 1 }],
  };
}

test('designs a 2-of-3 payment and 3-of-3 control policy with the master participating', () => {
  const account = freshAccount();
  const design = designExactMultisigPolicy(account, {
    additionalSignerKeys: [B, C],
    keepMaster: true,
    paymentQuorum: 2,
    adminQuorum: 3,
  });

  assert.equal(design.participantCount, 3);
  assert.deepEqual(design.thresholds, { low: 2, medium: 2, high: 3 });
  assert.equal(design.masterWeight, 1);
  assert.deepEqual(design.targetAccount.signers.map((signer) => signer.weight), [1, 1, 1]);
  assert.equal(design.setupSteps.at(-1)?.kind, 'finalize_policy');
  assert.equal(design.reserveSubentriesAdded, 2);
});

test('can disable the master after adding external signers', () => {
  const design = designExactMultisigPolicy(freshAccount(), {
    additionalSignerKeys: [B, C],
    keepMaster: false,
    paymentQuorum: 2,
    adminQuorum: 2,
  });

  assert.equal(design.participantCount, 2);
  assert.equal(design.masterWeight, 0);
  assert.equal(design.targetAccount.signers[0].weight, 0);
  assert.deepEqual(design.thresholds, { low: 2, medium: 2, high: 2 });
});

test('deduplicates repeated additional signer keys', () => {
  const design = designExactMultisigPolicy(freshAccount(), {
    additionalSignerKeys: [B, B, ` ${C} `],
    keepMaster: true,
    paymentQuorum: 2,
    adminQuorum: 3,
  });

  assert.deepEqual(design.additionalSignerKeys, [B, C]);
  assert.equal(design.participantCount, 3);
});

test('rejects an account-control quorum below the payment quorum', () => {
  assert.throws(() => designExactMultisigPolicy(freshAccount(), {
    additionalSignerKeys: [B, C],
    keepMaster: true,
    paymentQuorum: 3,
    adminQuorum: 2,
  }), /Account-control quorum/);
});

test('only generates the simple setup path for master-controlled accounts without existing additional signers', () => {
  const fresh = assessSetupSource(freshAccount());
  assert.equal(fresh.supported, true);

  const existing = freshAccount();
  existing.signers.push({ key: B, type: 'ed25519_public_key', weight: 1 });
  const migrated = assessSetupSource(existing);
  assert.equal(migrated.supported, false);
  assert.match(migrated.reasons.join(' '), /already has active additional signers/);

  const high = freshAccount();
  high.thresholds.high = 2;
  const insufficientMaster = assessSetupSource(high);
  assert.equal(insufficientMaster.supported, false);
  assert.match(insufficientMaster.reasons.join(' '), /does not have enough approval power/);
});

test('supports 20 additional signers plus the master while keeping quorums within the 20-signature envelope limit', () => {
  const additionalSignerKeys = Array.from({ length: 20 }, (_, index) => `signer-${index}`);
  const design = designExactMultisigPolicy(freshAccount(), {
    additionalSignerKeys,
    keepMaster: true,
    paymentQuorum: 20,
    adminQuorum: 20,
  });

  assert.equal(design.participantCount, 21);
  assert.equal(design.additionalSignerKeys.length, 20);
  assert.throws(() => designExactMultisigPolicy(freshAccount(), {
    additionalSignerKeys,
    keepMaster: true,
    paymentQuorum: 20,
    adminQuorum: 21,
  }), /Account-control quorum/);
});


test('supports the common existing 2-of-3 ed25519 policy', () => {
  const existing = freshAccount();
  existing.thresholds = { low: 2, medium: 2, high: 2 };
  existing.subentryCount = 2;
  existing.signers.push(
    { key: B, type: 'ed25519_public_key', weight: 1 },
    { key: C, type: 'ed25519_public_key', weight: 1 },
  );
  const assessment = assessExistingMultisigSource(existing);
  assert.equal(assessment.existing, true);
  assert.equal(assessment.supported, true);
});

test('fails closed for weighted or advanced existing multisig policies', () => {
  const weighted = freshAccount();
  weighted.thresholds = { low: 2, medium: 2, high: 2 };
  weighted.signers.push({ key: B, type: 'ed25519_public_key', weight: 2 });
  assert.equal(assessExistingMultisigSource(weighted).supported, false);
  assert.match(assessExistingMultisigSource(weighted).reasons.join(' '), /custom approval power/i);

  const advanced = freshAccount();
  advanced.thresholds = { low: 1, medium: 1, high: 1 };
  advanced.signers.push({ key: B, type: 'sha256_hash', weight: 1 });
  assert.equal(assessExistingMultisigSource(advanced).supported, false);
  assert.match(assessExistingMultisigSource(advanced).reasons.join(' '), /signing method/i);
});

test('designs atomic removal, addition, and threshold changes for existing 2-of-3', () => {
  const existing = freshAccount();
  existing.thresholds = { low: 2, medium: 2, high: 2 };
  existing.subentryCount = 2;
  existing.signers.push(
    { key: B, type: 'ed25519_public_key', weight: 1 },
    { key: C, type: 'ed25519_public_key', weight: 1 },
  );

  const design = designExistingMultisigPolicy(existing, {
    additionalSignerKeys: [C, 'GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD'],
    keepMaster: true,
    paymentQuorum: 2,
    adminQuorum: 3,
  });
  assert.equal(design.mode, 'change');
  assert.equal(design.signerChanges[0].kind, 'remove_signer');
  assert.equal(design.signerChanges[0].signerKey, B);
  assert.equal(design.signerChanges[0].weight, 0);
  assert.equal(design.signerChanges[1].kind, 'add_signer');
  assert.equal(design.operationCount, 3);
  assert.equal(design.reserveSubentriesAdded, 0);
});

test('does not create a transaction when an existing policy is unchanged', () => {
  const existing = freshAccount();
  existing.thresholds = { low: 2, medium: 2, high: 2 };
  existing.signers.push(
    { key: B, type: 'ed25519_public_key', weight: 1 },
    { key: C, type: 'ed25519_public_key', weight: 1 },
  );
  assert.throws(() => designExistingMultisigPolicy(existing, {
    additionalSignerKeys: [B, C],
    keepMaster: true,
    paymentQuorum: 2,
    adminQuorum: 2,
  }), /No signing changes/);
});
