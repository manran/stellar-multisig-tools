import type { SigningRequestStatus } from './requestTypes.js';
import type { SorobanIntentAuthorizationSnapshot } from './sorobanIntentApiTypes.js';

export type CoordinationWorkflowPhase =
  | 'authorization'
  | 'ready'
  | 'done'
  | 'attention';

export function requestCoordinationPhase(
  status: SigningRequestStatus,
): CoordinationWorkflowPhase {
  if (status === 'awaiting_signatures') return 'authorization';
  if (status === 'ready' || status === 'waiting_preconditions') return 'ready';
  if (status === 'submitted') return 'done';
  return 'attention';
}

export function sorobanCoordinationPhase(
  status: SorobanIntentAuthorizationSnapshot['status'],
): CoordinationWorkflowPhase {
  if (status === 'awaiting_authorization') return 'authorization';
  if (status === 'authorization_ready') return 'ready';
  return 'attention';
}
