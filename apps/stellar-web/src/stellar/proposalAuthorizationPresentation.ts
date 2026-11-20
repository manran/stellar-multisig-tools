import type { TransactionAuthorizationStatus } from '../../../../packages/stellar-core/src/transactionAuthorization.js';
import type { SourceAnalysis } from '../../../../packages/stellar-core/src/transactionReviewAnalysis.js';

export type ProposalWalletSigningState = 'signed' | 'can_sign' | 'other_signer' | 'unknown' | 'needs_review';

// Only verified, current account rules can establish that a wallet is eligible.
// Assignment, email delivery, and raw signature counts are not signing authority.
export function proposalWalletSigningState(
  authorization: TransactionAuthorizationStatus | null,
  sourceAnalyses: readonly SourceAnalysis[],
  walletAddress: string,
): ProposalWalletSigningState {
  if (!walletAddress || !authorization) return 'unknown';

  if (authorization.innerOutcome === 'bad_auth_extra' || authorization.outerOutcome === 'bad_auth_extra') return 'needs_review';

  const alreadySigned = authorization.sources.some((source) =>
    source.matchedSigners.some((signer) => !signer.automatic && signer.signerKey === walletAddress))
    || authorization.extraSigners.some((signer) =>
      signer.satisfied && !signer.automatic && signer.signerKey === walletAddress);
  if (alreadySigned) return 'signed';

  const neededAccountSignature = authorization.sources.some((source) =>
    source.satisfied === false
    && sourceAnalyses.some((loaded) =>
      loaded.accountId === source.accountId
      && loaded.account?.signers.some((signer) =>
        signer.key === walletAddress && signer.type === 'ed25519_public_key' && signer.weight > 0)));
  const neededExtraSignature = authorization.extraSigners.some((signer) =>
    !signer.satisfied && signer.signerKey === walletAddress && signer.signerType === 'ed25519_public_key');

  if (neededAccountSignature || neededExtraSignature) return 'can_sign';
  if (authorization.sources.some((source) => source.satisfied === undefined || source.error)
    || authorization.innerOutcome === 'unknown'
    || authorization.outerOutcome === 'unknown') return 'unknown';
  return 'other_signer';
}

// Account thresholds are independent. Never sum their weights or derive a
// "signatures needed" count from approval power.
export function weightedProposalRequirements(
  authorization: TransactionAuthorizationStatus | null,
  sourceAnalyses: readonly SourceAnalysis[],
) {
  return (authorization?.sources ?? []).flatMap((source) => {
    const loaded = sourceAnalyses.find((analysis) => analysis.accountId === source.accountId);
    const policy = loaded?.analysis?.thresholds[source.threshold];
    if (!policy || policy.exactNOfM || source.requiredWeight === undefined
      || source.matchedWeight === undefined || source.missingWeight === undefined) return [];
    return [{
      accountId: source.accountId,
      scope: source.scope,
      matchedWeight: source.matchedWeight,
      requiredWeight: source.requiredWeight,
      missingWeight: source.missingWeight,
    }];
  });
}
