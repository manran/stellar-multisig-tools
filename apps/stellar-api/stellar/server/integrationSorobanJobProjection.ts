import type { IntegrationSorobanJobProjection } from '../../../../packages/stellar-core/src/sorobanIntentApiTypes.js';
import type { SorobanIntentAuthorizationSnapshot } from './sorobanIntentAuthorizationService.js';
import { successfulSorobanExecution, unresolvedSorobanPreparations } from './sorobanIntentStore.js';
import type {
  StoredSorobanIntent,
  StoredSorobanIntentExecutionObservation,
  StoredSorobanIntentExecutionPreparation,
} from './sorobanIntentStore.js';

function currentRevision(stored: StoredSorobanIntent): number {
  return stored.authorizationPlanRevision ?? 1;
}

function latestBy<T>(items: readonly T[], timestamp: (item: T) => string): T | undefined {
  return [...items].sort((left, right) => timestamp(right).localeCompare(timestamp(left)))[0];
}

function currentPreparations(
  stored: StoredSorobanIntent,
  preparations: readonly StoredSorobanIntentExecutionPreparation[],
) {
  const revision = currentRevision(stored);
  return preparations.filter((item) =>
    item.authorizationPlanRevision === revision
    && item.authorizationPlanDigest === stored.authorizationPlan.authorizationPlanDigest);
}

function currentObservations(
  stored: StoredSorobanIntent,
  observations: readonly StoredSorobanIntentExecutionObservation[],
) {
  const revision = currentRevision(stored);
  return observations.filter((item) =>
    item.authorizationPlanRevision === revision
    && item.authorizationPlanDigest === stored.authorizationPlan.authorizationPlanDigest);
}
function waitingFor(authorization: SorobanIntentAuthorizationSnapshot): string[] {
  return [...new Set(
    authorization.authorizers
      .filter((item) => !item.ready)
      .map((item) => item.authorizer),
  )].sort();
}

function expiresAtLedger(authorization: SorobanIntentAuthorizationSnapshot): number | undefined {
  const expirations = authorization.authorizers
    .map((item) => item.expirationLedger)
    .filter((value) => Number.isInteger(value) && value > 0);
  return expirations.length > 0 ? Math.min(...expirations) : undefined;
}

export function projectIntegrationSorobanJob({
  stored,
  authorization,
  preparations = [],
  observations = [],
  reviewUrl,
  executionAvailable = true,
  now = new Date(),
}: {
  stored: StoredSorobanIntent;
  authorization: SorobanIntentAuthorizationSnapshot;
  preparations?: readonly StoredSorobanIntentExecutionPreparation[];
  observations?: readonly StoredSorobanIntentExecutionObservation[];
  reviewUrl: string;
  executionAvailable?: boolean;
  now?: Date;
}): IntegrationSorobanJobProjection {
  const currentPreps = currentPreparations(stored, preparations);
  const currentResults = currentObservations(stored, observations);
  const latestObservation = successfulSorobanExecution(observations) ?? latestBy(currentResults, (item) => item.observedAt);
  const unresolved = unresolvedSorobanPreparations(preparations, observations);
  const latestPreparation = latestObservation?.successful
    ? latestBy(preparations.filter((item) => item.transactionHash === latestObservation.transactionHash), (item) => item.preparedAt)
    : latestBy(unresolved, (item) => item.preparedAt) ?? latestBy(currentPreps, (item) => item.preparedAt);
  const managed = stored.executionPolicy?.executor?.source === 'multisigtools_managed';
  const preparationExpired = !latestPreparation?.validUntil || !(Date.parse(latestPreparation.validUntil) > now.getTime());
  const currentUnresolvedPackage = unresolved.length === 1
    && latestPreparation?.authorizationPlanRevision === currentRevision(stored)
    && latestPreparation.authorizationPlanDigest === stored.authorizationPlan.authorizationPlanDigest;
  let state: IntegrationSorobanJobProjection['state'];
  if (latestObservation?.successful) state = 'completed';
  else if (stored.cancellation || authorization.status === 'cancelled') state = 'cancelled';
  else if (unresolved.length) state = preparationExpired || !currentUnresolvedPackage || authorization.status !== 'authorization_ready' ? 'execution_unknown' : 'executing';
  else if (authorization.status === 'expired') state = 'expired';
  else if (authorization.status === 'blocked') state = 'failed';
  else if (authorization.status === 'awaiting_authorization') state = 'waiting_for_authorization';
  else state = latestObservation && !latestObservation.successful ? 'failed' : 'ready';

  const executionBlocked = !executionAvailable && ['ready', 'waiting_for_authorization', 'expired', 'executing', 'execution_unknown', 'failed'].includes(state);
  const canSubmit = executionAvailable && !managed && state === 'executing' && unresolved.length === 1
    && latestPreparation?.authorizationPlanRevision === currentRevision(stored)
    && latestPreparation.authorizationPlanDigest === stored.authorizationPlan.authorizationPlanDigest;
  const nextActions: IntegrationSorobanJobProjection['nextActions'] = state === 'completed' ? []
    : unresolved.length ? [...(canSubmit ? ['submit_execution' as const] : []), 'reconcile_execution', ...(state === 'cancelled' ? [] : ['cancel' as const])]
    : state === 'cancelled' ? []
    : executionBlocked ? ['cancel']
    : state === 'ready' || (state === 'failed' && authorization.status === 'authorization_ready')
      ? [latestPreparation ? 'refresh_execution' : 'prepare_execution', 'cancel']
      : state === 'expired' ? ['replan', 'cancel']
      : ['cancel'];

  const expiry = expiresAtLedger(authorization);
  return {
    version: 1,
    id: stored.id,
    kind: 'soroban_contract',
    network: stored.network,
    state,
    nextActions,
    reviewUrl,
    ...(state === 'waiting_for_authorization' ? { waitingFor: waitingFor(authorization) } : {}),
    ...(state !== 'completed' && unresolved.length ? { unresolvedTransactionHashes: unresolved.map((item) => item.transactionHash) } : {}),
    ...(expiry !== undefined ? { expiresAtLedger: expiry } : {}),
    ...(stored.privateContext?.externalReference ? { externalReference: stored.privateContext.externalReference } : {}),
    ...(executionBlocked ? { reason: 'execution_unavailable' as const } : {}),
    ...(authorization.status === 'blocked' ? { reason: 'authorization_blocked' as const } : {}),
    ...(state !== 'completed' && unresolved.length ? { reason: 'execution_outcome_unknown' as const } : {}),
    ...(state === 'failed' && latestObservation && !latestObservation.successful ? { reason: 'execution_failed' as const } : {}),
    ...(latestPreparation ? {
      execution: {
        owner: managed ? 'multisigtools' as const : 'external_service' as const,
        executor: latestPreparation.executionSource,
        transactionHash: latestPreparation.transactionHash,
        preparedAt: latestPreparation.preparedAt,
        validUntil: latestPreparation.validUntil,
      },
    } : {}),
    ...(latestObservation ? {
      result: {
        transactionHash: latestObservation.transactionHash,
        ledger: latestObservation.ledger,
        successful: latestObservation.successful,
      },
    } : {}),
  };
}
