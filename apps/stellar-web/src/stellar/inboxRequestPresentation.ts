import type { SigningRequestSnapshot } from '../../../../packages/stellar-core/src/requestTypes.js';
import { projectTransactionSemantics } from './transactionSemantics.js';
import { transactionSystemTypeLabel } from '../../../../packages/stellar-core/src/transactionPresentation.js';
import { inspectTransactionXdr } from '../../../../packages/stellar-core/src/transactionXdr.js';
import type { TransactionXdrInspection } from '../../../../packages/stellar-core/src/transactionXdr.js';

export interface InboxRequestDescription {
  title: string;
  summary: string;
  systemType: string;
  source: string;
  inspection: TransactionXdrInspection;
}

export function describeInboxRequest(request: SigningRequestSnapshot): InboxRequestDescription {
  const inspection = inspectTransactionXdr(request.mergedXdr, request.network);
  const semantics = projectTransactionSemantics(inspection);
  const systemType = transactionSystemTypeLabel(inspection);
  const businessLabel = request.template?.name?.trim();

  const present = (title: string, summary: string): InboxRequestDescription => ({
    title: businessLabel || title,
    summary: businessLabel ? systemType : summary,
    systemType,
    source: semantics.sourceAccount,
    inspection,
  });

  if (semantics.kind === 'signing_change') {
    return present(
      'Change account signing',
      'Update who can sign and how many approvals this account requires.',
    );
  }
  if (semantics.kind === 'payment' && semantics.primaryOperation) {
    return present(semantics.primaryOperation.summary, 'Payment');
  }
  if (semantics.kind === 'batch_payment') {
    return present(
      `Payment · ${semantics.payments.length} recipients`,
      semantics.payments.slice(0, 2).map((payment) => `${payment.amount} ${payment.assetCode}`).join(' · '),
    );
  }
  if (semantics.kind === 'multi_party') {
    const parties = new Set(semantics.payments.map((payment) => payment.sourceAccount)).size;
    return present(
      `Multi-party transaction · ${parties} source accounts`,
      `${semantics.payments.length} atomic payments`,
    );
  }
  if (semantics.kind === 'claimable_payment' && semantics.claimablePayment) {
    return present(
      `${semantics.claimablePayment.amount} ${semantics.claimablePayment.assetCode} to claim later`,
      'Claimable payment with recovery path',
    );
  }
  if (semantics.kind === 'single_operation' && semantics.primaryOperation) {
    return present(semantics.primaryOperation.title, semantics.primaryOperation.summary);
  }
  return present(
    `${semantics.operationCount} changes in one transaction`,
    semantics.operationTitles.slice(0, 2).join(' · '),
  );
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
