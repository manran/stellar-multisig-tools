import type { AgentAccessLevel } from '../../../../packages/stellar-core/src/agentAccessTypes.js';
import type {
  AgentTaskAction,
  AgentTaskProjection,
} from '../../../../packages/stellar-core/src/agentTaskTypes.js';
import type { SigningRequestSnapshot } from '../../../../packages/stellar-core/src/requestTypes.js';
import type { SorobanIntentAuthorizationSnapshot } from './sorobanIntentAuthorizationService.js';
import { successfulSorobanExecution, unresolvedSorobanPreparations } from './sorobanIntentStore.js';
import type {
  StoredSorobanIntent,
  StoredSorobanIntentExecutionObservation,
  StoredSorobanIntentExecutionPreparation,
} from './sorobanIntentStore.js';

const ACCESS_RANK: Record<AgentAccessLevel, number> = { read: 1, write: 2, sign: 3 };

function action(
  code: AgentTaskAction['code'],
  requiredAccess: AgentTaskAction['requiredAccess'],
  credentialAccess: AgentAccessLevel,
): AgentTaskAction {
  return {
    code,
    requiredAccess,
    available: ACCESS_RANK[credentialAccess] >= ACCESS_RANK[requiredAccess],
  };
}

export function projectClassicAgentTask({
  request,
  credentialAccess,
  hasSigned,
  declined = false,
}: {
  request: SigningRequestSnapshot;
  credentialAccess: AgentAccessLevel;
  hasSigned: boolean;
  declined?: boolean;
}): AgentTaskProjection {
  let state: AgentTaskProjection['state'];
  let nextActions: AgentTaskAction[] = [];
  const signatureRequired = request.status === 'awaiting_signatures' && !hasSigned && !declined;

  if (request.status === 'submitted') state = 'completed';
  else if (request.status === 'expired') state = 'expired';
  else if (request.status === 'stale' || request.status === 'blocked') state = 'failed';
  else if (signatureRequired) {
    nextActions = [
      action('contribute_signature', 'sign', credentialAccess),
      action('decline', 'write', credentialAccess),
    ];
    state = nextActions.some((item) => item.available) ? 'action_required' : 'waiting';
  } else state = 'waiting';

  return {
    version: 1,
    id: request.id,
    kind: 'classic_transaction',
    network: request.network,
    state,
    signatureRequired,
    nextActions,
    ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
    ...(request.submission ? {
      result: {
        transactionHash: request.submission.transactionHash,
        ledger: request.submission.ledger,
        successful: true,
      },
    } : {}),
  };
}

function currentRevision(stored: StoredSorobanIntent): number {
  return stored.authorizationPlanRevision ?? 1;
}
function currentPreparations(
  stored: StoredSorobanIntent,
  values: readonly StoredSorobanIntentExecutionPreparation[],
) {
  const revision = currentRevision(stored);
  return values.filter((item) =>
    item.authorizationPlanDigest === stored.authorizationPlan.authorizationPlanDigest
    && item.authorizationPlanRevision === revision);
}

function currentObservations(
  stored: StoredSorobanIntent,
  values: readonly StoredSorobanIntentExecutionObservation[],
) {
  const revision = currentRevision(stored);
  return values.filter((item) =>
    item.authorizationPlanDigest === stored.authorizationPlan.authorizationPlanDigest
    && item.authorizationPlanRevision === revision);
}

function latestBy<T>(values: readonly T[], timestamp: (value: T) => string): T | undefined {
  return [...values].sort((left, right) => timestamp(left).localeCompare(timestamp(right)))[values.length - 1];
}

function unresolvedAuthorizers(authorization: SorobanIntentAuthorizationSnapshot): string[] {
  return [...new Set(
    authorization.authorizers.filter((item) => !item.ready).map((item) => item.authorizer),
  )].sort();
}

