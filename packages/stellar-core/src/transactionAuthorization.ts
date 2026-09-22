import { simulateEnvelopeSignatureCheck } from './signatureAnalysis.js';
import type { CoreEnvelopeSignatureCheck, MatchedSignerSignature } from './signatureAnalysis.js';
import type { TransactionXdrInspection } from './transactionXdr.js';
import type { AuthorizationScope, SourceAuthorizationRequirement } from './transactionRequirements.js';
import type { StellarAccountSnapshot, StellarNetwork, StellarSigner, ThresholdLevel } from './types.js';

export interface AccountLookupResult {
  accountId: string;
  account?: StellarAccountSnapshot;
  error?: string;
}

export interface AuthorizationCheckStatus {
  accountId: string;
  scope: AuthorizationScope;
  threshold: ThresholdLevel;
  reason: string;
  requiredWeight?: number;
  matchedWeight?: number;
  missingWeight?: number;
  satisfied?: boolean;
  matchedSigners: MatchedSignerSignature[];
  usedSignatureIndexes: number[];
  signatureCount: number;
  error?: string;
}

export interface SourceAuthorizationStatus {
  accountId: string;
  scope: AuthorizationScope;
  threshold: ThresholdLevel;
  reasons: string[];
  requiredWeight?: number;
  matchedWeight?: number;
  missingWeight?: number;
  satisfied?: boolean;
  matchedSigners: MatchedSignerSignature[];
  signatureCount: number;
  checks: AuthorizationCheckStatus[];
  error?: string;
}

export interface ExtraSignerStatus {
  signerKey: string;
  signerType: string;
  satisfied: boolean;
  automatic: boolean;
  signatureIndex?: number;
}

export type CoreAuthorizationOutcome = 'authorized' | 'missing' | 'bad_auth_extra' | 'unknown';

export interface TransactionAuthorizationStatus {
  sources: SourceAuthorizationStatus[];
  checks: AuthorizationCheckStatus[];
  extraSigners: ExtraSignerStatus[];
  sourceRequirementsSatisfied: boolean;
  extraSignerRequirementsSatisfied: boolean;
  signatureRequirementsSatisfied: boolean;
  coreAuthorizationValid: boolean;
  innerOutcome: CoreAuthorizationOutcome;
  outerOutcome: CoreAuthorizationOutcome | null;
  coreUsedInnerSignatureIndexes: number[] | null;
  coreUsedOuterSignatureIndexes: number[] | null;
  coreUnusedInnerSignatureIndexes: number[] | null;
  coreUnusedOuterSignatureIndexes: number[] | null;
  // Backwards-compatible aliases for the UI while it transitions to Core-order wording.
  definitelyUnrecognizedInnerSignatureIndexes: number[] | null;
  definitelyUnrecognizedOuterSignatureIndexes: number[] | null;
}

function requiredWeight(account: StellarAccountSnapshot, threshold: ThresholdLevel): number {
  return account.thresholds[threshold];
}

function signerTypeForKey(key: string): string {
  if (key.startsWith('G')) return 'ed25519_public_key';
  if (key.startsWith('T')) return 'preauth_tx';
  if (key.startsWith('X')) return 'sha256_hash';
  if (key.startsWith('P')) return 'ed25519_signed_payload';
  return 'unknown';
}

function findAccount(accounts: AccountLookupResult[], accountId: string): AccountLookupResult | undefined {
  return accounts.find((item) => item.accountId === accountId);
}

function analyzeCheck(
  envelopeXdr: string,
  network: StellarNetwork,
  accountId: string,
  scope: AuthorizationScope,
  threshold: ThresholdLevel,
  reason: string,
  lookup: AccountLookupResult | undefined,
): AuthorizationCheckStatus {
  if (!lookup?.account) {
    return {
      accountId,
      scope,
      threshold,
      reason,
      matchedSigners: [],
      usedSignatureIndexes: [],
      signatureCount: 0,
      error: lookup?.error ?? 'Account policy unavailable.',
    };
  }

  const required = requiredWeight(lookup.account, threshold);
  const signatures = simulateEnvelopeSignatureCheck(
    envelopeXdr,
    network,
    lookup.account.signers,
    required,
    scope,
  );

  return checkFromSimulation(accountId, scope, threshold, reason, required, signatures);
}

