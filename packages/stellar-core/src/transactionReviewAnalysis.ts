import { analyzeAccountAuthorization } from './authorization.js';
import { loadAccount } from './horizon.js';
import type { AccountLookupResult, TransactionAuthorizationStatus } from './transactionAuthorization.js';
import type { TransactionXdrInspection } from './transactionXdr.js';
import type { AccountAuthorizationAnalysis, StellarAccountSnapshot, StellarNetwork } from './types.js';

export interface SourceAnalysis extends AccountLookupResult {
  analysis?: AccountAuthorizationAnalysis;
}

export type TransactionReviewAuthorizationStatus =
  | 'satisfied'
  | 'missing'
  | 'bad_auth_extra'
  | 'unknown'
  | null;

type AccountLoader = (
  accountId: string,
  network: StellarNetwork,
) => Promise<StellarAccountSnapshot>;

export async function loadTransactionSourceAnalyses(
  inspection: TransactionXdrInspection,
  network: StellarNetwork,
  accountLoader: AccountLoader = loadAccount,
): Promise<SourceAnalysis[]> {
  const accountIds = [...new Set(
    inspection.sourceRequirements.map((requirement) => requirement.accountId),
  )];

  return Promise.all(accountIds.map(async (accountId): Promise<SourceAnalysis> => {
    try {
      const account = await accountLoader(accountId, network);
      return { accountId, account, analysis: analyzeAccountAuthorization(account) };
    } catch (cause) {
      return {
        accountId,
        error: cause instanceof Error ? cause.message : 'Unable to load account.',
      };
    }
  }));
}

export function projectTransactionReviewAuthorizationStatus(
  authorization: Pick<TransactionAuthorizationStatus, 'innerOutcome' | 'outerOutcome' | 'coreAuthorizationValid'> | null,
): TransactionReviewAuthorizationStatus {
  if (!authorization) return null;
  if (authorization.innerOutcome === 'unknown' || authorization.outerOutcome === 'unknown') return 'unknown';
  if (authorization.innerOutcome === 'bad_auth_extra' || authorization.outerOutcome === 'bad_auth_extra') return 'bad_auth_extra';
  return authorization.coreAuthorizationValid ? 'satisfied' : 'missing';
}

export function canSubmitReviewedTransactionDirectly(
  authorizationStatus: TransactionReviewAuthorizationStatus,
  readyForSubmit: boolean,
  hasSorobanInvocation: boolean,
  sorobanExecutionReady = false,
): boolean {
  return authorizationStatus === 'satisfied'
    && readyForSubmit
    && (!hasSorobanInvocation || sorobanExecutionReady);
}
