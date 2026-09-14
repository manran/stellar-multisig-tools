import type { StellarNetwork } from '../src/stellar/types.js';
import { buildContractIntent } from './contractIntentService.js';
import { planSorobanIntentForStorage } from './sorobanIntentPlanningService.js';
import { createStoredSorobanIntent } from './sorobanIntentService.js';
import type { SorobanIntentStore, StoredSorobanIntent } from './sorobanIntentStore.js';

interface HumanSorobanIntentOptions {
  planningSource: string;
  now?: Date;
  idFactory?: () => string;
  beforeCreate?: () => Promise<void>;
  contractDependencies?: Parameters<typeof buildContractIntent>[1];
  planningDependencies?: Parameters<typeof planSorobanIntentForStorage>[2];
}

export async function createHumanSorobanIntent(
  store: SorobanIntentStore,
  creatorAddress: string,
  input: {
    network: StellarNetwork;
    contractId: unknown;
    method: unknown;
    arguments: unknown;
    privateNote?: unknown;
    externalReference?: unknown;
  },
  options: HumanSorobanIntentOptions,
): Promise<StoredSorobanIntent> {
  const built = await buildContractIntent({
    network: input.network,
    contractId: input.contractId,
    method: input.method,
    arguments: input.arguments,
  }, options.contractDependencies);
  const planned = await planSorobanIntentForStorage(
    built.intent,
    options.planningSource,
    options.planningDependencies,
  );
  await options.beforeCreate?.();
  return createStoredSorobanIntent(store, {
    intent: built.intent,
    authorizationPlan: planned.authorizationPlan,
    creatorAddress,
    discoverySignerKeys: planned.discoverySignerKeys,
    privateNote: input.privateNote,
    externalReference: input.externalReference,
  }, {
    now: options.now,
    idFactory: options.idFactory,
  });
}
