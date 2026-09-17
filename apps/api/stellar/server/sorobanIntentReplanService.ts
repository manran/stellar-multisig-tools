import { getSorobanIntentAuthorization, type SorobanIntentAuthorizationSnapshot } from './sorobanIntentAuthorizationService.js';
import { compareSorobanEffects } from '../../../../src/stellar/sorobanEffects.js';
import { planSorobanIntentForStorage } from './sorobanIntentPlanningService.js';
import type { SorobanIntentStore, StoredSorobanIntent } from './sorobanIntentStore.js';

export class SorobanIntentReplanServiceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'SorobanIntentReplanServiceError';
  }
}

type AuthorizationDependencies = NonNullable<Parameters<typeof getSorobanIntentAuthorization>[2]>;
type PlanningDependencies = NonNullable<Parameters<typeof planSorobanIntentForStorage>[2]>;

interface ReplanOptions {
  now?: Date;
  authorization?: SorobanIntentAuthorizationSnapshot;
  authorizationDependencies?: AuthorizationDependencies;
  planningDependencies?: PlanningDependencies;
}

function currentRevision(stored: StoredSorobanIntent): number {
  return stored.authorizationPlanRevision ?? 1;
}

export async function replanExpiredSorobanIntent(
  store: SorobanIntentStore,
  id: string,
  planningSource: string,
  options: ReplanOptions = {},
) {
  const stored = await store.getIntent(id);
  if (!stored) {
    throw new SorobanIntentReplanServiceError('Soroban Intent not found.', 404, 'intent_not_found');
  }
  const authorization = options.authorization ?? await getSorobanIntentAuthorization(
    store,
    id,
    options.authorizationDependencies,
  );
  if (authorization.status !== 'expired' && authorization.status !== 'authorization_ready') {
    throw new SorobanIntentReplanServiceError(
      'Soroban authorization can be refreshed only after expiration or after execution detects a structural effects change.',
      409,
      'intent_replan_not_allowed',
    );
  }

  const planned = await planSorobanIntentForStorage(
    stored.intent,
    planningSource,
    options.planningDependencies,
  );
  if (authorization.status === 'authorization_ready' && stored.authorizationPlan.effects?.digest) {
    const effectsDiff = compareSorobanEffects(
      stored.authorizationPlan.effects,
      planned.authorizationPlan.effects,
    );
    if (!effectsDiff.requiresReauthorization) {
      throw new SorobanIntentReplanServiceError(
        'Fresh planning did not produce a structural simulation-effects change. Keep the current authorization plan.',
        409,
        'intent_replan_not_needed',
      );
    }
  }

  if (planned.authorizationPlan.authorizationPlanDigest === stored.authorizationPlan.authorizationPlanDigest) {
    throw new SorobanIntentReplanServiceError(
      'Fresh planning did not produce a new Soroban authorization plan.',
      503,
      'intent_replan_not_refreshed',
    );
  }

  const latest = await store.getIntent(id);
  if (
    !latest
    || latest.authorizationPlan.authorizationPlanDigest !== stored.authorizationPlan.authorizationPlanDigest
    || currentRevision(latest) !== currentRevision(stored)
  ) {
    throw new SorobanIntentReplanServiceError(
      'The Soroban authorization plan changed while re-planning. Reload the Intent and try again.',
      409,
      'authorization_plan_changed',
    );
  }

  const supersededAt = (options.now ?? new Date()).toISOString();
  const revision = currentRevision(stored);
  const updated: StoredSorobanIntent = {
    ...stored,
    authorizationPlan: planned.authorizationPlan,
    authorizationPlanRevision: revision + 1,
    authorizationPlanHistory: [
      ...(stored.authorizationPlanHistory ?? []),
      { revision, authorizationPlan: stored.authorizationPlan, supersededAt },
    ],
    discoverySignerKeys: [...new Set([
      ...(stored.creatorAddress ? [stored.creatorAddress] : []),
      ...planned.discoverySignerKeys,
    ])].sort(),
  };
  await store.updateIntent(updated);
  return {
    intent: updated,
    authorization: await getSorobanIntentAuthorization(
      store,
      id,
      options.authorizationDependencies,
    ),
    previousAuthorizationPlanDigest: stored.authorizationPlan.authorizationPlanDigest,
    authorizationPlanRevision: revision + 1,
  };
}
