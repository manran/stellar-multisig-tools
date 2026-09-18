import { createHash } from 'node:crypto';
import type { SigningRequestStore, StoredSigningRequest } from '../server/requestStore.js';
import type { SorobanIntentStore, StoredSorobanIntent } from '../server/sorobanIntentStore.js';

interface ClassicCounts {
  resources: number;
  contributions: number;
  submissions: number;
  participants: number;
  activityEvents: number;
  privateNoteRevisions: number;
}

interface SorobanCounts {
  resources: number;
  contributions: number;
  preparations: number;
  observations: number;
  cancellations: number;
}

export interface CoordinationBackfillReport {
  classic: ClassicCounts;
  soroban: SorobanCounts;
  sourceDigest: string;
  targetDigest: string;
}

export class CoordinationBackfillMismatchError extends Error {
  constructor(readonly resource: string, readonly sourceDigest: string, readonly targetDigest: string) {
    super(`Backfill verification mismatch for ${resource}.`);
    this.name = 'CoordinationBackfillMismatchError';
  }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]),
  );
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalValue(value)))
    .digest('hex');
}

function assertEquivalent(resource: string, source: unknown, target: unknown): void {
  const sourceDigest = digest(source);
  const targetDigest = digest(target);
  if (sourceDigest !== targetDigest) {
    throw new CoordinationBackfillMismatchError(resource, sourceDigest, targetDigest);
  }
}

function normalizedTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid coordination timestamp.');
  return parsed.toISOString();
}

function normalizedClassicRequest(value: StoredSigningRequest): StoredSigningRequest {
  return {
    ...value,
    createdAt: normalizedTimestamp(value.createdAt),
    expiresAt: normalizedTimestamp(value.expiresAt),
    ...(value.initialPrivateNote ? {
      initialPrivateNote: {
        ...value.initialPrivateNote,
        createdAt: normalizedTimestamp(value.initialPrivateNote.createdAt),
      },
    } : {}),
    ...(value.privateCommitment ? {
      privateCommitment: {
        ...value.privateCommitment,
        createdAt: normalizedTimestamp(value.privateCommitment.createdAt),
      },
    } : {}),
  };
}

function normalizedSorobanIntent(value: StoredSorobanIntent): StoredSorobanIntent {
  const privateContext = value.privateContext
    ? {
        ...value.privateContext,
        ...(value.privateContext.initialPrivateNote ? {
          initialPrivateNote: {
            ...value.privateContext.initialPrivateNote,
            createdAt: normalizedTimestamp(value.privateContext.initialPrivateNote.createdAt),
          },
        } : {}),
      }
    : undefined;
  return {
    ...value,
    authorizationPlanRevision: value.authorizationPlanRevision ?? 1,
    createdAt: normalizedTimestamp(value.createdAt),
    ...(value.authorizationPlanHistory ? {
      authorizationPlanHistory: value.authorizationPlanHistory.map((revision) => ({
        ...revision,
        supersededAt: normalizedTimestamp(revision.supersededAt),
      })),
    } : {}),
    ...(privateContext ? { privateContext } : {}),
    ...(value.cancellation ? {
      cancellation: {
        ...value.cancellation,
        cancelledAt: normalizedTimestamp(value.cancellation.cancelledAt),
      },
    } : {}),
  };
}

function intentWithoutCancellation(value: StoredSorobanIntent): StoredSorobanIntent {
  const { cancellation: _cancellation, ...rest } = value;
  return rest;
}

