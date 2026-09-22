import { createHash } from 'node:crypto';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';
import {
  AgentCredentialServiceError,
  agentActorForCredential,
  requireAgentAccess,
  sameSignerPrincipal,
} from './agentCredentialService.js';
import type {
  AgentCredentialStore,
  StoredAgentIdempotencyClaim,
  StoredSignerAgentCredential,
} from './agentCredentialStore.js';
import { buildContractIntent } from './contractIntentService.js';
import {
  idempotencyHash,
  normalizeExternalReference,
  normalizeIdempotencyKey,
} from './boxService.js';
import { createSigningRequestId } from './requestLocator.js';
import { planSorobanIntentForStorage } from './sorobanIntentPlanningService.js';
import { createStoredSorobanIntent } from './sorobanIntentService.js';
import type { SorobanIntentStore, StoredSorobanIntent } from './sorobanIntentStore.js';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
interface AgentSorobanIntentOptions {
  planningSource: string;
  now?: Date;
  idFactory?: () => string;
  contractDependencies?: Parameters<typeof buildContractIntent>[1];
  planningDependencies?: Parameters<typeof planSorobanIntentForStorage>[2];
}

export interface AgentSorobanIntentCreationResult {
  replayed: boolean;
  intent: StoredSorobanIntent;
}

function payloadHash(input: {
  network: StellarNetwork;
  intentDigest: string;
  externalReference?: string;
  privateNote?: unknown;
}): string {
  return sha256(JSON.stringify({
    network: input.network,
    intentDigest: input.intentDigest,
    externalReference: input.externalReference ?? null,
    privateNote: input.privateNote ?? null,
  }));
}

function assertReplayMatches(
  stored: StoredSorobanIntent,
  network: StellarNetwork,
  intentDigest: string,
): void {
  if (stored.network !== network || stored.intent.intentDigest !== intentDigest) {
    throw new AgentCredentialServiceError(
      'Idempotency recovery found a different Soroban Intent at the reserved id.',
      409,
      'idempotency_conflict',
    );
  }
}
export async function createAgentSorobanIntent(
  agentStore: AgentCredentialStore,
  intentStore: SorobanIntentStore,
  credential: StoredSignerAgentCredential,
  input: {
    network: StellarNetwork;
    contractId: unknown;
    method: unknown;
    arguments: unknown;
    idempotencyKey: string;
    privateNote?: unknown;
    externalReference?: unknown;
  },
  options: AgentSorobanIntentOptions,
): Promise<AgentSorobanIntentCreationResult> {
  requireAgentAccess(credential, 'write');
  if (credential.principal.network !== input.network) {
    throw new AgentCredentialServiceError(
      'Intent network does not match this Agent credential Principal.',
      403,
      'principal_network_mismatch',
    );
  }

  const now = options.now ?? new Date();
  const idemHash = idempotencyHash(normalizeIdempotencyKey(input.idempotencyKey));
  const externalReference = normalizeExternalReference(input.externalReference);
  const built = await buildContractIntent({
    network: input.network,
    contractId: input.contractId,
    method: input.method,
    arguments: input.arguments,
  }, options.contractDependencies);
  const claim: StoredAgentIdempotencyClaim = {
    version: 1,
    credentialId: credential.credentialId,
    operation: 'intent.create',
    requestId: options.idFactory?.() ?? createSigningRequestId(),
    principal: credential.principal,
    idempotencyHash: idemHash,
    payloadHash: payloadHash({
      network: input.network,
      intentDigest: built.intent.intentDigest,
      externalReference,
      privateNote: input.privateNote,
    }),
    ...(externalReference ? { externalReference } : {}),
    createdAt: now.toISOString(),
  };
  const claimed = await agentStore.claimIdempotency(claim);
  const active = claimed.claim;

  if (!claimed.claimed) {
    if (
      active.credentialId !== credential.credentialId
      || active.operation !== 'intent.create'
      || !sameSignerPrincipal(active.principal, credential.principal)
      || active.payloadHash !== claim.payloadHash
    ) {
      throw new AgentCredentialServiceError(
        'Idempotency key is already bound to a different Soroban Intent.',
        409,
        'idempotency_conflict',
      );
    }
    const existing = await intentStore.getIntent(active.requestId);
    if (existing) {
      assertReplayMatches(existing, input.network, built.intent.intentDigest);
      await agentStore.touchCredential(credential.credentialId, now.toISOString());
      return { replayed: true, intent: existing };
    }
  }
  let durableWriteAttempted = false;
  try {
    const planned = await planSorobanIntentForStorage(
      built.intent,
      options.planningSource,
      options.planningDependencies,
    );
    const guardedStore: SorobanIntentStore = {
      ...intentStore,
      createIntent: async (value) => {
        durableWriteAttempted = true;
        await intentStore.createIntent(value);
      },
    };
    const stored = await createStoredSorobanIntent(guardedStore, {
      intent: built.intent,
      authorizationPlan: planned.authorizationPlan,
      creatorAddress: credential.principal.address,
      discoverySignerKeys: planned.discoverySignerKeys,
      creatorActor: agentActorForCredential(credential),
      privateNote: input.privateNote,
      externalReference,
    }, {
      now,
      idFactory: () => active.requestId,
    });
    await agentStore.touchCredential(credential.credentialId, now.toISOString());
    return { replayed: !claimed.claimed, intent: stored };
  } catch (cause) {
    if (durableWriteAttempted) {
      const existing = await intentStore.getIntent(active.requestId);
      if (existing) {
        assertReplayMatches(existing, input.network, built.intent.intentDigest);
        await agentStore.touchCredential(credential.credentialId, now.toISOString());
        return { replayed: !claimed.claimed, intent: existing };
      }
    }
    if (claimed.claimed && !durableWriteAttempted) {
      await agentStore.releaseIdempotency(active);
    }
    throw cause;
  }
}
