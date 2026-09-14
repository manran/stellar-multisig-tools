import type { AgentActorProvenance } from '../src/stellar/agentAccessTypes.js';
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
    creatorAddress: string;
    creatorActor?: AgentActorProvenance;
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
      'Source-account Soroban authorization is not supported by source-free Intent planning.',
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
    createdAt,
    creatorAddress: input.creatorAddress,
    ...(input.creatorActor ? { creatorActor: input.creatorActor } : {}),
    ...(privateContext ? { privateContext } : {}),
  };
  await store.createIntent(record);
  return record;
}
