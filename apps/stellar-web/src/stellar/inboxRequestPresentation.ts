import { displayAmount } from './displayFormat.js';
import type { InboxRequestSnapshot } from '../../../../packages/stellar-core/src/inboxPresentation.js';
import type { SigningRequestSnapshot, SigningRequestStatus, SigningRequestStatusReason } from '../../../../packages/stellar-core/src/requestTypes.js';
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

function conciseRecipient(address: string): string {
  return address.length > 22 ? `${address.slice(0, 10)}…${address.slice(-8)}` : address;
}

export function describeInboxRequest(request: SigningRequestSnapshot): InboxRequestDescription {
  const inspection = inspectTransactionXdr(request.mergedXdr, request.network);
  const semantics = projectTransactionSemantics(inspection);
  const systemType = transactionSystemTypeLabel(inspection);
  const businessLabel = request.template?.name?.trim();

  const present = (title: string, summary: string): InboxRequestDescription => ({
    title: businessLabel || title,
    // The business label cannot obscure the amount being authorized.
    // This amount is inspected from the XDR, not taken from a template.
    summary: businessLabel && semantics.kind === 'payment' && semantics.payment
      ? displayAmount(semantics.payment.amount) + ' ' + semantics.payment.assetCode + ' · ' + systemType
      : summary,
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
  if (semantics.kind === 'payment' && semantics.primaryOperation && semantics.payment) {
    const payment = semantics.payment;
    const title = payment.amount && payment.assetCode
      ? `Send ${displayAmount(payment.amount)} ${payment.assetCode}`
      : semantics.primaryOperation.summary;
    return present(title, payment.destination ? `To ${conciseRecipient(payment.destination)}` : 'Payment');
  }
  if (semantics.kind === 'batch_payment') {
    return present(
      `Payment · ${semantics.payments.length} recipients`,
      semantics.payments.slice(0, 2).map((payment) => `${displayAmount(payment.amount)} ${payment.assetCode}`).join(' · '),
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
      `${displayAmount(semantics.claimablePayment.amount)} ${semantics.claimablePayment.assetCode} to claim later`,
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



export interface ProposalNextStep {
  heading: 'Next step' | 'Current status';
  title: string;
  detail: string;
  action: { label: string; target: 'review' | 'signatures' | 'submission' | 'issue' | 'receipt' };
}

export function proposalNextStep(
  status: SigningRequestStatus,
  options: {
    reviewComplete: boolean;
    walletAlreadySigned: boolean;
    isCreator?: boolean;
    canCoordinate?: boolean;
    walletSigningState?: 'can_sign' | 'other_signer' | 'unknown' | 'signed' | 'needs_review';
    executionMode?: 'multisigtools' | 'external';
    executionRoutedToMst: boolean;
    statusReason?: SigningRequestStatusReason;
  },
): ProposalNextStep {
  if (status === 'submitted') {
    return { heading: 'Current status', title: 'Confirmed on Stellar', detail: 'The transaction is complete. Its receipt contains the ledger result.', action: { label: 'Open transaction receipt', target: 'receipt' } };
  }
  if (status === 'expired') {
    return {
      heading: 'Current status',
      title: 'This proposal has expired',
      detail: options.statusReason === 'transaction_expired'
        ? 'The Stellar transaction time limit has passed. Review the details before preparing a replacement.'
        : 'Signing in MultiSigTools has closed. An exported transaction may still be valid. Check its network record before preparing a replacement.',
      action: { label: 'Review the issue', target: 'issue' },
    };
  }
  if (status === 'stale' || status === 'blocked') {
    return { heading: 'Current status', title: 'This proposal needs review', detail: 'The transaction cannot continue as prepared. Review the reason before taking another action.', action: { label: 'Review the issue', target: 'issue' } };
  }
  if (status === 'waiting_preconditions') {
    return { heading: 'Current status', title: 'Waiting for ledger conditions', detail: 'The required signatures are present. Submission must wait for the transaction conditions.', action: { label: 'View waiting conditions', target: 'issue' } };
  }
  if (!options.reviewComplete) {
    return { heading: 'Next step', title: 'Review this transaction', detail: 'Check the affected accounts, recipients, and changes before continuing to signatures.', action: { label: 'Review transaction', target: 'review' } };
  }
  if (status === 'ready') {
    if (options.executionMode === 'external') {
      return { heading: 'Current status', title: 'Waiting for the originating service', detail: 'Authorization is complete. The originating service owns the final submission.', action: { label: 'View submission details', target: 'submission' } };
    }
    if (options.executionRoutedToMst) {
      return { heading: 'Next step', title: 'Review and submit', detail: 'All required signatures are present. Review the final effects before submitting.', action: { label: 'View submission details', target: 'submission' } };
    }
    return {
      heading: 'Next step',
      title: 'Ready to submit',
      detail: options.walletAlreadySigned
        ? 'Your signature is recorded. All required signatures are in, but this transaction has not been submitted. Choose how to submit it.'
        : 'All required signatures are in, but this transaction has not been submitted. Choose how to submit it.',
      action: { label: 'View submission options', target: 'submission' },
    };
  }
  if (options.walletSigningState === 'needs_review') {
    return { heading: 'Current status', title: 'Signing details need review', detail: 'Stellar Core cannot use the current signatures as prepared. Check the authorization evidence before collecting more.', action: { label: 'Review signing details', target: 'signatures' } };
  }
  if (options.walletAlreadySigned) {
    if (options.isCreator && options.canCoordinate) {
      return {
        heading: 'Next step',
        title: 'Your signature is recorded',
        detail: 'More authorized signatures are needed. Invite an eligible signer, or remind someone you already asked.',
        action: { label: 'Invite or remind signers', target: 'signatures' },
      };
    }
    return {
      heading: 'Current status',
      title: 'Your signature is recorded',
      detail: 'Your part is done for now. Other authorized signers must approve before this transaction can be submitted.',
      action: { label: 'View signing progress', target: 'signatures' },
    };
  }
  if (options.walletSigningState === 'can_sign') {
    return { heading: 'Next step', title: 'Your signature is needed', detail: 'This wallet is an eligible signer. Review the signing requirements before approving. Signing does not submit the transaction.', action: { label: 'Review and sign', target: 'signatures' } };
  }
  if (options.walletSigningState === 'other_signer') {
    return { heading: 'Current status', title: 'Waiting for an authorized signer', detail: 'This wallet cannot sign the remaining requirements. Check the signing progress or ask an eligible signer.', action: { label: 'View signing progress', target: 'signatures' } };
  }
  return { heading: 'Next step', title: 'Collect the required signatures', detail: 'An eligible signer can review and sign with their wallet. Signing does not submit the transaction.', action: { label: 'View signers', target: 'signatures' } };
}

export interface InboxOutgoingSignerProgress {
  signerAddress: string;
  askedAt: string;
  viewedAt?: string;
  notification?: {
    label: string;
    tone: 'neutral' | 'success' | 'danger';
    occurredAt: string;
  };
}

function laterEvent<T extends { occurredAt: string; eventId: string }>(left: T | undefined, right: T): T {
  if (!left) return right;
  return right.occurredAt > left.occurredAt
    || (right.occurredAt === left.occurredAt && right.eventId > left.eventId)
    ? right
    : left;
}

export function inboxOutgoingSignerProgress(
  request: Pick<InboxRequestSnapshot, 'coordinationEvents'>,
  viewerAddress: string,
): InboxOutgoingSignerProgress[] {
  const events = request.coordinationEvents ?? [];
  const asks = new Map<string, { occurredAt: string; eventId: string }>();

  for (const event of events) {
    if (event.type !== 'signer_requested' || event.actorAddress !== viewerAddress) continue;
    const current = asks.get(event.subjectAddress);
    asks.set(event.subjectAddress, laterEvent(current, event));
  }

  const progress: InboxOutgoingSignerProgress[] = [];
  for (const [signerAddress, ask] of asks) {
    let viewed: { occurredAt: string; eventId: string } | undefined;
    let notification: typeof events[number] | undefined;
    for (const event of events) {
      if (event.subjectAddress !== signerAddress) continue;
      if (event.type === 'proposal_viewed') viewed = laterEvent(viewed, event);
      if (
        event.actorAddress === viewerAddress
        && (
          event.type === 'notification_accepted'
          || event.type === 'notification_delivered'
          || event.type === 'notification_bounced'
          || event.type === 'notification_failed'
        )
      ) {
        notification = laterEvent(notification, event);
      }
    }

    const channel = notification?.notificationKind === 'signature_reminder' ? 'Reminder' : 'Email';
    const notificationPresentation = notification
      ? notification.type === 'notification_delivered'
        ? { label: `${channel} delivered`, tone: 'success' as const, occurredAt: notification.occurredAt }
        : notification.type === 'notification_accepted'
          ? { label: `${channel} accepted`, tone: 'neutral' as const, occurredAt: notification.occurredAt }
          : notification.type === 'notification_bounced'
            ? { label: `${channel} bounced`, tone: 'danger' as const, occurredAt: notification.occurredAt }
            : { label: `${channel} failed`, tone: 'danger' as const, occurredAt: notification.occurredAt }
      : undefined;

    progress.push({
      signerAddress,
      askedAt: ask.occurredAt,
      ...(viewed ? { viewedAt: viewed.occurredAt } : {}),
      ...(notificationPresentation ? { notification: notificationPresentation } : {}),
    });
  }

  return progress.sort((left, right) =>
    right.askedAt.localeCompare(left.askedAt) || left.signerAddress.localeCompare(right.signerAddress));
}
