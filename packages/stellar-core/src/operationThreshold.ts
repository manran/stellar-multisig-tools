import type { ThresholdLevel } from './types.js';

const LOW_THRESHOLD_OPERATIONS = new Set([
  'allowTrust',
  'setTrustLineFlags',
  'bumpSequence',
  'claimClaimableBalance',
  'inflation',
  'extendFootprintTtl',
  'restoreFootprint',
]);

export interface OperationThresholdContext {
  setOptionsChangesAuthorization?: boolean;
}

/**
 * Mirrors stellar-core OperationFrame threshold levels. Operations use medium
 * unless Core explicitly overrides them to low/high. SetOptions is high only
 * when it changes signer/threshold authorization fields.
 */
export function thresholdLevelForOperation(
  operationType: string,
  context: OperationThresholdContext = {},
): ThresholdLevel {
  if (LOW_THRESHOLD_OPERATIONS.has(operationType)) return 'low';
  if (operationType === 'accountMerge') return 'high';
  if (operationType === 'setOptions') {
    return context.setOptionsChangesAuthorization === false ? 'medium' : 'high';
  }
  return 'medium';
}
