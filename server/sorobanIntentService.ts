import type { MachineCallerProvenance } from '../src/stellar/coordinationActorTypes.js';
import type { SorobanIntentIntegrationContext } from '../src/stellar/integrationTypes.js';
import type { ExecutionPolicy } from '../src/stellar/executionPolicy.js';
import { normalizePrivateNote } from '../src/stellar/privateNote.js';
import type { PrivateNoteRevision } from '../src/stellar/privateNote.js';
import type { SorobanAuthorizationPlan } from '../src/stellar/sorobanAuthorizationPlan.js';
import type { SorobanIntent } from '../src/stellar/sorobanIntent.js';
import { normalizeExternalReference } from './boxService.js';
import { createSigningRequestId } from './requestLocator.js';
import type { SorobanIntentStore, StoredSorobanIntent } from './sorobanIntentStore.js';

export class SorobanIntentServiceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'SorobanIntentServiceError';
  }
}

function initialPrivateNote(value: unknown, createdAt: string): PrivateNoteRevision | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new SorobanIntentServiceError('Private note must be text.', 400, 'invalid_private_note');
  }
  try {
    return { version: 1, revisionId: 'initial', text: normalizePrivateNote(value), createdAt };
  } catch (cause) {
    throw new SorobanIntentServiceError(
      cause instanceof Error ? cause.message : 'Invalid private note.',
      400,
      'invalid_private_note',
    );
  }
}
export async function createStoredSorobanIntent(
  store: SorobanIntentStore,
  input: {
    intent: SorobanIntent;
    authorizationPlan: SorobanAuthorizationPlan;
    creatorAddress?: string;
    creatorActor?: MachineCallerProvenance;
    discoverySignerKeys?: string[];
    integration?: SorobanIntentIntegrationContext;
    executionPolicy?: ExecutionPolicy;
    privateNote?: unknown;
    externalReference?: unknown;
  },
  options: { now?: Date; idFactory?: () => string } = {},
): Promise<StoredSorobanIntent> {
  if (
    input.authorizationPlan.network !== input.intent.network
    || input.authorizationPlan.intentDigest !== input.intent.intentDigest
  ) {
    throw new SorobanIntentServiceError(
      'Authorization Plan does not belong to this Soroban Intent.',
      409,
      'authorization_plan_mismatch',
    );
  }
  if (input.authorizationPlan.executionBinding !== 'detached') {
    throw new SorobanIntentServiceError(
      'This contract call uses SOURCE_ACCOUNT Soroban authorization, which binds authorization to the final transaction source. MultiSigTools Intent workflows intentionally collect authorization before choosing an executor, so this source-bound authorization cannot be used here. Use detached address authorization instead, or change the contract/integration so authorization is not supplied by the transaction source.',
      409,
      'source_account_auth_unsupported',
    );
  }

  const createdAt = (options.now ?? new Date()).toISOString();
  const note = initialPrivateNote(input.privateNote, createdAt);
  const externalReference = normalizeExternalReference(input.externalReference);
  const privateContext = note || externalReference
    ? {
        ...(externalReference ? { externalReference } : {}),
        ...(note ? { initialPrivateNote: note } : {}),
      }
    : undefined;
  const record: StoredSorobanIntent = {
    version: 1,
    id: options.idFactory?.() ?? createSigningRequestId(),
    network: input.intent.network,
    intent: input.intent,
    authorizationPlan: input.authorizationPlan,
    authorizationPlanRevision: 1,
    createdAt,
    ...(input.creatorAddress ? { creatorAddress: input.creatorAddress } : {}),
    ...(input.creatorActor ? { creatorActor: input.creatorActor } : {}),
    discoverySignerKeys: [...new Set([...(input.creatorAddress ? [input.creatorAddress] : []), ...(input.discoverySignerKeys ?? [])])].sort(),
    ...(input.integration ? { integration: input.integration } : {}),
    ...(input.executionPolicy ? { executionPolicy: input.executionPolicy } : {}),
    ...(privateContext ? { privateContext } : {}),
  };
  await store.createIntent(record);
  return record;
}
