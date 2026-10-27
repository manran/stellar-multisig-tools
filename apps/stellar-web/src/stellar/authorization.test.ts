import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeAccountAuthorization } from '../../../../packages/stellar-core/src/authorization.js';
import { thresholdLevelForOperation } from '../../../../packages/stellar-core/src/operationThreshold.js';
import { summarizeTransactionSources } from '../../../../packages/stellar-core/src/transactionRequirements.js';
import type { StellarAccountSnapshot } from '../../../../packages/stellar-core/src/types.js';

const baseAccount: StellarAccountSnapshot = {
  accountId: 'GMASTER',
  sequence: '1',
  subentryCount: 2,
  numSponsoring: 0,
  numSponsored: 0,
  thresholds: { low: 1, medium: 2, high: 3 },
  signers: [
    { key: 'GMASTER', type: 'ed25519_public_key', weight: 1 },
    { key: 'GALICE', type: 'ed25519_public_key', weight: 1 },
    { key: 'GBOB', type: 'ed25519_public_key', weight: 1 },
  ],
};

test('explains exact 1/2/3-of-3 policies', () => {
  const analysis = analyzeAccountAuthorization(baseAccount);
  assert.equal(analysis.thresholds.low.policyLabel, '1-of-3');
  assert.equal(analysis.thresholds.medium.policyLabel, '2-of-3');
  assert.equal(analysis.thresholds.high.policyLabel, '3-of-3');
  assert.equal(analysis.thresholds.medium.guaranteedSignerFailuresTolerated, 1);
  assert.equal(analysis.thresholds.high.guaranteedSignerFailuresTolerated, 0);
});

test('does not mislabel weighted authorization as n-of-m', () => {
  const analysis = analyzeAccountAuthorization({
    ...baseAccount,
    thresholds: { low: 1, medium: 3, high: 4 },
    signers: [
      { key: 'GMASTER', type: 'ed25519_public_key', weight: 2 },
      { key: 'GALICE', type: 'ed25519_public_key', weight: 1 },
      { key: 'GBOB', type: 'ed25519_public_key', weight: 1 },
    ],
  });

  assert.equal(analysis.thresholds.medium.policyLabel, 'Weighted · min 2 signers');
  assert.equal(analysis.thresholds.medium.exactNOfM, null);
});

test('detects an unreachable high threshold', () => {
  const analysis = analyzeAccountAuthorization({
    ...baseAccount,
    thresholds: { low: 1, medium: 2, high: 4 },
  });

  assert.equal(analysis.thresholds.high.reachable, false);
  assert.equal(analysis.thresholds.high.policyLabel, 'Unreachable');
  assert.ok(analysis.findings.some((finding) => finding.severity === 'critical'));
});

test('detects single-signer medium authorization', () => {
  const analysis = analyzeAccountAuthorization({
    ...baseAccount,
    signers: [
      { key: 'GMASTER', type: 'ed25519_public_key', weight: 0 },
      { key: 'GALICE', type: 'ed25519_public_key', weight: 2 },
      { key: 'GBOB', type: 'ed25519_public_key', weight: 1 },
    ],
  });

  assert.deepEqual(analysis.thresholds.medium.singleSignerKeys, ['GALICE']);
  assert.ok(analysis.findings.some((finding) => finding.title.includes('single signer')));
});

test('describes a true single-signature account without generic multisig warnings', () => {
  const analysis = analyzeAccountAuthorization({
    ...baseAccount,
    thresholds: { low: 1, medium: 1, high: 1 },
    signers: [{ key: 'GMASTER', type: 'ed25519_public_key', weight: 1 }],
  });

  const singleSignature = analysis.findings.find((finding) => finding.title === 'Single-signature account');
  assert.ok(singleSignature);
  assert.match(singleSignature.detail, /GMASTER/);
  assert.equal(analysis.findings.some((finding) => finding.title.includes('medium-threshold')), false);
  assert.equal(analysis.findings.some((finding) => finding.title.includes('high-threshold')), false);
});

test('does not count preauth_tx as reusable account control', () => {
  const analysis = analyzeAccountAuthorization({
    ...baseAccount,
    thresholds: { low: 1, medium: 2, high: 2 },
    signers: [
      { key: 'GMASTER', type: 'ed25519_public_key', weight: 0 },
      { key: 'T-PREAUTH', type: 'preauth_tx', weight: 2 },
      { key: 'GALICE', type: 'ed25519_public_key', weight: 1 },
    ],
  });

  assert.equal(analysis.totalActiveWeight, 1);
  assert.equal(analysis.thresholds.medium.reachable, false);
  assert.ok(analysis.findings.some((finding) => finding.title.includes('pre-authorized')));
});

test('warns about Hash(x) and signed-payload signer semantics', () => {
  const analysis = analyzeAccountAuthorization({
    ...baseAccount,
    signers: [
      { key: 'GMASTER', type: 'ed25519_public_key', weight: 1 },
      { key: 'XHASH', type: 'sha256_hash', weight: 1 },
      { key: 'PPAYLOAD', type: 'ed25519_signed_payload', weight: 1 },
    ],
  });

  assert.ok(analysis.findings.some((finding) => finding.title.includes('Hash(x)')));
  assert.ok(analysis.findings.some((finding) => finding.title.includes('signed-payload')));
});

test('maps Stellar operation threshold classes', () => {
  assert.equal(thresholdLevelForOperation('payment'), 'medium');
  assert.equal(thresholdLevelForOperation('claimClaimableBalance'), 'low');
  assert.equal(thresholdLevelForOperation('bumpSequence'), 'low');
  assert.equal(thresholdLevelForOperation('inflation'), 'low');
  assert.equal(thresholdLevelForOperation('extendFootprintTtl'), 'low');
  assert.equal(thresholdLevelForOperation('restoreFootprint'), 'low');
  assert.equal(thresholdLevelForOperation('accountMerge'), 'high');
  assert.equal(thresholdLevelForOperation('setOptions'), 'high');
  assert.equal(
    thresholdLevelForOperation('setOptions', { setOptionsChangesAuthorization: false }),
    'medium',
  );
});

test('merges transaction and operation requirements by strongest threshold', () => {
  const requirements = summarizeTransactionSources('GTREASURY', [
    { index: 0, type: 'payment', sourceAccount: 'GTREASURY', threshold: 'medium' },
    { index: 1, type: 'setOptions', sourceAccount: 'GISSUER', threshold: 'high' },
  ]);

  assert.deepEqual(requirements, [
    {
      accountId: 'GTREASURY',
      scope: 'inner',
      threshold: 'medium',
      reasons: ['Transaction source authorization', 'Operation 1: payment'],
    },
    {
      accountId: 'GISSUER',
      scope: 'inner',
      threshold: 'high',
      reasons: ['Operation 2: setOptions'],
    },
  ]);
});

test('keeps fee-bump fee source in outer scope even when it is also the inner source', () => {
  const requirements = summarizeTransactionSources(
    'GONE',
    [{ index: 0, type: 'payment', sourceAccount: 'GONE', threshold: 'medium' }],
    'GONE',
  );

  assert.deepEqual(requirements, [
    {
      accountId: 'GONE',
      scope: 'inner',
      threshold: 'medium',
      reasons: ['Transaction source authorization', 'Operation 1: payment'],
    },
    {
      accountId: 'GONE',
      scope: 'outer',
      threshold: 'low',
      reasons: ['Fee-bump fee source authorization'],
    },
  ]);
});
