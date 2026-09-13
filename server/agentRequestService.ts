import { createHash } from 'node:crypto';
import { normalizePrivateNote } from '../src/stellar/privateNote.js';
import type { PrivateNoteRevision } from '../src/stellar/privateNote.js';
import type { SigningRequestSnapshot } from '../src/stellar/requestTypes.js';
import type { StellarNetwork } from '../src/stellar/types.js';
import { inspectTransactionXdr } from '../src/stellar/transactionXdr.js';
import {
  agentActorForCredential,
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
  BoxServiceError,
  idempotencyHash,
  normalizeExternalReference,
  normalizeIdempotencyKey,
} from './boxService.js';
import { signerCanAccessTransaction } from './requestAccess.js';
import { createSigningRequestId } from './requestLocator.js';
import {
  createSigningRequest,
  getSigningRequest,
} from './requestService.js';
import type { AccountLoader, NetworkParametersLoader } from './requestService.js';
import type { SigningRequestStore, StoredSigningRequest } from './requestStore.js';

interface AgentRequestOptions {
  now?: Date;
  accountLoader?: AccountLoader;
  networkParametersLoader?: NetworkParametersLoader;
  idFactory?: () => string;
}

export interface AgentRequestCreationResult {
  replayed: boolean;
  request: SigningRequestSnapshot;
  externalReference?: string;
}

