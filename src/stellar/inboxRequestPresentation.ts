import type { SigningRequestSnapshot } from '../../packages/stellar-core/src/requestTypes.js';
import { projectTransactionSemantics } from './transactionSemantics.js';
import { inspectTransactionXdr } from '../../packages/stellar-core/src/transactionXdr.js';
import type { TransactionXdrInspection } from '../../packages/stellar-core/src/transactionXdr.js';

export interface InboxRequestDescription {
  title: string;
  summary: string;
  source: string;
  inspection: TransactionXdrInspection;
}

export function describeInboxRequest(request: SigningRequestSnapshot): InboxRequestDescription {
  const inspection = inspectTransactionXdr(request.mergedXdr, request.network);
  const semantics = projectTransactionSemantics(inspection);

  if (semantics.kind === 'signing_change') {
    return {
      title: 'Change account signing',
      summary: 'Update who can sign and how many approvals this account requires.',
      source: semantics.sourceAccount,
      inspection,
    };
  }
  if (semantics.kind === 'payment' && semantics.primaryOperation) {
    return {
      title: semantics.primaryOperation.summary,
      summary: 'Payment',
      source: semantics.sourceAccount,
      inspection,
    };
  }
  if (semantics.kind === 'batch_payment') {
    return {
      title: `Payment · ${semantics.payments.length} recipients`,
      summary: semantics.payments.slice(0, 2).map((payment) => `${payment.amount} ${payment.assetCode}`).join(' · '),
      source: semantics.sourceAccount,
      inspection,
    };
  }
  if (semantics.kind === 'multi_party') {
    const parties = new Set(semantics.payments.map((payment) => payment.sourceAccount)).size;
    return {
      title: `Multi-party transaction · ${parties} source accounts`,
      summary: `${semantics.payments.length} atomic payments`,
      source: semantics.sourceAccount,
      inspection,
    };
  }
  if (semantics.kind === 'claimable_payment' && semantics.claimablePayment) {
    return {
      title: `${semantics.claimablePayment.amount} ${semantics.claimablePayment.assetCode} to claim later`,
      summary: 'Claimable payment with recovery path',
      source: semantics.sourceAccount,
      inspection,
    };
  }
  if (semantics.kind === 'single_operation' && semantics.primaryOperation) {
    return {
      title: semantics.primaryOperation.title,
      summary: semantics.primaryOperation.summary,
      source: semantics.sourceAccount,
      inspection,
    };
  }
  return {
    title: `${semantics.operationCount} changes in one transaction`,
    summary: semantics.operationTitles.slice(0, 2).join(' · '),
    source: semantics.sourceAccount,
    inspection,
  };
}

export function inboxDeadlineLabel(inspection: TransactionXdrInspection) {
  const maxTime = inspection.timeBounds?.maxTime;
  if (!maxTime || maxTime === '0') return 'No deadline';
  const deadline = Number(maxTime) * 1000;
  if (!Number.isFinite(deadline)) return '';
  const remaining = deadline - Date.now();
  if (remaining <= 0) return 'Expired';
  const hours = remaining / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.ceil(remaining / 60_000))}m left`;
  if (hours < 24) return `${Math.ceil(hours)}h left`;
  if (hours < 48) return 'Tomorrow';
  return new Date(deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