async function classicSnapshot(
  store: SigningRequestStore,
  request: StoredSigningRequest,
) {
  const [contributions, storedSubmission, participants, storedActivityEvents, privateNoteRevisions] = await Promise.all([
    store.listContributions(request.id),
    store.getSubmission(request.id, request.transactionHash),
    store.listRequestParticipants?.(request.id) ?? Promise.resolve([]),
    store.listActivityEvents?.(request.id) ?? Promise.resolve([]),
    store.listPrivateNoteRevisions?.(request.id) ?? Promise.resolve([]),
  ]);
  const normalizedContributions = contributions
    .map((contribution) => ({
      ...contribution,
      receivedAt: normalizedTimestamp(contribution.receivedAt),
    }))
    .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt) || left.digest.localeCompare(right.digest));
  const submission = storedSubmission
    ? { ...storedSubmission, submittedAt: normalizedTimestamp(storedSubmission.submittedAt) }
    : null;
  const normalizedParticipants = participants
    .map((participant) => ({
      ...participant,
      joinedAt: normalizedTimestamp(participant.joinedAt),
    }))
    .sort((left, right) => left.joinedAt.localeCompare(right.joinedAt) || left.address.localeCompare(right.address));
  // request_created / approval_added / transaction_confirmed and private-note/
  // commitment events are deterministically derivable from the resource facts.
  // Preserve only explicit collaboration/submission facts here; legacy projection
  // rows are intentionally not promoted into PostgreSQL authority.
  const activityEvents = storedActivityEvents
    .filter((event) => event.type === 'approval_declined' || event.type === 'transaction_submitted')
    .map((event) => ({ ...event, occurredAt: normalizedTimestamp(event.occurredAt) }))
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId));
  const normalizedPrivateNoteRevisions = privateNoteRevisions
    .map((revision) => ({
      ...revision,
      createdAt: normalizedTimestamp(revision.createdAt),
    }))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.revisionId.localeCompare(right.revisionId));
  return {
    request: normalizedClassicRequest(request),
    contributions: normalizedContributions,
    submission,
    participants: normalizedParticipants,
    activityEvents,
    privateNoteRevisions: normalizedPrivateNoteRevisions,
  };
}

async function sorobanSnapshot(
  store: SorobanIntentStore,
  intent: StoredSorobanIntent,
) {
  const [contributions, preparations, observations] = await Promise.all([
    store.listContributions(intent.id),
    store.listExecutionPreparations?.(intent.id) ?? Promise.resolve([]),
    store.listExecutionObservations?.(intent.id) ?? Promise.resolve([]),
  ]);
  const normalizedContributions = contributions
    .map((contribution) => ({
      ...contribution,
      receivedAt: normalizedTimestamp(contribution.receivedAt),
    }))
    .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt) || left.digest.localeCompare(right.digest));
  const normalizedPreparations = preparations
    .map((preparation) => ({
      ...preparation,
      validUntil: preparation.validUntil ? normalizedTimestamp(preparation.validUntil) : null,
      preparedAt: normalizedTimestamp(preparation.preparedAt),
    }))
    .sort((left, right) => left.preparedAt.localeCompare(right.preparedAt) || left.transactionHash.localeCompare(right.transactionHash));
  const normalizedObservations = observations
    .map((observation) => ({
      ...observation,
      observedAt: normalizedTimestamp(observation.observedAt),
      ...(observation.networkCreatedAt ? {
        networkCreatedAt: normalizedTimestamp(observation.networkCreatedAt),
      } : {}),
    }))
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.transactionHash.localeCompare(right.transactionHash));
  return {
    intent: normalizedSorobanIntent(intent),
    contributions: normalizedContributions,
    preparations: normalizedPreparations,
    observations: normalizedObservations,
  };
}

function addClassicCounts(counts: ClassicCounts, snapshot: Awaited<ReturnType<typeof classicSnapshot>>): void {
  counts.resources += 1;
  counts.contributions += snapshot.contributions.length;
  counts.submissions += snapshot.submission ? 1 : 0;
  counts.participants += snapshot.participants.length;
  counts.activityEvents += snapshot.activityEvents.length;
  counts.privateNoteRevisions += snapshot.privateNoteRevisions.length;
}

function addSorobanCounts(counts: SorobanCounts, snapshot: Awaited<ReturnType<typeof sorobanSnapshot>>): void {
  counts.resources += 1;
  counts.contributions += snapshot.contributions.length;
  counts.preparations += snapshot.preparations.length;
  counts.observations += snapshot.observations.length;
  counts.cancellations += snapshot.intent.cancellation ? 1 : 0;
}