function checkFromSimulation(
  accountId: string,
  scope: AuthorizationScope,
  threshold: ThresholdLevel,
  reason: string,
  required: number,
  signatures: CoreEnvelopeSignatureCheck,
): AuthorizationCheckStatus {
  return {
    accountId,
    scope,
    threshold,
    reason,
    requiredWeight: required,
    matchedWeight: signatures.matchedWeight,
    missingWeight: signatures.satisfied ? 0 : Math.max(0, required - signatures.matchedWeight),
    satisfied: signatures.satisfied,
    matchedSigners: signatures.matchedSigners,
    usedSignatureIndexes: signatures.usedSignatureIndexes,
    signatureCount: signatures.signatureCount,
  };
}

function exactSourceChecks(
  envelopeXdr: string,
  network: StellarNetwork,
  inspection: TransactionXdrInspection,
  accountLookups: AccountLookupResult[],
): AuthorizationCheckStatus[] {
  const checks: AuthorizationCheckStatus[] = [];

  if (inspection.feeSourceAccount) {
    checks.push(analyzeCheck(
      envelopeXdr,
      network,
      inspection.feeSourceAccount,
      'outer',
      'low',
      'Fee-bump fee source authorization',
      findAccount(accountLookups, inspection.feeSourceAccount),
    ));
  }

  checks.push(analyzeCheck(
    envelopeXdr,
    network,
    inspection.transactionSourceAccount,
    'inner',
    'low',
    'Transaction source authorization',
    findAccount(accountLookups, inspection.transactionSourceAccount),
  ));

  for (const operation of inspection.operations) {
    checks.push(analyzeCheck(
      envelopeXdr,
      network,
      operation.sourceAccount,
      'inner',
      operation.threshold,
      `Operation ${operation.index + 1}: ${operation.type}`,
      findAccount(accountLookups, operation.sourceAccount),
    ));
  }

  return checks;
}

function analyzeExtraSigners(
  envelopeXdr: string,
  network: StellarNetwork,
  extraSignerKeys: string[],
): { statuses: ExtraSignerStatus[]; simulation: CoreEnvelopeSignatureCheck | null } {
  if (extraSignerKeys.length === 0) return { statuses: [], simulation: null };

  const signers: StellarSigner[] = extraSignerKeys.map((key) => ({
    key,
    type: signerTypeForKey(key),
    weight: 1,
  }));
  const simulation = simulateEnvelopeSignatureCheck(
    envelopeXdr,
    network,
    signers,
    signers.length,
    'inner',
  );
  const remainingMatches = [...simulation.matchedSigners];

  const statuses = signers.map((signer): ExtraSignerStatus => {
    const matchIndex = remainingMatches.findIndex((match) => match.signerKey === signer.key);
    if (matchIndex < 0) {
      return {
        signerKey: signer.key,
        signerType: signer.type,
        satisfied: false,
        automatic: false,
      };
    }

    const match = remainingMatches.splice(matchIndex, 1)[0];
    return {
      signerKey: signer.key,
      signerType: signer.type,
      satisfied: true,
      automatic: match.automatic,
      signatureIndex: match.signatureIndex,
    };
  });

  return { statuses, simulation };
}

function aggregateSource(
  requirement: SourceAuthorizationRequirement,
  checks: AuthorizationCheckStatus[],
): SourceAuthorizationStatus {
  const related = checks.filter((check) =>
    check.accountId === requirement.accountId && check.scope === requirement.scope,
  );
  const unknown = related.find((check) => check.satisfied === undefined);
  if (unknown) {
    return {
      accountId: requirement.accountId,
      scope: requirement.scope,
      threshold: requirement.threshold,
      reasons: requirement.reasons,
      matchedSigners: [],
      signatureCount: unknown.signatureCount,
      checks: related,
      error: unknown.error,
    };
  }

  const representative = [...related]
    .filter((check) => check.requiredWeight !== undefined)
    .sort((a, b) => (b.requiredWeight ?? 0) - (a.requiredWeight ?? 0))[0];
  const satisfied = related.every((check) => check.satisfied === true);

  return {
    accountId: requirement.accountId,
    scope: requirement.scope,
    threshold: requirement.threshold,
    reasons: requirement.reasons,
    requiredWeight: representative?.requiredWeight,
    matchedWeight: representative?.matchedWeight,
    missingWeight: satisfied ? 0 : Math.max(...related.map((check) => check.missingWeight ?? 0), 0),
    satisfied,
    matchedSigners: representative?.matchedSigners ?? [],
    signatureCount: representative?.signatureCount ?? 0,
    checks: related,
  };
}

function signatureIndexes(signatureCount: number): number[] {
  return Array.from({ length: signatureCount }, (_, index) => index);
}

