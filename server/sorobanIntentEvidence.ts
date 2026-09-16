import type { SorobanIntentEvidenceEvent } from '../src/stellar/sorobanIntentApiTypes.js';
import type {
  StoredSorobanIntent,
  StoredSorobanIntentAuthorizationContribution,
  StoredSorobanIntentExecutionObservation,
  StoredSorobanIntentExecutionPreparation,
} from './sorobanIntentStore.js';

function currentRevision(stored: StoredSorobanIntent): number {
  return stored.authorizationPlanRevision ?? 1;
}

function planHistory(stored: StoredSorobanIntent) {
  return [...(stored.authorizationPlanHistory ?? [])]
    .sort((a, b) => a.revision - b.revision);
}

function initialPlan(stored: StoredSorobanIntent): { digest: string; revision: number } {
  const first = planHistory(stored)[0];
  return first
    ? { digest: first.authorizationPlan.authorizationPlanDigest, revision: first.revision }
    : { digest: stored.authorizationPlan.authorizationPlanDigest, revision: currentRevision(stored) };
}

export function projectSorobanIntentEvidence(
  stored: StoredSorobanIntent,
  contributions: readonly StoredSorobanIntentAuthorizationContribution[],
  preparations: readonly StoredSorobanIntentExecutionPreparation[] = [],
  observations: readonly StoredSorobanIntentExecutionObservation[] = [],
): SorobanIntentEvidenceEvent[] {
  const initial = initialPlan(stored);
  const events: SorobanIntentEvidenceEvent[] = [{
    version: 1,
    eventId: 'intent-created',
    type: 'intent_created',
    occurredAt: stored.createdAt,
    ...(stored.creatorAddress ? { actorAddress: stored.creatorAddress } : {}),
    ...(stored.creatorActor ? { actor: stored.creatorActor } : {}),
    authorizationPlanDigest: initial.digest,
    authorizationPlanRevision: initial.revision,
  }];

  const history = planHistory(stored);
  for (let index = 0; index < history.length; index += 1) {
    const previous = history[index];
    const next = history[index + 1];
    const nextDigest = next?.authorizationPlan.authorizationPlanDigest
      ?? stored.authorizationPlan.authorizationPlanDigest;
    const nextRevision = next?.revision ?? currentRevision(stored);
    events.push({
      version: 1,
      eventId: `authorization-plan-revised-${nextRevision}`,
      type: 'authorization_plan_revised',
      occurredAt: previous.supersededAt,
      authorizationPlanDigest: nextDigest,
      authorizationPlanRevision: nextRevision,
      previousAuthorizationPlanDigest: previous.authorizationPlan.authorizationPlanDigest,
    });
  }

  for (const contribution of contributions) {
    events.push({
      version: 1,
      eventId: `authorization-${contribution.digest}`,
      type: 'authorization_added',
      occurredAt: contribution.receivedAt,
      actorAddress: contribution.signerAddress,
      ...(contribution.submittedBy ? { actor: contribution.submittedBy } : {}),
      // Missing plan identity is a legacy pre-revision contribution. It belongs
      // to the original plan, never to whatever plan happens to be current now.
      authorizationPlanDigest: contribution.authorizationPlanDigest ?? initial.digest,
      authorizationPlanRevision: contribution.authorizationPlanRevision ?? initial.revision,
      entryIndex: contribution.entryIndex,
      contributionDigest: contribution.digest,
    });
  }

  for (const preparation of preparations) {
    events.push({
      version: 1,
      eventId: `execution-prepared-${preparation.preparedAt}-${preparation.transactionHash}`,
      type: 'execution_prepared',
      occurredAt: preparation.preparedAt,
      ...(preparation.preparedByAddress ? { actorAddress: preparation.preparedByAddress } : {}),
      ...(preparation.preparedBy ? { actor: preparation.preparedBy } : {}),
      authorizationPlanDigest: preparation.authorizationPlanDigest,
      authorizationPlanRevision: preparation.authorizationPlanRevision,
      executionSource: preparation.executionSource,
      transactionSequence: preparation.transactionSequence,
      transactionHash: preparation.transactionHash,
      effectsDigest: preparation.effectsDigest,
      effectsAccepted: preparation.effectsAccepted,
      validUntil: preparation.validUntil,
      latestLedger: preparation.latestLedger,
    });
  }

  for (const observation of observations) {
    events.push({
      version: 1,
      eventId: `execution-result-${observation.transactionHash}`,
      type: observation.successful ? 'execution_confirmed' : 'execution_failed',
      occurredAt: observation.networkCreatedAt ?? observation.observedAt,
      authorizationPlanDigest: observation.authorizationPlanDigest,
      authorizationPlanRevision: observation.authorizationPlanRevision,
      executionSource: observation.executionSource,
      transactionHash: observation.transactionHash,
      ledger: observation.ledger,
      successful: observation.successful,
      observedAt: observation.observedAt,
    });
  }

  const order: Record<SorobanIntentEvidenceEvent['type'], number> = {
    intent_created: 0,
    authorization_plan_revised: 1,
    authorization_added: 2,
    execution_prepared: 3,
    execution_confirmed: 4,
    execution_failed: 4,
  };
  return events.sort((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt)
    || order[left.type] - order[right.type]
    || left.eventId.localeCompare(right.eventId));
}
