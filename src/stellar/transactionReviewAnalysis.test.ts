import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canSubmitReviewedTransactionDirectly,
  loadTransactionSourceAnalyses,
  projectTransactionReviewAuthorizationStatus,
} from './transactionReviewAnalysis.js';
import type { TransactionXdrInspection } from './transactionXdr.js';
import type { StellarAccountSnapshot } from './types.js';

const ACCOUNT_A = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const ACCOUNT_B = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBFKQ';

function inspection(): TransactionXdrInspection {
  return {
    network: 'public',
    envelopeType: 'fee_bump',
    transactionSource: ACCOUNT_A,
    transactionSourceAccount: ACCOUNT_A,
    feeSource: ACCOUNT_A,
    feeSourceAccount: ACCOUNT_A,
    fee: '200',
    innerFee: '100',
    sequence: '1',
    memo: { type: 'none' },
    innerSignatureCount: 0,
    outerSignatureCount: 0,
    extraSigners: [],
    operations: [],
    sourceRequirements: [
      { accountId: ACCOUNT_A, scope: 'inner', threshold: 'low', reasons: ['inner'] },
      { accountId: ACCOUNT_A, scope: 'outer', threshold: 'low', reasons: ['outer'] },
      { accountId: ACCOUNT_B, scope: 'inner', threshold: 'medium', reasons: ['operation'] },
    ],
  };
}

function account(accountId: string): StellarAccountSnapshot {
  return {
    accountId,
    sequence: '1',
    subentryCount: 0,
    numSponsoring: 0,
    numSponsored: 0,
    thresholds: { low: 1, medium: 2, high: 2 },
    signers: [{ key: accountId, type: 'ed25519_public_key', weight: 1 }],
  };
}

test('loads each source account once even when inner and outer requirements share it', async () => {
  const calls: string[] = [];
  const analyses = await loadTransactionSourceAnalyses(
    inspection(),
    'public',
    async (accountId) => {
      calls.push(accountId);
      if (accountId === ACCOUNT_B) throw new Error('lookup failed');
      return account(accountId);
    },
  );

  assert.deepEqual(calls, [ACCOUNT_A, ACCOUNT_B]);
  assert.equal(analyses.length, 2);
  assert.equal(analyses[0].account?.accountId, ACCOUNT_A);
  assert.equal(analyses[0].analysis?.masterKeyWeight, 1);
  assert.equal(analyses[1].accountId, ACCOUNT_B);
  assert.equal(analyses[1].error, 'lookup failed');
});

test('projects authorization status from both inner and outer Core outcomes', () => {
  assert.equal(projectTransactionReviewAuthorizationStatus(null), null);
  assert.equal(projectTransactionReviewAuthorizationStatus({
    innerOutcome: 'authorized',
    outerOutcome: null,
    coreAuthorizationValid: true,
  }), 'satisfied');
  assert.equal(projectTransactionReviewAuthorizationStatus({
    innerOutcome: 'missing',
    outerOutcome: null,
    coreAuthorizationValid: false,
  }), 'missing');
  assert.equal(projectTransactionReviewAuthorizationStatus({
    innerOutcome: 'authorized',
    outerOutcome: 'unknown',
    coreAuthorizationValid: false,
  }), 'unknown');
  assert.equal(projectTransactionReviewAuthorizationStatus({
    innerOutcome: 'authorized',
    outerOutcome: 'bad_auth_extra',
    coreAuthorizationValid: false,
  }), 'bad_auth_extra');
});

test('direct submit is only offered when Classic authorization and preconditions are complete', () => {
  assert.equal(canSubmitReviewedTransactionDirectly('satisfied', true, false), true);
  assert.equal(canSubmitReviewedTransactionDirectly('satisfied', false, false), false);
  assert.equal(canSubmitReviewedTransactionDirectly('missing', true, false), false);
  assert.equal(canSubmitReviewedTransactionDirectly('bad_auth_extra', true, false), false);
  assert.equal(canSubmitReviewedTransactionDirectly('unknown', true, false), false);
  assert.equal(canSubmitReviewedTransactionDirectly('satisfied', true, true), false);
  assert.equal(canSubmitReviewedTransactionDirectly('satisfied', true, true, true), true);
});
