import type { IntegrationSorobanJobProjection } from '../../../../src/stellar/sorobanIntentApiTypes.js';
import type { SorobanIntentAuthorizationSnapshot } from './sorobanIntentAuthorizationService.js';
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
  now = new Date(),
}: {
  stored: StoredSorobanIntent;
  authorization: SorobanIntentAuthorizationSnapshot;
  preparations?: readonly StoredSorobanIntentExecutionPreparation[];
  observations?: readonly StoredSorobanIntentExecutionObservation[];
  reviewUrl: string;
  now?: Date;
}): IntegrationSorobanJobProjection {
  const currentPreps = currentPreparations(stored, preparations);
  const currentResults = currentObservations(stored, observations);
  const latestPreparation = latestBy(currentPreps, (item) => item.preparedAt);
  const latestObservation = latestBy(currentResults, (item) => item.observedAt);
  const managed = stored.executionPolicy?.executor?.source === 'multisigtools_managed';
  const preparationExpired = Boolean(
    latestPreparation?.validUntil
    && Date.parse(latestPreparation.validUntil) <= now.getTime(),
  );
  let state: IntegrationSorobanJobProjection['state'];
  if (latestObservation?.successful) state = 'completed';
  else if (latestObservation && !latestObservation.successful) state = 'failed';
  else if (authorization.status === 'expired') state = 'expired';
  else if (authorization.status === 'blocked') state = 'failed';
  else if (authorization.status === 'awaiting_authorization') state = 'waiting_for_authorization';
  else state = latestPreparation && !preparationExpired ? 'executing' : 'ready';

  const nextActions: IntegrationSorobanJobProjection['nextActions'] = state === 'ready'
    ? preparationExpired ? ['refresh_execution'] : ['prepare_execution']
    : state === 'executing' && !managed
      ? ['submit_execution', 'reconcile_execution', 'refresh_execution']
      : state === 'expired'
        ? ['replan']
        : [];

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
    ...(expiry !== undefined ? { expiresAtLedger: expiry } : {}),
    ...(stored.privateContext?.externalReference ? { externalReference: stored.privateContext.externalReference } : {}),
    ...(authorization.status === 'blocked' ? { reason: 'authorization_blocked' as const } : {}),
    ...(latestObservation && !latestObservation.successful ? { reason: 'execution_failed' as const } : {}),
    ...(latestPreparation ? {
      execution: {
        owner: managed ? 'multisigtools' as const : 'external_service' as const,
        executor: stored.executionPolicy?.executor?.address ?? latestPreparation.executionSource,
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
