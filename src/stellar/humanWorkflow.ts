import type { SigningRequestStatus } from './requestTypes';
import type { SorobanIntentAuthorizationSnapshot } from './sorobanIntentApiTypes';
import { requestCoordinationPhase, sorobanCoordinationPhase } from './coordinationWorkflow';

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
    case 'awaiting_signatures': return { label: 'Collecting signatures', tone: 'warning' };
    case 'waiting_preconditions': return { label: 'Authorization complete · waiting', tone: 'warning' };
    case 'ready': return { label: 'Authorization complete', tone: 'success' };
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
  const phase = requestCoordinationPhase(status);
  if (phase === 'done') return 'done';
  if (phase === 'ready') return 'submit';
  if (phase === 'attention' && signaturesComplete) return 'submit';
  return 'sign';
}

export function proposalWorkflowStage(
  status: SigningRequestStatus,
  options: { reviewComplete: boolean; signaturesComplete?: boolean },
): HumanWorkflowStage {
  if (!options.reviewComplete) return 'review';
  return requestWorkflowStage(status, options.signaturesComplete ?? false);
}

export function sorobanAuthorizationStatusPresentation(
  status: SorobanIntentAuthorizationSnapshot['status'],
): HumanStatusPresentation {
  switch (status) {
    case 'awaiting_authorization': return { label: 'Collecting contract authorization', tone: 'warning' };
    case 'authorization_ready': return { label: 'Contract authorization complete', tone: 'success' };
    case 'expired': return { label: 'Authorization expired', tone: 'danger' };
    case 'blocked': return { label: 'Authorization blocked', tone: 'danger' };
  }
}

export function sorobanIntentWorkflowStage(
  status: SorobanIntentAuthorizationSnapshot['status'],
): HumanWorkflowStage {
  return sorobanCoordinationPhase(status) === 'ready' ? 'submit' : 'sign';
}
