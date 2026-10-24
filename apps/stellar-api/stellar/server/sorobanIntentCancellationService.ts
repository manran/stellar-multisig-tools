import type { MachineCallerProvenance } from '../../../../packages/stellar-core/src/coordinationActorTypes.js';
import { SorobanIntentStoreConflictError } from './sorobanIntentStore.js';
import type {
  SorobanIntentStore,
  StoredSorobanIntent,
  StoredSorobanIntentCancellation,
} from './sorobanIntentStore.js';

export class SorobanIntentCancellationServiceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'SorobanIntentCancellationServiceError';
  }
}

function currentRevision(stored: { authorizationPlanRevision?: number }): number {
  return stored.authorizationPlanRevision ?? 1;
}

export function assertSorobanIntentCancellationOwner(
  stored: StoredSorobanIntent,
  actor: { serviceId?: string; principalAddress?: string },
): void {
  if (stored.integration) {
    if (actor.serviceId === stored.integration.serviceId) return;
    throw new SorobanIntentCancellationServiceError(
      'Only the Integration Service that owns this Soroban Intent can cancel it.',
      403,
      'intent_cancel_not_owner',
    );
  }
  if (actor.principalAddress && actor.principalAddress === stored.creatorAddress) return;
  throw new SorobanIntentCancellationServiceError(
    'Only the Intent creator can cancel this Soroban Intent.',
    403,
    'intent_cancel_not_owner',
  );
}

export async function cancelSorobanIntent(
  store: SorobanIntentStore,
  id: string,
  actor: { cancelledByAddress?: string; cancelledBy?: MachineCallerProvenance },
  options: { now?: Date } = {},
) {
  const stored = await store.getIntent(id);
  if (!stored) {
    throw new SorobanIntentCancellationServiceError('Soroban Intent not found.', 404, 'intent_not_found');
  }
  if (stored.cancellation) {
    return { intent: stored, cancellation: stored.cancellation, replayed: true };
  }
  if (!store.cancelIntent) {
    throw new SorobanIntentCancellationServiceError(
      'Soroban Intent cancellation storage is unavailable.',
      503,
      'intent_cancellation_unavailable',
    );
  }
  const observations = await (store.listExecutionObservations?.(id) ?? Promise.resolve([]));
  if (observations.some((item) => item.successful)) {
    throw new SorobanIntentCancellationServiceError(
      'This Soroban Intent has already executed successfully and cannot be cancelled.',
      409,
      'intent_already_executed',
    );
  }
  const cancellation: StoredSorobanIntentCancellation = {
    version: 1,
    cancelledAt: (options.now ?? new Date()).toISOString(),
    authorizationPlanDigest: stored.authorizationPlan.authorizationPlanDigest,
    authorizationPlanRevision: currentRevision(stored),
    ...(actor.cancelledByAddress ? { cancelledByAddress: actor.cancelledByAddress } : {}),
    ...(actor.cancelledBy ? { cancelledBy: actor.cancelledBy } : {}),
  };
  let persisted;
  try {
    persisted = await store.cancelIntent(id, cancellation);
  } catch (cause) {
    if (cause instanceof SorobanIntentStoreConflictError && cause.code === 'intent_already_executed') {
      throw new SorobanIntentCancellationServiceError(
        'This Soroban Intent has already executed successfully and cannot be cancelled.',
        409,
        'intent_already_executed',
      );
    }
    throw cause;
  }
  const latest = await store.getIntent(id);
  return {
    intent: latest ?? { ...stored, cancellation: persisted.cancellation },
    cancellation: persisted.cancellation,
    replayed: !persisted.created,
  };
}
