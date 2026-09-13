import type { ThresholdLevel } from './types.js';

export type AuthorizationScope = 'inner' | 'outer';

const LEVEL_RANK: Record<ThresholdLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export interface OperationAuthorizationRequirement {
  index: number;
  type: string;
  sourceAccount: string;
  threshold: ThresholdLevel;
}

export interface SourceAuthorizationRequirement {
  accountId: string;
  scope: AuthorizationScope;
  threshold: ThresholdLevel;
  reasons: string[];
}

function strongerThreshold(a: ThresholdLevel, b: ThresholdLevel): ThresholdLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

export function summarizeTransactionSources(
  transactionSource: string,
  operations: OperationAuthorizationRequirement[],
  feeSource?: string,
): SourceAuthorizationRequirement[] {
  const requirements = new Map<string, SourceAuthorizationRequirement>();

  const add = (
    accountId: string,
    scope: AuthorizationScope,
    threshold: ThresholdLevel,
    reason: string,
  ) => {
    const key = `${scope}:${accountId}`;
    const existing = requirements.get(key);
    if (!existing) {
      requirements.set(key, { accountId, scope, threshold, reasons: [reason] });
      return;
    }
    existing.threshold = strongerThreshold(existing.threshold, threshold);
    existing.reasons.push(reason);
  };

  add(transactionSource, 'inner', 'low', 'Transaction source authorization');

  for (const operation of operations) {
    add(
      operation.sourceAccount,
      'inner',
      operation.threshold,
      `Operation ${operation.index + 1}: ${operation.type}`,
    );
  }

  if (feeSource) {
    add(feeSource, 'outer', 'low', 'Fee-bump fee source authorization');
  }

  return [...requirements.values()];
}