function initialPrivateNote(value: unknown, createdAt: string): PrivateNoteRevision | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new BoxServiceError('Private note must be text.', 400, 'invalid_private_note');
  try {
    return { version: 1, revisionId: 'initial', text: normalizePrivateNote(value), createdAt };
  } catch (cause) {
    throw new BoxServiceError(cause instanceof Error ? cause.message : 'Invalid private note.', 400, 'invalid_private_note');
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function agentPayloadHash(input: {
  network: StellarNetwork;
  xdr: string;
  externalReference?: string;
  privateNote?: unknown;
}): string {
  return sha256(JSON.stringify({
    network: input.network,
    xdr: input.xdr.trim(),
    externalReference: input.externalReference ?? null,
    privateNote: input.privateNote ?? null,
  }));
}

async function touchCredential(
  store: AgentCredentialStore,
  credential: StoredSignerAgentCredential,
  now: Date,
): Promise<void> {
  await store.touchCredential(credential.credentialId, now.toISOString());
}

function assertReservedRequestMatchesInput(
  request: StoredSigningRequest,
  input: { network: StellarNetwork; xdr: string; privateNote?: unknown },
): void {
  const expectedNote = initialPrivateNote(input.privateNote, request.createdAt)?.text;
  if (
    request.network !== input.network
    || request.baseXdr !== input.xdr.trim()
    || request.initialPrivateNote?.text !== expectedNote
  ) {
    throw new BoxServiceError('Idempotency recovery found a different Request at the reserved id.', 409, 'idempotency_conflict');
  }
}

async function assertAgentMayCreate(
  credential: StoredSignerAgentCredential,
  input: { network: StellarNetwork; xdr: string },
  accountLoader?: AccountLoader,
): Promise<void> {
  requireAgentAccess(credential, 'write');
  if (credential.principal.network !== input.network) {
    throw new AgentCredentialServiceError(
      'Transaction network does not match this Agent credential Principal.',
      403,
      'principal_network_mismatch',
    );
  }
  let inspection;
  try {
    inspection = inspectTransactionXdr(input.xdr, input.network);
  } catch (cause) {
    throw new BoxServiceError(cause instanceof Error ? cause.message : 'Invalid transaction envelope XDR.', 400, 'invalid_xdr');
  }
  if (inspection.innerSignatureCount > 0) requireAgentAccess(credential, 'sign');
  const allowed = await signerCanAccessTransaction(
    credential.principal.address,
    input.xdr,
    input.network,
    accountLoader,
  );
  if (!allowed) {
    throw new AgentCredentialServiceError(
      'The Agent credential Principal is not a current signer for this transaction.',
      403,
      'principal_transaction_access_denied',
    );
  }
}

async function bindPrincipalParticipant(
  requestStore: SigningRequestStore,
  requestId: string,
  principalAddress: string,
  joinedAt: string,
): Promise<void> {
  if (!requestStore.putRequestParticipant) return;
  const existing = await requestStore.getRequestParticipant?.(requestId, principalAddress) ?? null;
  if (existing) return;
  await requestStore.putRequestParticipant(requestId, {
    version: 1,
    address: principalAddress,
    joinedAt,
  });
}

export async function createAgentSigningRequest(
  agentStore: AgentCredentialStore,
  requestStore: SigningRequestStore,
  credential: StoredSignerAgentCredential,
  input: {
    network: StellarNetwork;
    xdr: string;
    idempotencyKey: string;
    externalReference?: unknown;
    privateNote?: unknown;
  },
  options: AgentRequestOptions = {},
): Promise<AgentRequestCreationResult> {
  const now = options.now ?? new Date();
  await assertAgentMayCreate(credential, input, options.accountLoader);
  const idem = normalizeIdempotencyKey(input.idempotencyKey);
  const idemHash = idempotencyHash(idem);
  const externalReference = normalizeExternalReference(input.externalReference);
  const payloadHash = agentPayloadHash({
    network: input.network,
    xdr: input.xdr,
    externalReference,
    privateNote: input.privateNote,
  });
  const claim: StoredAgentIdempotencyClaim = {
    version: 1,
    credentialId: credential.credentialId,
    operation: 'proposal.create',
    requestId: options.idFactory?.() ?? createSigningRequestId(),
    principal: credential.principal,
    idempotencyHash: idemHash,
    payloadHash,
    ...(externalReference ? { externalReference } : {}),
    createdAt: now.toISOString(),
  };
  const claimed = await agentStore.claimIdempotency(claim);
  const activeClaim = claimed.claim;

  if (!claimed.claimed) {
    if (
      activeClaim.credentialId !== credential.credentialId
      || (activeClaim.operation !== undefined && activeClaim.operation !== 'proposal.create')
      || !sameSignerPrincipal(activeClaim.principal, credential.principal)
      || activeClaim.payloadHash !== payloadHash
    ) {
      throw new BoxServiceError('Idempotency key is already bound to a different Agent proposal.', 409, 'idempotency_conflict');
    }
    const existing = await requestStore.getRequest(activeClaim.requestId);
    if (existing) {
      assertReservedRequestMatchesInput(existing, input);
      await bindPrincipalParticipant(
        requestStore,
        existing.id,
        credential.principal.address,
        activeClaim.createdAt,
      );
      const snapshot = await getSigningRequest(requestStore, existing.id, options);
      await touchCredential(agentStore, credential, now);
      return {
        replayed: true,
        request: snapshot,
        ...(activeClaim.externalReference ? { externalReference: activeClaim.externalReference } : {}),
      };
    }
  }

  let requestWriteAttempted = false;
  try {
    const actor = agentActorForCredential(credential);
    const requestStoreWithContext: SigningRequestStore = {
      ...requestStore,
      createRequest: async (stored: StoredSigningRequest) => {
        const note = initialPrivateNote(input.privateNote, stored.createdAt);
        requestWriteAttempted = true;
        await requestStore.createRequest({
          ...stored,
          creatorAddress: credential.principal.address,
          creatorActor: actor,
          ...(note ? { initialPrivateNote: note } : {}),
        });
      },
    };

    let snapshot: SigningRequestSnapshot;
    try {
      snapshot = await createSigningRequest(
        requestStoreWithContext,
        { network: input.network, xdr: input.xdr },
        {
          now,
          accountLoader: options.accountLoader,
          networkParametersLoader: options.networkParametersLoader,
          idFactory: () => activeClaim.requestId,
        },
      );
    } catch (cause) {
      if (!requestWriteAttempted) throw cause;
      const existing = await requestStore.getRequest(activeClaim.requestId);
      if (!existing) throw cause;
      assertReservedRequestMatchesInput(existing, input);
      snapshot = await getSigningRequest(requestStore, existing.id, options);
    }

    await bindPrincipalParticipant(
      requestStore,
      snapshot.id,
      credential.principal.address,
      activeClaim.createdAt,
    );
    await touchCredential(agentStore, credential, now);
    return {
      replayed: !claimed.claimed,
      request: snapshot,
      ...(activeClaim.externalReference ? { externalReference: activeClaim.externalReference } : {}),
    };
  } catch (cause) {
    if (claimed.claimed && !requestWriteAttempted) {
      await agentStore.releaseIdempotency(activeClaim);
    }
    throw cause;
  }
}
