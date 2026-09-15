import type { SigningRequestStatus } from './requestTypes';
import type { SorobanIntentAuthorizationSnapshot } from './sorobanIntentApiTypes';

export const HUMAN_WORKFLOW_STEPS = [
  { key: 'prepare', number: 1, label: 'Prepare' },
  { key: 'review', number: 2, label: 'Review' },
  { key: 'sign', number: 3, label: 'Sign' },
  { key: 'submit', number: 4, label: 'Submit' },
  { key: 'done', number: 5, label: 'Done' },
] as const;

export type HumanWorkflowStage = typeof HUMAN_WORKFLOW_STEPS[number]['key'];
export type HumanStatusTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface HumanStatusPresentation {
  label: string;
  tone: HumanStatusTone;
}

export function requestStatusPresentation(status: SigningRequestStatus): HumanStatusPresentation {
  switch (status) {
    case 'awaiting_signatures': return { label: 'Signature needed', tone: 'warning' };
    case 'waiting_preconditions': return { label: 'Waiting', tone: 'warning' };
    case 'ready': return { label: 'Ready to submit', tone: 'success' };
    case 'submitted': return { label: 'Done', tone: 'success' };
    case 'expired': return { label: 'Expired', tone: 'neutral' };
    case 'stale':
    case 'blocked': return { label: 'Needs attention', tone: 'danger' };
  }
}

export function requestWorkflowStage(
  status: SigningRequestStatus,
  signaturesComplete = false,
): HumanWorkflowStage {
  if (status === 'submitted') return 'done';
  if (status === 'ready' || status === 'waiting_preconditions') return 'submit';
  if ((status === 'stale' || status === 'blocked' || status === 'expired') && signaturesComplete) return 'submit';
  return 'sign';
}

export function proposalWorkflowStage(
  status: SigningRequestStatus,
  options: { reviewComplete: boolean; signaturesComplete?: boolean },
): HumanWorkflowStage {
  if (!options.reviewComplete) return 'review';
  return requestWorkflowStage(status, options.signaturesComplete ?? false);
}

export function sorobanIntentWorkflowStage(
  status: SorobanIntentAuthorizationSnapshot['status'],
): HumanWorkflowStage {
  return status === 'authorization_ready' ? 'submit' : 'sign';
}
