import type { InspectedOperation, TransactionXdrInspection } from './transactionXdr.js';

export type TransactionSemanticKind = 'signing_change' | 'payment' | 'batch_payment' | 'multi_party' | 'claimable_payment' | 'single_operation' | 'multi_operation';

export interface PaymentSemanticFacts {
  amount: string;
  asset: string;
  assetCode: string;
  destination: string;
  sourceAccount: string;
}

export interface ClaimablePaymentSemanticFacts {
  amount: string;
  asset: string;
  assetCode: string;
  recipient: string;
  recoveryAccount: string;
  claimWindowSeconds: number;
}

export interface TransactionSemanticProjection {
  kind: TransactionSemanticKind;
  sourceAccount: string;
  operationCount: number;
  primaryOperation: InspectedOperation | null;
  signingAccountId: string | null;
  payment: PaymentSemanticFacts | null;
  payments: PaymentSemanticFacts[];
  claimablePayment: ClaimablePaymentSemanticFacts | null;
  operationTitles: string[];
}

const SIGNING_CONTROL_FIELDS = new Set([
  'Signer weight',
  'Master weight',
  'Medium threshold',
  'High threshold',
]);

function fieldValue(operation: InspectedOperation, label: string): string {
  return operation.fields.find((field) => field.label === label)?.value ?? '';
}

function paymentFacts(operation: InspectedOperation): PaymentSemanticFacts {
  const asset = fieldValue(operation, 'Asset');
  return {
    amount: fieldValue(operation, 'Amount'),
    asset,
    assetCode: asset.split(' · ')[0] || asset,
    destination: fieldValue(operation, 'Destination'),
    sourceAccount: operation.sourceAccount,
  };
}

function claimableFacts(operation: InspectedOperation): ClaimablePaymentSemanticFacts | null {
  const asset = fieldValue(operation, 'Asset');
  const recipient = fieldValue(operation, 'Recipient');
  const recoveryAccount = fieldValue(operation, 'Recovery account');
  const seconds = Number(fieldValue(operation, 'Claim window seconds'));
  if (!recipient || !recoveryAccount || !Number.isSafeInteger(seconds) || seconds <= 0) return null;
  return {
    amount: fieldValue(operation, 'Amount'),
    asset,
    assetCode: asset.split(' · ')[0] || asset,
    recipient,
    recoveryAccount,
    claimWindowSeconds: seconds,
  };
}

function signingChangeAccount(inspection: TransactionXdrInspection): string | null {
  const operations = inspection.operations;
  if (operations.length === 0) return null;
  if (!operations.every((operation) => operation.type === 'setOptions')) return null;

  const sourceAccount = operations[0].sourceAccount;
  if (!sourceAccount || !operations.every((operation) => operation.sourceAccount === sourceAccount)) return null;
  if (!operations.some((operation) => operation.fields.some((field) => SIGNING_CONTROL_FIELDS.has(field.label)))) return null;
  return sourceAccount;
}

function projectionBase(inspection: TransactionXdrInspection) {
  return {
    sourceAccount: inspection.transactionSourceAccount,
    operationCount: inspection.operations.length,
    primaryOperation: inspection.operations.length === 1 ? inspection.operations[0] : null,
    operationTitles: inspection.operations.map((operation) => operation.title),
  };
}

export function projectTransactionSemantics(inspection: TransactionXdrInspection): TransactionSemanticProjection {
  const operations = inspection.operations;
  const primaryOperation = operations.length === 1 ? operations[0] : null;
  const signingAccountId = signingChangeAccount(inspection);
  const base = projectionBase(inspection);

  if (signingAccountId) {
    return { ...base, kind: 'signing_change', signingAccountId, payment: null, payments: [], claimablePayment: null };
  }

  if (primaryOperation?.type === 'payment') {
    const payment = paymentFacts(primaryOperation);
    return { ...base, kind: 'payment', signingAccountId: null, payment, payments: [payment], claimablePayment: null };
  }

  if (primaryOperation?.type === 'createClaimableBalance') {
    const claimablePayment = claimableFacts(primaryOperation);
    if (claimablePayment) {
      return { ...base, kind: 'claimable_payment', signingAccountId: null, payment: null, payments: [], claimablePayment };
    }
  }

  if (operations.length > 1 && operations.every((operation) => operation.type === 'payment')) {
    const payments = operations.map(paymentFacts);
    const authorizingAccounts = new Set([inspection.transactionSourceAccount, ...payments.map((payment) => payment.sourceAccount)]);
    return {
      ...base,
      kind: authorizingAccounts.size > 1 ? 'multi_party' : 'batch_payment',
      signingAccountId: null,
      payment: null,
      payments,
      claimablePayment: null,
    };
  }

  return {
    ...base,
    kind: primaryOperation ? 'single_operation' : 'multi_operation',
    signingAccountId: null,
    payment: null,
    payments: [],
    claimablePayment: null,
  };
}