function earliestExpiry(authorization: SorobanIntentAuthorizationSnapshot): number | undefined {
  const values = authorization.authorizers
    .map((item) => item.expirationLedger)
    .filter((value) => Number.isInteger(value) && value > 0);
  return values.length > 0 ? Math.min(...values) : undefined;
}

export function projectSorobanAgentTask({
  stored,
  authorization,
  credentialAccess,
  principalAddress,
  preparations = [],
  observations = [],
  now = new Date(),
}: {
  stored: StoredSorobanIntent;
  authorization: SorobanIntentAuthorizationSnapshot;
  credentialAccess: AgentAccessLevel;
  principalAddress: string;
  preparations?: readonly StoredSorobanIntentExecutionPreparation[];
  observations?: readonly StoredSorobanIntentExecutionObservation[];
  now?: Date;
}): AgentTaskProjection {
  const latestPreparation = latestBy(currentPreparations(stored, preparations), (item) => item.preparedAt);
  const latestObservation = successfulSorobanExecution(observations)
    ?? latestBy(currentObservations(stored, observations), (item) => item.observedAt);
  const unresolved = unresolvedSorobanPreparations(preparations, observations);
  const canCancel = !stored.integration && stored.creatorAddress === principalAddress;
  const needsPrincipalAuthorization = authorization.authorizers.some((authorizer) =>
    !authorizer.ready
    && authorizer.activeSigners.some((signer) => signer.publicKey === principalAddress)
    && !authorizer.signerEvidence.some((signer) => signer.publicKey === principalAddress));

  let state: AgentTaskProjection['state'];
  let nextActions: AgentTaskAction[] = [];
  if (latestObservation?.successful) state = 'completed';
  else if (unresolved.length) {
    state = stored.cancellation ? 'cancelled' : 'action_required';
    nextActions = [action('reconcile_execution', 'write', credentialAccess)];
  }
  else if (stored.cancellation || authorization.status === 'cancelled') state = 'cancelled';
  else if (authorization.status === 'expired') {
    state = 'expired';
    if (!stored.integration) {
      state = 'action_required';
      nextActions = [action('replan', 'write', credentialAccess)];
    }
  } else if (authorization.status === 'blocked') state = 'failed';
  else if (authorization.status === 'awaiting_authorization') {
    state = needsPrincipalAuthorization ? 'action_required' : 'waiting';
    if (needsPrincipalAuthorization) {
      nextActions = [action('contribute_authorization', 'sign', credentialAccess)];
    }
  } else if (stored.integration) {
    state = 'waiting';
  } else {
    state = 'action_required';
    nextActions = [action(
      latestPreparation ? 'refresh_execution' : 'prepare_execution',
      'write',
      credentialAccess,
    )];
  }

  if (canCancel && state !== 'completed' && state !== 'cancelled') {
    nextActions = [...nextActions, action('cancel', 'write', credentialAccess)];
  }

  const signatureRequired = state === 'action_required' && !unresolved.length
    && authorization.status === 'awaiting_authorization' && needsPrincipalAuthorization;
  const hasAvailableAction = nextActions.some((item) => item.available);
  if (state === 'action_required' && !hasAvailableAction) state = 'waiting';
  else if (state === 'waiting' && hasAvailableAction) state = 'action_required';

  const expiry = earliestExpiry(authorization);
  return {
    version: 1,
    id: stored.id,
    kind: 'soroban_contract',
    network: stored.network,
    state,
    signatureRequired,
    nextActions,
    ...(state !== 'completed' && unresolved.length ? { unresolvedTransactionHashes: unresolved.map((item) => item.transactionHash) } : {}),
    ...(state !== 'completed' && !unresolved.length && authorization.status === 'awaiting_authorization' ? { waitingFor: unresolvedAuthorizers(authorization) } : {}),
    ...(expiry !== undefined ? { expiresAtLedger: expiry } : {}),
    ...(latestObservation ? {
      result: {
        transactionHash: latestObservation.transactionHash,
        ledger: latestObservation.ledger,
        successful: latestObservation.successful,
      },
    } : {}),
  };
}