function unionUsedIndexes(checks: AuthorizationCheckStatus[], extra?: CoreEnvelopeSignatureCheck | null): number[] {
  const used = new Set<number>();
  for (const check of checks) {
    for (const index of check.usedSignatureIndexes) used.add(index);
  }
  for (const index of extra?.usedSignatureIndexes ?? []) used.add(index);
  return [...used].sort((a, b) => a - b);
}

function outcome(
  checks: AuthorizationCheckStatus[],
  unusedSignatureIndexes: number[] | null,
  extraSatisfied = true,
): CoreAuthorizationOutcome {
  if (checks.some((check) => check.satisfied === undefined)) return 'unknown';
  if (!extraSatisfied || checks.some((check) => check.satisfied !== true)) return 'missing';
  if ((unusedSignatureIndexes?.length ?? 0) > 0) return 'bad_auth_extra';
  return 'authorized';
}

export function analyzeTransactionAuthorization(
  envelopeXdr: string,
  network: StellarNetwork,
  inspection: TransactionXdrInspection,
  accountLookups: AccountLookupResult[],
): TransactionAuthorizationStatus {
  const checks = exactSourceChecks(envelopeXdr, network, inspection, accountLookups);
  const sources = inspection.sourceRequirements.map((requirement) =>
    aggregateSource(requirement, checks),
  );
  const extra = analyzeExtraSigners(envelopeXdr, network, inspection.extraSigners);

  const innerChecks = checks.filter((check) => check.scope === 'inner');
  const outerChecks = checks.filter((check) => check.scope === 'outer');
  const transactionCheck = innerChecks[0];
  const outerKnown = outerChecks.every((check) => check.satisfied !== undefined);
  const sourceRequirementsSatisfied = checks.every((check) => check.satisfied === true);
  const extraSignerRequirementsSatisfied = extra.statuses.every((signer) => signer.satisfied);
  const signatureRequirementsSatisfied = sourceRequirementsSatisfied && extraSignerRequirementsSatisfied;

  let coreUsedInnerSignatureIndexes: number[] | null = null;
  if (transactionCheck?.satisfied !== undefined) {
    // Core checks transaction-source low threshold first. If it fails, extra
    // signers and operation signatures are not checked.
    coreUsedInnerSignatureIndexes = unionUsedIndexes([transactionCheck]);
    if (transactionCheck.satisfied && extra.simulation) {
      coreUsedInnerSignatureIndexes = unionUsedIndexes([transactionCheck], extra.simulation);
    }
    if (transactionCheck.satisfied && extraSignerRequirementsSatisfied) {
      coreUsedInnerSignatureIndexes = unionUsedIndexes(innerChecks, extra.simulation);
    }
  }

  const coreUsedOuterSignatureIndexes = outerKnown
    ? unionUsedIndexes(outerChecks)
    : null;
  const coreUnusedInnerSignatureIndexes = coreUsedInnerSignatureIndexes === null
    ? null
    : signatureIndexes(inspection.innerSignatureCount)
        .filter((index) => !coreUsedInnerSignatureIndexes.includes(index));
  const coreUnusedOuterSignatureIndexes = inspection.envelopeType !== 'fee_bump'
    ? []
    : coreUsedOuterSignatureIndexes === null
      ? null
      : signatureIndexes(inspection.outerSignatureCount)
          .filter((index) => !coreUsedOuterSignatureIndexes.includes(index));

  const innerOutcome = outcome(
    innerChecks,
    coreUnusedInnerSignatureIndexes,
    extraSignerRequirementsSatisfied,
  );
  const outerOutcome = inspection.envelopeType === 'fee_bump'
    ? outcome(outerChecks, coreUnusedOuterSignatureIndexes)
    : null;
  const coreAuthorizationValid = innerOutcome === 'authorized'
    && (outerOutcome === null || outerOutcome === 'authorized');

  return {
    sources,
    checks,
    extraSigners: extra.statuses,
    sourceRequirementsSatisfied,
    extraSignerRequirementsSatisfied,
    signatureRequirementsSatisfied,
    coreAuthorizationValid,
    innerOutcome,
    outerOutcome,
    coreUsedInnerSignatureIndexes,
    coreUsedOuterSignatureIndexes,
    coreUnusedInnerSignatureIndexes,
    coreUnusedOuterSignatureIndexes,
    definitelyUnrecognizedInnerSignatureIndexes: coreUnusedInnerSignatureIndexes,
    definitelyUnrecognizedOuterSignatureIndexes: coreUnusedOuterSignatureIndexes,
  };
}
