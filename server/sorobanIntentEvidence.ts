import type { SorobanIntentEvidenceEvent } from '../src/stellar/sorobanIntentApiTypes.js';
import type {
  StoredSorobanIntent,
  StoredSorobanIntentAuthorizationContribution,
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

  const order: Record<SorobanIntentEvidenceEvent['type'], number> = {
    intent_created: 0,
    authorization_plan_revised: 1,
    authorization_added: 2,
  };
  return events.sort((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt)
    || order[left.type] - order[right.type]
    || left.eventId.localeCompare(right.eventId));
}
