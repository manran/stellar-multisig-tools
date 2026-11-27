import type { AgentAccessLevel } from '../../../../packages/stellar-core/src/agentAccessTypes.js';
import type {
  AgentTaskAction,
  AgentTaskProjection,
} from '../../../../packages/stellar-core/src/agentTaskTypes.js';
import { isClassicExecutionUnresolved, type SigningRequestSnapshot } from '../../../../packages/stellar-core/src/requestTypes.js';
import type { SorobanIntentAuthorizationSnapshot } from './sorobanIntentAuthorizationService.js';
import { successfulSorobanExecution, unresolvedSorobanPreparations } from './sorobanIntentStore.js';
import type {
  StoredSorobanIntent,
  StoredSorobanIntentExecutionObservation,
  StoredSorobanIntentExecutionPreparation,
} from './sorobanIntentStore.js';

const ACCESS_RANK: Record<AgentAccessLevel, number> = { read: 1, write: 2, sign: 3 };
const TASK_OPERATIONS: Record<AgentTaskAction['code'], string> = {
  contribute_signature: 'proposal.contribute', decline: 'proposal.decline',
  contribute_authorization: 'contract.intent.contribute',
  prepare_execution: 'contract.intent.execution.prepare', refresh_execution: 'contract.intent.execution.prepare',
  resume_execution: 'contract.intent.execution.resume', reconcile_execution: 'contract.intent.execution.reconcile', replan: 'contract.intent.replan', cancel: 'contract.intent.cancel',
};

function action(
  code: AgentTaskAction['code'],
  requiredAccess: AgentTaskAction['requiredAccess'],
  credentialAccess: AgentAccessLevel,
): AgentTaskAction {
  return {
    code,
    operationId: TASK_OPERATIONS[code],
    ...(code === 'decline' ? { bodyDefaults: { decision: 'decline' } }
      : code === 'contribute_signature' ? { requiredInputs: ['signedXdr'] }
      : code === 'contribute_authorization' ? { requiredInputs: ['entryIndex', 'signatureBase64'] }
      : { bodyDefaults: { action: code } }),
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
  const signatureRequired = request.status === 'awaiting_signatures' && request.statusReason !== 'quorum_unreachable' && !hasSigned && !declined;

  if (request.status === 'submitted') state = 'completed';
  else if (isClassicExecutionUnresolved(request)) state = 'execution_unknown';
  else if (request.status === 'expired') state = 'expired';
  else if (request.status === 'stale' || request.status === 'blocked') state = 'failed';
  else if (signatureRequired) {
    nextActions = [
      action('contribute_signature', 'sign', credentialAccess),
      action('decline', 'write', credentialAccess),
    ];
    state = nextActions.some((item) => item.available) ? 'action_required' : 'waiting';
  } else {
    state = 'waiting';
    // Reconsideration is optional, not a new demand to sign.
    if (request.status === 'awaiting_signatures' && !hasSigned && (declined || request.statusReason === 'quorum_unreachable')) {
      nextActions = [{ ...action('contribute_signature', 'sign', credentialAccess), reviewRequired: true }];
    }
  }

  return {
    version: 1,
    id: request.id,
    kind: 'classic_transaction',
    network: request.network,
    state,
    signatureRequired,
    nextActions,
    ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
    ...(request.executionOutcome ? { executionOutcome: request.executionOutcome } : {}),
    ...(request.submission ? {
      result: {
        transactionHash: request.submission.transactionHash,
        ledger: request.submission.ledger,
        successful: true,
      },
    } : request.executionOutcome?.outcome === 'failed' ? {
      result: {
        transactionHash: request.executionOutcome.observation.transactionHash,
        ledger: request.executionOutcome.observation.ledger,
        successful: false,
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
    state = 'action_required';
    nextActions = [{ ...action('reconcile_execution', 'write', credentialAccess),
      ...(unresolved.length === 1 ? { bodyDefaults: { action: 'reconcile_execution', transactionHash: unresolved[0].transactionHash } } : { requiredInputs: ['transactionHash'] }) }];
    const pending = unresolved.length === 1 ? unresolved[0] : undefined;
    if (!stored.integration && !stored.cancellation && pending
      && (pending.hasReleasedExecution || pending.releasedExecution)
      && pending.preparedByAddress === principalAddress
      && pending.authorizationPlanRevision === currentRevision(stored)
      && pending.authorizationPlanDigest === stored.authorizationPlan.authorizationPlanDigest
      && authorization.status === 'authorization_ready' && pending.validUntil
      && Date.parse(pending.validUntil) > now.getTime()) {
      nextActions.push({ ...action('resume_execution', 'write', credentialAccess),
        bodyDefaults: { action: 'resume_execution', transactionHash: pending.transactionHash } });
    }

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

  nextActions = nextActions.map(item => item.code === 'prepare_execution' || item.code === 'refresh_execution'
    ? { ...item, requiredInputs: ['executor'] } : item);

  if (canCancel && !unresolved.length && state !== 'completed' && state !== 'cancelled') {
    nextActions = [...nextActions, action('cancel', 'write', credentialAccess)];
  }

  if (!unresolved.length && (preparations.length || observations.length) && !latestObservation?.successful) {
    nextActions = nextActions.map((item) => ['prepare_execution', 'refresh_execution', 'replan'].includes(item.code)
      ? { ...item, reviewRequired: true as const } : item);
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