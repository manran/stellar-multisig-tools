import type { AgentAccessLevel } from '../../../../src/stellar/agentAccessTypes.js';
import type {
  AgentTaskAction,
  AgentTaskProjection,
} from '../../../../src/stellar/agentTaskTypes.js';
import type { SigningRequestSnapshot } from '../../../../src/stellar/requestTypes.js';
import type { SorobanIntentAuthorizationSnapshot } from './sorobanIntentAuthorizationService.js';
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

  if (request.status === 'submitted') state = 'completed';
  else if (request.status === 'expired') state = 'expired';
  else if (request.status === 'stale' || request.status === 'blocked') state = 'failed';
  else if (request.status === 'awaiting_signatures' && !hasSigned && !declined) {
    state = 'action_required';
    nextActions = [
      action('contribute_signature', 'sign', credentialAccess),
      action('decline', 'write', credentialAccess),
    ];
  } else state = 'waiting';

  return {
    version: 1,
    id: request.id,
    kind: 'classic_transaction',
    network: request.network,
    state,
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
  const latestObservation = latestBy(currentObservations(stored, observations), (item) => item.observedAt);
  const preparationExpired = Boolean(
    latestPreparation?.validUntil
    && Date.parse(latestPreparation.validUntil) <= now.getTime(),
  );
  const needsPrincipalAuthorization = authorization.authorizers.some((authorizer) =>
    !authorizer.ready
    && authorizer.activeSigners.some((signer) => signer.publicKey === principalAddress)
    && !authorizer.signerEvidence.some((signer) => signer.publicKey === principalAddress));

  let state: AgentTaskProjection['state'];
  let nextActions: AgentTaskAction[] = [];
  if (latestObservation?.successful) state = 'completed';
  else if (latestObservation && !latestObservation.successful) state = 'failed';
  else if (authorization.status === 'expired') {
    state = 'action_required';
    nextActions = [action('replan', 'write', credentialAccess)];
  } else if (authorization.status === 'blocked') state = 'failed';
  else if (authorization.status === 'awaiting_authorization') {
    state = needsPrincipalAuthorization ? 'action_required' : 'waiting';
    if (needsPrincipalAuthorization) {
      nextActions = [action('contribute_authorization', 'sign', credentialAccess)];
    }
  } else if (stored.integration) {
    state = 'waiting';
  } else if (!latestPreparation || preparationExpired) {
    state = 'action_required';
    nextActions = [action(
      preparationExpired ? 'refresh_execution' : 'prepare_execution',
      'write',
      credentialAccess,
    )];
  } else state = 'waiting';

  const expiry = earliestExpiry(authorization);
  return {
    version: 1,
    id: stored.id,
    kind: 'soroban_contract',
    network: stored.network,
    state,
    nextActions,
    ...(authorization.status === 'awaiting_authorization' ? { waitingFor: unresolvedAuthorizers(authorization) } : {}),
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