import { createHash } from 'node:crypto';
import type { SorobanPreparationSnapshot } from '../src/stellar/sorobanPreparationTypes.js';
import type { StellarNetwork } from '../src/stellar/types.js';
import {
  AgentCredentialServiceError,
  requireAgentAccess,
  sameSignerPrincipal,
} from './agentCredentialService.js';
import type {
  AgentCredentialStore,
  StoredAgentIdempotencyClaim,
  StoredSignerAgentCredential,
} from './agentCredentialStore.js';
import {
  idempotencyHash,
  normalizeIdempotencyKey,
} from './boxService.js';
import { capabilityHashForToken } from './requestAccess.js';
import { createCapabilityToken, createSigningRequestId } from './requestLocator.js';
import {
  createSorobanPreparation,
  getSorobanPreparation,
} from './sorobanPreparationService.js';
import type { SorobanPreparationStore } from './sorobanPreparationStore.js';
import type { SorobanAccountLoader } from '../src/stellar/sorobanAuthorization.js';
import type { StellarNetworkParameters } from '../src/stellar/horizon.js';

interface AgentPreparationOptions {
  now?: Date;
  accountLoader?: SorobanAccountLoader;
  networkParametersLoader?: (network: StellarNetwork) => Promise<StellarNetworkParameters>;
  idFactory?: () => string;
}

export interface AgentPreparationCreationResult {
  replayed: boolean;
  preparation: SorobanPreparationSnapshot;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function payloadHash(network: StellarNetwork, xdr: string): string {
  return sha256(JSON.stringify({
    operation: 'contract.authorization.create',
    network,
    xdr: xdr.trim(),
  }));
}

function assertAgentMayCreate(
  credential: StoredSignerAgentCredential,
  network: StellarNetwork,
): void {
  requireAgentAccess(credential, 'write');
  if (credential.principal.network !== network) {
    throw new AgentCredentialServiceError(
      'Transaction network does not match this Agent credential Principal.',
      403,
      'principal_network_mismatch',
    );
  }
}

async function snapshotFor(
  store: SorobanPreparationStore,
  id: string,
  options: AgentPreparationOptions,
): Promise<SorobanPreparationSnapshot> {
  return getSorobanPreparation(store, id, {
    now: options.now,
    accountLoader: options.accountLoader,
    networkParametersLoader: options.networkParametersLoader,
  });
}

async function touch(
  store: AgentCredentialStore,
  credential: StoredSignerAgentCredential,
  now: Date,
): Promise<void> {
  await store.touchCredential(credential.credentialId, now.toISOString());
}

export async function createAgentSorobanPreparation(
  agentStore: AgentCredentialStore,
  preparationStore: SorobanPreparationStore,
  credential: StoredSignerAgentCredential,
  input: {
    network: StellarNetwork;
    xdr: string;
    idempotencyKey: string;
  },
  options: AgentPreparationOptions = {},
): Promise<AgentPreparationCreationResult> {
  assertAgentMayCreate(credential, input.network);
  const now = options.now ?? new Date();
  const idem = normalizeIdempotencyKey(input.idempotencyKey);
  const hash = payloadHash(input.network, input.xdr);
  const claim: StoredAgentIdempotencyClaim = {
    version: 1,
    credentialId: credential.credentialId,
    operation: 'contract.authorization.create',
    requestId: options.idFactory?.() ?? createSigningRequestId(),
    principal: credential.principal,
    idempotencyHash: idempotencyHash(`contract.authorization.create:${idem}`),
    payloadHash: hash,
    createdAt: now.toISOString(),
  };
  const claimed = await agentStore.claimIdempotency(claim);
  const activeClaim = claimed.claim;

  if (!claimed.claimed) {
    if (
      activeClaim.credentialId !== credential.credentialId
      || activeClaim.operation !== 'contract.authorization.create'
      || !sameSignerPrincipal(activeClaim.principal, credential.principal)
      || activeClaim.payloadHash !== hash
    ) {
      throw new AgentCredentialServiceError(
        'Idempotency key is already bound to a different contract authorization.',
        409,
        'idempotency_conflict',
      );
    }
    if (await preparationStore.getPreparation(activeClaim.requestId)) {
      const preparation = await snapshotFor(preparationStore, activeClaim.requestId, options);
      await touch(agentStore, credential, now);
      return { replayed: true, preparation };
    }
  }

  let writeAttempted = false;
  try {
    const preparation = await createSorobanPreparation(
      preparationStore,
      { network: input.network, xdr: input.xdr },
      {
        now,
        idFactory: () => activeClaim.requestId,
        capabilityHash: capabilityHashForToken(createCapabilityToken()),
        creatorAddress: credential.principal.address,
        creatorActor: {
          type: 'agent',
          id: credential.credentialId,
          label: credential.label,
          principalAddress: credential.principal.address,
        },
        accountLoader: options.accountLoader,
        networkParametersLoader: options.networkParametersLoader,
        onCreateAttempt: () => { writeAttempted = true; },
      },
    );
    await touch(agentStore, credential, now);
    return { replayed: !claimed.claimed, preparation };
  } catch (cause) {
    if (writeAttempted && await preparationStore.getPreparation(activeClaim.requestId)) {
      const preparation = await snapshotFor(preparationStore, activeClaim.requestId, options);
      await touch(agentStore, credential, now);
      return { replayed: true, preparation };
    }
    if (claimed.claimed && !writeAttempted) {
      await agentStore.releaseIdempotency(activeClaim);
    }
    throw cause;
  }
}