export async function backfillCoordinationData(input: {
  requests: StoredSigningRequest[];
  intents: StoredSorobanIntent[];
  sourceRequests: SigningRequestStore;
  sourceIntents: SorobanIntentStore;
  targetRequests: SigningRequestStore;
  targetIntents: SorobanIntentStore;
}): Promise<CoordinationBackfillReport> {
  const classic: ClassicCounts = {
    resources: 0,
    contributions: 0,
    submissions: 0,
    participants: 0,
    activityEvents: 0,
    privateNoteRevisions: 0,
  };
  const soroban: SorobanCounts = {
    resources: 0,
    contributions: 0,
    preparations: 0,
    observations: 0,
    cancellations: 0,
  };
  const sourceSnapshots: unknown[] = [];
  const targetSnapshots: unknown[] = [];

  for (const request of [...input.requests].sort((a, b) => a.id.localeCompare(b.id))) {
    const existing = await input.targetRequests.getRequest(request.id);
    if (!existing) {
      await input.targetRequests.createRequest(request);
    } else {
      assertEquivalent(
        `classic:${request.id}:root`,
        normalizedClassicRequest(request),
        normalizedClassicRequest(existing),
      );
    }

    const source = await classicSnapshot(input.sourceRequests, request);
    for (const contribution of source.contributions) {
      await input.targetRequests.putContribution(request.id, contribution);
    }
    if (source.submission) await input.targetRequests.putSubmission(request.id, source.submission);
    for (const participant of source.participants) {
      await input.targetRequests.putRequestParticipant?.(request.id, participant);
    }
    for (const event of source.activityEvents) {
      await input.targetRequests.putActivityEvent?.(request.id, event);
    }
    for (const revision of source.privateNoteRevisions) {
      await input.targetRequests.putPrivateNoteRevision?.(request.id, revision);
    }

    const targetRequest = await input.targetRequests.getRequest(request.id);
    if (!targetRequest) throw new Error(`Backfill lost Classic Request ${request.id}.`);
    const target = await classicSnapshot(input.targetRequests, targetRequest);
    assertEquivalent(`classic:${request.id}`, source, target);
    addClassicCounts(classic, source);
    sourceSnapshots.push({ kind: 'classic_request', id: request.id, snapshot: source });
    targetSnapshots.push({ kind: 'classic_request', id: request.id, snapshot: target });
  }

  for (const intent of [...input.intents].sort((a, b) => a.id.localeCompare(b.id))) {
    const existing = await input.targetIntents.getIntent(intent.id);
    if (!existing) {
      await input.targetIntents.createIntent(intentWithoutCancellation(intent));
    } else {
      assertEquivalent(
        `soroban:${intent.id}:root`,
        normalizedSorobanIntent(intentWithoutCancellation(intent)),
        normalizedSorobanIntent(intentWithoutCancellation(existing)),
      );
    }
    if (intent.executionPolicy?.executor) {
      await input.targetIntents.bindExecutionPolicy?.(intent.id, intent.executionPolicy);
    }

    const source = await sorobanSnapshot(input.sourceIntents, intent);
    for (const contribution of source.contributions) {
      await input.targetIntents.putContribution(intent.id, contribution);
    }
    for (const preparation of source.preparations) {
      await input.targetIntents.putExecutionPreparation?.(intent.id, preparation);
    }
    if (intent.cancellation) {
      await input.targetIntents.cancelIntent?.(intent.id, intent.cancellation);
    }
    for (const observation of source.observations) {
      await input.targetIntents.putExecutionObservation?.(intent.id, observation);
    }

    const targetIntent = await input.targetIntents.getIntent(intent.id);
    if (!targetIntent) throw new Error(`Backfill lost Soroban Intent ${intent.id}.`);
    const target = await sorobanSnapshot(input.targetIntents, targetIntent);
    assertEquivalent(`soroban:${intent.id}`, source, target);
    addSorobanCounts(soroban, source);
    sourceSnapshots.push({ kind: 'soroban_intent', id: intent.id, snapshot: source });
    targetSnapshots.push({ kind: 'soroban_intent', id: intent.id, snapshot: target });
  }

  const sourceDigest = digest(sourceSnapshots);
  const targetDigest = digest(targetSnapshots);
  if (sourceDigest !== targetDigest) {
    throw new CoordinationBackfillMismatchError('all', sourceDigest, targetDigest);
  }
  return { classic, soroban, sourceDigest, targetDigest };
}
