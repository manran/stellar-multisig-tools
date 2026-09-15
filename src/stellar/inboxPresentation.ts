import type { SigningRequestSnapshot, SigningRequestStatus } from './requestTypes.js';
import type { InboxSorobanIntentSnapshot } from './sorobanIntentApiTypes.js';

export type InboxViewerAction =
  | 'sign'
  | 'submit'
  | 'waiting_for_others'
  | 'waiting_preconditions'
  | 'waiting_execution'
  | 'attention'
  | 'declined';

export interface InboxRequestSnapshot extends SigningRequestSnapshot {
  viewerAction: InboxViewerAction;
}

export interface InboxActionCounts {
  actionRequired: number;
  signatureNeeded: number;
  readyToSubmit: number;
  needsAttention: number;
  waiting: number;
  contractAuthorizationNeeded: number;
  readyForExecutionRouting: number;
}


export function projectInboxViewerAction(
  status: SigningRequestStatus,
  options: { hasSigned: boolean; declined?: boolean; externalExecution?: boolean },
): InboxViewerAction {
  if (status === 'ready') return options.externalExecution ? 'waiting_execution' : 'submit';
  if (status === 'waiting_preconditions') return 'waiting_preconditions';
  if (status === 'stale' || status === 'blocked') return 'attention';
  if (status === 'awaiting_signatures') {
    if (options.hasSigned) return 'waiting_for_others';
    if (options.declined) return 'declined';
    return 'sign';
  }
  return 'attention';
}

export function inboxViewerActionNeedsAction(action: InboxViewerAction): boolean {
  return action === 'sign' || action === 'submit' || action === 'attention';
}

export function summarizeInboxActions(
  requests: readonly Pick<InboxRequestSnapshot, 'viewerAction'>[],
  intents: readonly Pick<InboxSorobanIntentSnapshot, 'viewerAction'>[] = [],
): InboxActionCounts {
  const counts: InboxActionCounts = {
    actionRequired: 0,
    signatureNeeded: 0,
    readyToSubmit: 0,
    needsAttention: 0,
    waiting: 0,
    contractAuthorizationNeeded: 0,
    readyForExecutionRouting: 0,
  };

  for (const request of requests) {
    if (inboxViewerActionNeedsAction(request.viewerAction)) counts.actionRequired += 1;
    if (request.viewerAction === 'sign') counts.signatureNeeded += 1;
    else if (request.viewerAction === 'submit') counts.readyToSubmit += 1;
    else if (request.viewerAction === 'attention') counts.needsAttention += 1;
    else counts.waiting += 1;
  }
  for (const intent of intents) {
    if (intent.viewerAction === 'authorize') {
      counts.actionRequired += 1;
      counts.contractAuthorizationNeeded += 1;
    } else if (intent.viewerAction === 'route_execution') {
      counts.actionRequired += 1;
      counts.readyForExecutionRouting += 1;
    } else if (intent.viewerAction === 'attention') {
      counts.actionRequired += 1;
      counts.needsAttention += 1;
    } else {
      counts.waiting += 1;
    }
  }
  return counts;
}

export function inboxViewerActionPresentation(action: InboxViewerAction): {
  label: string;
  detail: string;
  cta: string;
  tone: 'warning' | 'success' | 'danger' | 'neutral';
} {
  switch (action) {
    case 'sign':
      return {
        label: 'Your signature is needed',
        detail: 'Review the transaction before signing.',
        cta: 'Review & sign',
        tone: 'warning',
      };
    case 'submit':
      return {
        label: 'Ready for submission',
        detail: 'Required authorization is complete.',
        cta: 'Review & submit',
        tone: 'success',
      };
    case 'attention':
      return {
        label: 'Needs your attention',
        detail: 'The proposal cannot continue normally until you review the issue.',
        cta: 'Review issue',
        tone: 'danger',
      };
    case 'waiting_execution':
      return {
        label: 'Authorization complete · waiting for execution',
        detail: 'Final execution is owned outside this signer workflow.',
        cta: 'View status',
        tone: 'neutral',
      };
    case 'waiting_preconditions':
      return {
        label: 'Approvals complete · waiting for ledger',
        detail: 'No action is available until the transaction preconditions are satisfied.',
        cta: 'View status',
        tone: 'neutral',
      };
    case 'declined':
      return {
        label: 'You declined · waiting for others',
        detail: 'Your decision is recorded; the proposal remains open for other signers.',
        cta: 'View status',
        tone: 'neutral',
      };
    case 'waiting_for_others':
      return {
        label: 'You signed · waiting for others',
        detail: 'Your signature is already recorded.',
        cta: 'View status',
        tone: 'neutral',
      };
  }
}

export function inboxActionCountPresentations(counts: InboxActionCounts): Array<{
  key: 'contract-auth' | 'execution-route' | 'sign' | 'submit' | 'attention' | 'waiting';
  label: string;
  tone: 'warning' | 'success' | 'danger' | 'neutral';
}> {
  const items: Array<{
    key: 'contract-auth' | 'execution-route' | 'sign' | 'submit' | 'attention' | 'waiting';
    label: string;
    tone: 'warning' | 'success' | 'danger' | 'neutral';
  }> = [];
  if (counts.contractAuthorizationNeeded > 0) items.push({ key: 'contract-auth', label: `${counts.contractAuthorizationNeeded} contract auth`, tone: 'warning' });
  if (counts.readyForExecutionRouting > 0) items.push({ key: 'execution-route', label: `${counts.readyForExecutionRouting} to choose execution`, tone: 'success' });
  if (counts.signatureNeeded > 0) items.push({ key: 'sign', label: `${counts.signatureNeeded} to sign`, tone: 'warning' });
  if (counts.readyToSubmit > 0) items.push({ key: 'submit', label: `${counts.readyToSubmit} to submit`, tone: 'success' });
  if (counts.needsAttention > 0) items.push({ key: 'attention', label: `${counts.needsAttention} need review`, tone: 'danger' });
  if (counts.waiting > 0) items.push({ key: 'waiting', label: `${counts.waiting} waiting`, tone: 'neutral' });
  return items;
}
