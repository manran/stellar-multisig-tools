import type { TransactionXdrInspection } from './transactionXdr.js';

const SIGNING_CONTROL_FIELDS = new Set([
  'Signer weight',
  'Master weight',
  'Medium threshold',
  'High threshold',
]);

export function transactionSystemTypeLabel(inspection: TransactionXdrInspection): string {
  const operations = inspection.operations;
  if (
    operations.length > 0
    && operations.every((operation) => operation.type === 'setOptions')
    && operations.some((operation) => operation.fields.some((field) => SIGNING_CONTROL_FIELDS.has(field.label)))
  ) {
    return 'Account signing change';
  }

  if (operations.length === 1) {
    const operation = operations[0];
    if (operation.type === 'payment') return 'Payment';
    if (operation.type === 'createClaimableBalance') return 'Claimable payment';
    if (operation.type === 'invokeHostFunction') return 'Contract authorization';
    return operation.title;
  }

  if (operations.length > 1 && operations.every((operation) => operation.type === 'payment')) {
    const authorizingAccounts = new Set([
      inspection.transactionSourceAccount,
      ...operations.map((operation) => operation.sourceAccount),
    ]);
    return authorizingAccounts.size > 1 ? 'Multi-party transaction' : 'Batch payment';
  }

  return 'Multi-operation transaction';
}
