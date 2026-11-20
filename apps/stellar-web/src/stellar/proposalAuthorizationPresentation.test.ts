import assert from 'node:assert/strict';
import test from 'node:test';
import type { SourceAnalysis } from '../../../../packages/stellar-core/src/transactionReviewAnalysis.js';
import type { TransactionAuthorizationStatus } from '../../../../packages/stellar-core/src/transactionAuthorization.js';
import { proposalWalletSigningState, weightedProposalRequirements } from './proposalAuthorizationPresentation.js';

const alice = 'GALICE';
const bob = 'GBOB';
const carol = 'GCAROL';
const dave = 'GDAVE';

function account(accountId: string, signers: { key: string; weight: number }[], exactNOfM: { required: number; total: number } | null = null): SourceAnalysis {
  return {
    accountId,
    account: { signers: signers.map((signer) => ({ ...signer, type: 'ed25519_public_key' })) },
    analysis: { thresholds: { medium: { exactNOfM } } },
  } as unknown as SourceAnalysis;
}

function status(
  sources: { accountId: string; requiredWeight?: number; matchedWeight?: number; missingWeight?: number; matchedSigners?: { signerKey: string; automatic: boolean }[]; satisfied?: boolean; error?: string }[],
  extraSigners: { signerKey: string; signerType: string; satisfied: boolean; automatic: boolean }[] = [],
  innerOutcome: 'missing' | 'unknown' | 'authorized' | 'bad_auth_extra' = 'missing',
): TransactionAuthorizationStatus {
  return {
    sources: sources.map((source) => ({
      scope: 'inner', threshold: 'medium', matchedSigners: [], ...source,
    })),
    extraSigners,
    innerOutcome,
    outerOutcome: null,
  } as unknown as TransactionAuthorizationStatus;
}

test('weighted authorization reports power instead of the number of signatures', () => {
  const a = account('GACCOUNT1', [{ key: alice, weight: 2 }, { key: bob, weight: 1 }, { key: carol, weight: 1 }]);
  const auth = status([{
    accountId: a.accountId, requiredWeight: 3, matchedWeight: 2, missingWeight: 1,
    satisfied: false, matchedSigners: [{ signerKey: alice, automatic: false }],
  }]);
  assert.deepEqual(weightedProposalRequirements(auth, [a]), [{
    accountId: a.accountId, scope: 'inner', matchedWeight: 2, requiredWeight: 3, missingWeight: 1,
  }]);
  assert.equal(proposalWalletSigningState(auth, [a], alice), 'signed');
  assert.equal(proposalWalletSigningState(auth, [a], bob), 'can_sign');
  assert.equal(proposalWalletSigningState(auth, [a], carol), 'can_sign');
  assert.equal(proposalWalletSigningState(auth, [a], dave), 'other_signer');
});

test('multiple source account weights remain separate and uniform policies retain signer-count display', () => {
  const a = account('GACCOUNT1', [{ key: alice, weight: 2 }, { key: bob, weight: 1 }, { key: carol, weight: 1 }]);
  const b = account('GACCOUNT2', [{ key: alice, weight: 1 }, { key: carol, weight: 1 }]);
  const auth = status([
    { accountId: a.accountId, requiredWeight: 3, matchedWeight: 2, missingWeight: 1, satisfied: false },
    { accountId: b.accountId, requiredWeight: 2, matchedWeight: 1, missingWeight: 1, satisfied: false },
  ]);
  const rows = weightedProposalRequirements(auth, [a, b]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => [row.accountId, row.matchedWeight, row.requiredWeight]), [
    [a.accountId, 2, 3], [b.accountId, 1, 2],
  ]);
  assert.equal(weightedProposalRequirements(auth, [account(a.accountId, a.account!.signers, { required: 2, total: 3 }), b]).length, 1);
});

test('extra signer is mandatory even when account thresholds are satisfied', () => {
  const a = account('GACCOUNT1', [{ key: alice, weight: 1 }], { required: 1, total: 1 });
  const auth = status([{
    accountId: a.accountId, requiredWeight: 1, matchedWeight: 1, missingWeight: 0, satisfied: true,
    matchedSigners: [{ signerKey: alice, automatic: false }],
  }], [{ signerKey: carol, signerType: 'ed25519_public_key', satisfied: false, automatic: false }]);
  assert.equal(proposalWalletSigningState(auth, [a], carol), 'can_sign');
  assert.equal(proposalWalletSigningState(auth, [a], bob), 'other_signer');
  assert.equal(proposalWalletSigningState(auth, [a], alice), 'signed');
});

test('unknown signer policy cannot claim wallet eligibility', () => {
  const auth = status([{ accountId: 'GACCOUNT1', error: 'Horizon unavailable' }], [], 'unknown');
  assert.equal(proposalWalletSigningState(auth, [], alice), 'unknown');
  assert.equal(proposalWalletSigningState(null, [], alice), 'unknown');
  assert.equal(proposalWalletSigningState(auth, [], ''), 'unknown');
  assert.deepEqual(weightedProposalRequirements(auth, []), []);
});

test('Core-rejected extra signatures must not look like a pending signer invitation', () => {
  const a = account('GACCOUNT1', [{ key: alice, weight: 2 }]);
  const auth = status([{
    accountId: a.accountId, requiredWeight: 2, matchedWeight: 2,
    missingWeight: 0, satisfied: true, matchedSigners: [{ signerKey: alice, automatic: false }],
  }], [], 'bad_auth_extra');
  assert.equal(proposalWalletSigningState(auth, [a], alice), 'needs_review');
  assert.equal(proposalWalletSigningState(auth, [a], bob), 'needs_review');
});
