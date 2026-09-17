import { blobAgentCredentialStore } from '../server/blobAgentCredentialStore.js';
import { blobAuthStore } from '../server/blobAuthStore.js';
import { blobSigningRequestStore, RequestStorageUnavailableError } from '../server/blobRequestStore.js';
import { blobSorobanIntentStore } from '../server/blobSorobanIntentStore.js';
import { authConfigForRequest } from '../server/authConfig.js';
import {
  AgentCredentialServiceError,
  agentActorForCredential,
  requireAgentAccess,
} from '../server/agentCredentialService.js';
import type { StoredSignerAgentCredential } from '../server/agentCredentialStore.js';
import { createAgentSigningRequest } from '../server/agentRequestService.js';
import { projectClassicAgentTask } from '../server/agentTaskProjection.js';
import {
  IntegrationCredentialServiceError,
} from '../server/integrationCredentialService.js';
import type { ConfiguredIntegrationCredential } from '../server/integrationCredentialService.js';
import { CallerAuthenticationError, machineCallerFromRequest, verifiedSignerSessionFromRequest } from '../server/callerAuthentication.js';
import { createIntegrationPaymentSigningRequest, createIntegrationSigningRequest } from '../server/integrationRequestService.js';
import { ClassicPaymentPrepareError, type ClassicPaymentInstruction } from '../../../../src/stellar/classicPaymentPrepare.js';
import { BoxServiceError } from '../server/boxService.js';
import {
  contributionGrantCookie,
  contributionGrantFromRequest,
  issueContributionGrant,
} from '../server/contributionGrant.js';
import {
  signerCanAccessTransaction,
  signerHasSignedTransaction,
  capabilityHashForToken,
  requestCapabilityMatches,
} from '../server/requestAccess.js';
import type { RequestAccountLoader } from '../server/requestAccess.js';
import {
  getSignerActivityItemForRequest,
  getTreasuryActivityItemForRequest,
} from '../server/requestActivity.js';
import { PrivateCommitmentValidationError, validatePrivateCommitmentForMemo } from '../server/requestPrivateCommitment.js';
import { verifySorobanRequestOrigin, SorobanRequestOriginError } from '../server/sorobanRequestOrigin.js';
import { latestPrivateNoteForRequest } from '../server/requestPrivateNote.js';
import { createCapabilityToken, isValidSigningRequestId } from '../server/requestLocator.js';
import type { StoredSigningRequest } from '../server/requestStore.js';
import { canViewTreasuryActivity } from '../server/treasuryActivityAccess.js';
import {
  contributeSigningRequest,
  createSigningRequest,
  getSigningRequest,
  getSigningRequestForStoredRequest,
  loadSigningRequestReadFacts,
  SigningRequestServiceError,
  submitSigningRequest,
} from '../server/requestService.js';
import { isValidStellarAccountId, loadAccount, loadNetworkParameters } from '../../../../src/stellar/horizon.js';
import { normalizePrivateNote } from '../../../../src/stellar/privateNote.js';
import type { PrivateNoteRevision } from '../../../../src/stellar/privateNote.js';
import type { SigningRequestApiError, SigningRequestStatus } from '../../../../src/stellar/requestTypes.js';
import type { StellarNetwork } from '../../../../src/stellar/types.js';
import { loadTransactionSourceAnalyses } from '../../../../src/stellar/transactionReviewAnalysis.js';
import { inspectTransactionXdr } from '../../../../src/stellar/transactionXdr.js';
import { transactionHashHex } from '../../../../src/stellar/signatureMerge.js';
import {
  enforcePreparedSorobanTransaction,
  SorobanSimulationError,
} from '../../../../src/stellar/sorobanRpc.js';
import { readJsonObjectBody, RequestBodyError } from '../server/requestBody.js';
import { assertDeploymentNetwork, DeploymentNetworkPolicyError } from '../server/deploymentNetworkPolicy.js';
import { noStoreJson } from '../server/httpResponse.js';
import {
  beforeFirstDurableWrite,
  enforceSemanticRateLimit,
  SEMANTIC_RATE_LIMIT_IDS,
  SemanticRateLimitError,
  semanticRateLimitKey,
} from '../server/semanticRateLimit.js';

const MAX_BODY_BYTES = 300 * 1024;
const CAPABILITY_HEADER = 'x-multisig-capability';
const REQUEST_ID_HEADER = 'x-multisig-request-id';
const serviceOptions = {
  networkParametersLoader: loadNetworkParameters,
  sorobanExecutionVerifier: async (envelopeXdr: string, network: StellarNetwork) => {
    try {
      const verified = await enforcePreparedSorobanTransaction({ envelopeXdr, network });
      return { status: 'verified' as const, effects: verified.effects };
    } catch (cause) {
      if (cause instanceof SorobanSimulationError && cause.kind === 'invalid') {
        return { status: 'invalid' as const, detail: cause.message };
      }
      return {
        status: 'unavailable' as const,
        detail: cause instanceof Error
          ? `Unable to verify Soroban execution: ${cause.message}`
          : 'Unable to verify Soroban execution.',
      };
    }
  },
};

type RequestAccessMode = 'capability' | 'session' | 'contribution' | 'agent' | 'service';
type RequestAuthorizationPurpose = 'active' | 'history';
type ClosedCapabilityStatus = Extract<SigningRequestStatus, 'submitted' | 'expired'>;

interface AuthorizedRequest {
  id: string;
  stored: StoredSigningRequest;
  mode: RequestAccessMode;
  network: StellarNetwork;
  actorAddress?: string;
  activityBound: boolean;
  capabilityMatched: boolean;
  capabilityClosed?: ClosedCapabilityStatus;
  contributionGrantExpiresAt?: number;
  agentCredential?: StoredSignerAgentCredential;
  integrationCredential?: ConfiguredIntegrationCredential;
  privateCommitment?: NonNullable<Awaited<ReturnType<typeof blobSigningRequestStore.getRequest>>>['privateCommitment'];
}

function errorResponse(cause: unknown): Response {
  if (cause instanceof DeploymentNetworkPolicyError) {
    return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
  }
  if (cause instanceof RequestBodyError) {
    return noStoreJson({ error: cause.message, code: cause.code } satisfies SigningRequestApiError, cause.status);
  }
  if (cause instanceof CallerAuthenticationError || cause instanceof AgentCredentialServiceError || cause instanceof IntegrationCredentialServiceError || cause instanceof BoxServiceError || cause instanceof ClassicPaymentPrepareError || cause instanceof SorobanRequestOriginError) {
    return noStoreJson({ error: cause.message, code: cause.code } satisfies SigningRequestApiError, cause.status);
  }
  if (cause instanceof SigningRequestServiceError) {
    return noStoreJson({
      error: cause.message,
      code: cause.code,
      ...(cause.details ? { details: cause.details } : {}),
    } satisfies SigningRequestApiError, cause.status);
  }
  if (cause instanceof SemanticRateLimitError) {
    return noStoreJson({ error: cause.message, code: cause.code } satisfies SigningRequestApiError, cause.status);
  }
  if (cause instanceof RequestStorageUnavailableError) {
    return noStoreJson({ error: cause.message, code: 'storage_not_configured' } satisfies SigningRequestApiError, 503);
  }
  console.error('Signing request API error', cause);
  return noStoreJson({ error: 'Signing request service is temporarily unavailable.', code: 'internal_error' } satisfies SigningRequestApiError, 500);
}

function requestCreationQuota(
  request: Request,
  network: StellarNetwork,
  rateLimitIdentity: string,
): () => Promise<void> {
  return beforeFirstDurableWrite(async () => {
    await enforceSemanticRateLimit(request, {
      rateLimitId: SEMANTIC_RATE_LIMIT_IDS.requestCreate,
      rateLimitKey: semanticRateLimitKey(network, rateLimitIdentity),
      errorCode: 'request_create_rate_limited',
      errorMessage: 'This identity has created too many proposals recently. Try again later.',
    });
  });
}

function requireAgentPermission(access: AuthorizedRequest, required: 'read' | 'write' | 'sign'): void {
  if (access.mode !== 'agent' || !access.agentCredential) return;
  try {
    requireAgentAccess(access.agentCredential, required);
  } catch (cause) {
    if (cause instanceof AgentCredentialServiceError) {
      throw new SigningRequestServiceError(cause.message, cause.status, cause.code);
    }
    throw cause;
  }
}

async function recordActivityBestEffort(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (cause) {
    // Signing/request state is authoritative. Activity can be reconstructed from
    // those hard facts and must not turn a successful user action into a failure.
    console.error('Signing request activity write failed', cause);
  }
}

function requestLocator(request: Request): { id: string; capability: string } {
  const id = request.headers.get(REQUEST_ID_HEADER)?.trim() ?? '';
  const capability = request.headers.get(CAPABILITY_HEADER)?.trim() ?? '';
  if (!isValidSigningRequestId(id)) {
    throw new SigningRequestServiceError('A valid signing request id is required.', 400, 'invalid_request_id');
  }
  return { id, capability };
}

async function bindRequestParticipant(id: string, address: string): Promise<void> {
  if (!blobSigningRequestStore.putRequestParticipant) return;
  await blobSigningRequestStore.putRequestParticipant(id, {
    version: 1,
    address,
    joinedAt: new Date().toISOString(),
  });
}

async function bindRequestParticipantBestEffort(id: string, address: string): Promise<boolean> {
  try {
    await bindRequestParticipant(id, address);
    return true;
  } catch (cause) {
    console.error('Signing request participant write failed', { requestId: id, address, cause });
    return false;
  }
}

function storedCapabilityStatus(
  expiresAt: string,
  submitted: boolean,
  now = new Date(),
): ClosedCapabilityStatus | undefined {
  if (submitted) return 'submitted';
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && expiry <= now.getTime() ? 'expired' : undefined;
}

function capabilityClosedResponse(network: StellarNetwork, requestStatus: ClosedCapabilityStatus): Response {
  return noStoreJson({
    error: 'This private share link no longer opens transaction details after the request is finished. Confirm an associated signer wallet to continue in Activity.',
    code: 'request_capability_closed',
    network,
    requestStatus,
  } satisfies SigningRequestApiError, 410);
}

async function authorizeRequest(
  request: Request,
  options: { purpose?: RequestAuthorizationPurpose; accountLoader?: RequestAccountLoader } = {},
): Promise<AuthorizedRequest> {
  const purpose = options.purpose ?? 'active';
  const accountLoader = options.accountLoader;
  const { id, capability } = requestLocator(request);
  const stored = await blobSigningRequestStore.getRequest(id);
  if (!stored) throw new SigningRequestServiceError('Signing request not found.', 404, 'request_not_found');
  assertDeploymentNetwork(stored.network);

  const capabilityMatched = Boolean(capability && requestCapabilityMatches(stored, capability));
  const config = authConfigForRequest(request);
  const machineCaller = await machineCallerFromRequest(blobAgentCredentialStore, request);
  const integrationCredential = machineCaller?.kind === 'service' ? machineCaller.credential : null;
  const agentCredential = machineCaller?.kind === 'agent' ? machineCaller.credential : null;
  const session = machineCaller ? null : await verifiedSignerSessionFromRequest(blobAuthStore, request, stored.network);
  const contributionGrant = await contributionGrantFromRequest(blobAuthStore, request, config);
  if (integrationCredential) {
    if (stored.integration?.serviceId !== integrationCredential.serviceId) {
      throw new SigningRequestServiceError(
        'This Integration credential does not own this Request.',
        403,
        'integration_request_access_denied',
      );
    }
    if (purpose === 'history') {
      throw new SigningRequestServiceError(
        'Integration credentials read the active Request resource, not signer-retained Activity history.',
        403,
        'integration_history_access_denied',
      );
    }
    return {
      id,
      stored,
      mode: 'service',
      network: stored.network,
      activityBound: false,
      capabilityMatched: false,
      integrationCredential,
      privateCommitment: stored.privateCommitment,
    };
  }
  if (agentCredential) {
    if (agentCredential.principal.network !== stored.network) {
      throw new SigningRequestServiceError('This Agent credential is for another Stellar network.', 403, 'principal_network_mismatch');
    }
    try {
      requireAgentAccess(agentCredential, 'read');
      if (purpose === 'active') {
        const allowed = await signerCanAccessTransaction(
          agentCredential.principal.address,
          stored.baseXdr,
          stored.network,
          accountLoader,
        );
        if (!allowed) {
          throw new SigningRequestServiceError(
            'The Agent credential Principal is not a current signer for this transaction.',
            403,
            'request_access_denied',
          );
        }
      }
    } catch (cause) {
      if (cause instanceof AgentCredentialServiceError) {
        throw new SigningRequestServiceError(cause.message, cause.status, cause.code);
      }
      throw cause;
    }
    const participant = await blobSigningRequestStore.getRequestParticipant?.(id, agentCredential.principal.address) ?? null;
    await blobAgentCredentialStore.touchCredential(agentCredential.credentialId, new Date().toISOString());
    return {
      id,
      stored,
      mode: 'agent',
      network: stored.network,
      actorAddress: agentCredential.principal.address,
      activityBound: Boolean(participant),
      capabilityMatched,
      agentCredential,
      privateCommitment: stored.privateCommitment,
    };
  }
  if (session && purpose === 'history') {
    const participant = await blobSigningRequestStore.getRequestParticipant?.(id, session.address) ?? null;
    if (participant) {
      return {
        id,
        stored,
        mode: 'session',
        network: stored.network,
        actorAddress: session.address,
        activityBound: true,
        capabilityMatched,
        privateCommitment: stored.privateCommitment,
      };
    }
  }

  if (capabilityMatched) {
    const [submission, participant] = await Promise.all([
      blobSigningRequestStore.getSubmission(id, stored.transactionHash),
      session
        ? blobSigningRequestStore.getRequestParticipant?.(id, session.address) ?? Promise.resolve(null)
        : Promise.resolve(null),
    ]);
    return {
      id,
      stored,
      mode: 'capability',
      network: stored.network,
      actorAddress: session?.address,
      activityBound: Boolean(participant),
      capabilityMatched: true,
      capabilityClosed: storedCapabilityStatus(stored.expiresAt, Boolean(submission)),
      privateCommitment: stored.privateCommitment,
    };
  }

  if (session && purpose === 'active') {
    try {
      if (await signerCanAccessTransaction(
        session.address,
        stored.baseXdr,
        stored.network,
        accountLoader,
      )) {
        return {
          id,
          stored,
          mode: 'session',
          network: stored.network,
          actorAddress: session.address,
          activityBound: false,
          capabilityMatched,
          privateCommitment: stored.privateCommitment,
        };
      }
    } catch (cause) {
      throw new SigningRequestServiceError(
        cause instanceof Error ? `Unable to verify current signer access: ${cause.message}` : 'Unable to verify current signer access.',
        503,
        'policy_unavailable',
      );
    }
  }

  if (
    contributionGrant
    && contributionGrant.requestId === id
    && contributionGrant.network === stored.network
  ) {
    return {
      id,
      stored,
      mode: 'contribution',
      network: stored.network,
      actorAddress: contributionGrant.address,
      activityBound: false,
      capabilityMatched,
      contributionGrantExpiresAt: contributionGrant.expiresAt,
      privateCommitment: stored.privateCommitment,
    };
  }

  if (session && purpose === 'history') {
    return {
      id,
      stored,
      mode: 'session',
      network: stored.network,
      actorAddress: session.address,
      activityBound: false,
      capabilityMatched,
      privateCommitment: stored.privateCommitment,
    };
  }

  throw new SigningRequestServiceError(
    'This signing request requires its private share link or an authorized signer session.',
    403,
    'request_access_denied',
  );
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  return readJsonObjectBody(request, MAX_BODY_BYTES);
}

function privateCommitmentForCreate(body: Record<string, unknown>, xdr: string) {
  if (body.privateCommitment === undefined || body.privateCommitment === null) return undefined;
  if (body.network !== 'public' && body.network !== 'testnet') {
    throw new SigningRequestServiceError('Network must be public or testnet.', 400, 'invalid_network');
  }
  let memo;
  try {
    memo = inspectTransactionXdr(xdr, body.network).memo;
  } catch (cause) {
    throw new SigningRequestServiceError(
      cause instanceof Error ? cause.message : 'Invalid transaction envelope XDR.',
      400,
      'invalid_xdr',
    );
  }
  try {
    return validatePrivateCommitmentForMemo(body.privateCommitment, memo, new Date().toISOString());
  } catch (cause) {
    if (cause instanceof PrivateCommitmentValidationError) {
      throw new SigningRequestServiceError(cause.message, 400, 'invalid_private_commitment');
    }
    throw cause;
  }
}

function privateNoteForCreate(body: Record<string, unknown>): string | undefined {
  if (body.privateNote === undefined || body.privateNote === null) return undefined;
  if (typeof body.privateNote !== 'string') {
    throw new SigningRequestServiceError('Private note must be text.', 400, 'invalid_private_note');
  }
  try {
    return normalizePrivateNote(body.privateNote);
  } catch (cause) {
    throw new SigningRequestServiceError(
      cause instanceof Error ? cause.message : 'Invalid private note.',
      400,
      'invalid_private_note',
    );
  }
}

function initialPrivateNote(text: string, createdAt: string): PrivateNoteRevision {
  return {
    version: 1,
    revisionId: 'initial',
    text,
    createdAt,
  };
}

async function viewerDeclined(requestId: string, actorAddress?: string): Promise<boolean> {
  if (!actorAddress || !blobSigningRequestStore.listActivityEvents) return false;
  const events = await blobSigningRequestStore.listActivityEvents(requestId);
  return events.some((item) => item.type === 'approval_declined' && item.actorAddress === actorAddress);
}

async function recordDecline(requestId: string, actorAddress: string): Promise<void> {
  const stored = await blobSigningRequestStore.getRequest(requestId);
  if (!stored) throw new SigningRequestServiceError('Signing request not found.', 404, 'request_not_found');
  const allowed = await signerCanAccessTransaction(actorAddress, stored.baseXdr, stored.network);
  if (!allowed) throw new SigningRequestServiceError('Only a current signer can decline this proposal.', 403, 'decline_not_authorized');
  const snapshot = await getSigningRequest(blobSigningRequestStore, requestId, serviceOptions);
  if (snapshot.status !== 'awaiting_signatures') {
    throw new SigningRequestServiceError('This proposal is no longer waiting for signer decisions.', 409, 'request_not_declinable');
  }
  if (signerHasSignedTransaction(actorAddress, snapshot.mergedXdr, snapshot.network)) {
    throw new SigningRequestServiceError('This signer already approved the proposal and cannot decline it afterward.', 409, 'proposal_already_approved');
  }
  await bindRequestParticipant(requestId, actorAddress);
  if (blobSigningRequestStore.putActivityEvent) {
    await blobSigningRequestStore.putActivityEvent(requestId, {
      version: 1,
      eventId: `declined-${actorAddress}`,
      requestId,
      type: 'approval_declined',
      occurredAt: new Date().toISOString(),
      actorAddress,
      detail: 'Signer declined this proposal. The request remains open for other signers until it is replaced, submitted, or expires.',
    });
  }
}

function agentRequestTask(access: AuthorizedRequest, snapshot: Awaited<ReturnType<typeof getSigningRequest>>, declined = false) {
  if (access.mode !== 'agent' || !access.agentCredential) return undefined;
  return projectClassicAgentTask({
    request: snapshot,
    credentialAccess: access.agentCredential.access,
    hasSigned: signerHasSignedTransaction(
      access.agentCredential.principal.address,
      snapshot.mergedXdr,
      snapshot.network,
    ),
    declined,
  });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const historyRequested = url.searchParams.get('view') === 'history';
    const historyAccountId = url.searchParams.get('account')?.trim() ?? '';
    if (historyAccountId && !isValidStellarAccountId(historyAccountId)) {
      throw new SigningRequestServiceError('Enter a valid Stellar account.', 400, 'invalid_account');
    }
    const accountCache = new Map<string, ReturnType<typeof loadAccount>>();
    const accountLoader: typeof loadAccount = (accountId, network) => {
      const key = `${network}:${accountId}`;
      const cached = accountCache.get(key);
      if (cached) return cached;
      const pending = loadAccount(accountId, network);
      accountCache.set(key, pending);
      return pending;
    };
    const access = await authorizeRequest(request, {
      purpose: historyRequested ? 'history' : 'active',
      ...(historyRequested ? { accountLoader } : {}),
    });
    if (access.mode === 'capability' && access.capabilityClosed) {
      return capabilityClosedResponse(access.network, access.capabilityClosed);
    }

    if (historyRequested && (!access.actorAddress || !['session', 'contribution', 'agent'].includes(access.mode))) {
      throw new SigningRequestServiceError(
        'Unlock an authorized signer wallet to view retained transaction history.',
        403,
        'history_access_denied',
      );
    }
    if (historyRequested && historyAccountId && access.mode === 'contribution') {
      throw new SigningRequestServiceError(
        'Confirm the signer wallet before opening Treasury-wide history.',
        403,
        'treasury_access_denied',
      );
    }

    let activityBound = access.activityBound;

    const readFactsPromise = historyRequested
      ? loadSigningRequestReadFacts(blobSigningRequestStore, access.stored)
      : null;
    const privateNoteRevisionsPromise = historyRequested
      ? blobSigningRequestStore.listPrivateNoteRevisions?.(access.id) ?? Promise.resolve([])
      : null;
    const snapshotPromise = historyRequested
      ? readFactsPromise!.then((readFacts) => getSigningRequestForStoredRequest(
          blobSigningRequestStore,
          access.stored,
          { ...serviceOptions, accountLoader },
          readFacts,
        ))
      : getSigningRequestForStoredRequest(blobSigningRequestStore, access.stored, serviceOptions);
    const privateNotePromise = historyRequested
      ? privateNoteRevisionsPromise!.then((revisions) => latestPrivateNoteForRequest(
          blobSigningRequestStore,
          access.stored,
          revisions,
        ))
      : latestPrivateNoteForRequest(blobSigningRequestStore, access.stored);
    const sourceAnalysesPromise = historyRequested
      ? loadTransactionSourceAnalyses(
          inspectTransactionXdr(access.stored.baseXdr, access.stored.network),
          access.stored.network,
          accountLoader,
        )
      : null;

    const snapshot = await snapshotPromise;
    if (access.mode === 'capability' && (snapshot.status === 'submitted' || snapshot.status === 'expired')) {
      return capabilityClosedResponse(snapshot.network, snapshot.status);
    }

    let declined = false;
    let history;
    if (historyRequested) {
      const [readFacts, privateNoteRevisions] = await Promise.all([
        readFactsPromise!,
        privateNoteRevisionsPromise!,
      ]);
      const historyFacts = snapshot.submission && !readFacts.submission
        ? {
            ...readFacts,
            submission: {
              version: 1 as const,
              transactionHash: snapshot.submission.transactionHash,
              ledger: snapshot.submission.ledger,
              submittedAt: snapshot.submission.submittedAt,
            },
          }
        : readFacts;
      const activityPromise = (async () => {
        if (historyAccountId) {
          const account = await accountLoader(historyAccountId, snapshot.network);
          if (!canViewTreasuryActivity(account, access.actorAddress!)) {
            throw new SigningRequestServiceError(
              'This wallet is not a current signer for this treasury.',
              403,
              'treasury_access_denied',
            );
          }
          const knownSignerAddresses = account.signers
            .filter((signer) => signer.weight > 0)
            .map((signer) => signer.key);
          return getTreasuryActivityItemForRequest(
            blobSigningRequestStore,
            access.actorAddress!,
            access.stored,
            historyAccountId,
            { network: snapshot.network, knownSignerAddresses },
            historyFacts,
            privateNoteRevisions,
          );
        }
        return getSignerActivityItemForRequest(
          blobSigningRequestStore,
          access.actorAddress!,
          access.stored,
          { network: snapshot.network },
          historyFacts,
          privateNoteRevisions,
        );
      })();
      const [activity, sourceAnalyses] = await Promise.all([activityPromise, sourceAnalysesPromise!]);
      if (!activity) {
        throw new SigningRequestServiceError(
          'This wallet has no retained history access for this proposal.',
          403,
          'history_access_denied',
        );
      }
      if (!historyAccountId) activityBound = true;
      declined = activity.events.some((item) =>
        item.type === 'approval_declined' && item.actorAddress === access.actorAddress,
      );
      history = { activity, sourceAnalyses };
    } else {
      declined = await viewerDeclined(access.id, access.actorAddress);
    }
    let privateNote = await privateNotePromise;
    if ((access.mode === 'agent' && !activityBound) || access.mode === 'service') privateNote = undefined;
    return noStoreJson({
      request: snapshot,
      access: {
        shareable: access.capabilityMatched,
        activityBound,
        ...(declined ? { viewerDecision: 'declined' as const } : {}),
        ...(access.contributionGrantExpiresAt ? { contributionGrantExpiresAt: access.contributionGrantExpiresAt } : {}),
      },
      context: {
        ...(privateNote ? { privateNote } : {}),
        ...(access.privateCommitment ? { privateCommitment: access.privateCommitment } : {}),
      },
      ...(history ? { history } : {}),
      ...(access.mode === 'agent' ? { task: agentRequestTask(access, snapshot, declined) } : {}),
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody(request);
    const xdr = typeof body.xdr === 'string' ? body.xdr : '';
    const machineCaller = await machineCallerFromRequest(blobAgentCredentialStore, request);
    const integrationCredential = machineCaller?.kind === 'service' ? machineCaller.credential : null;
    const agentCredential = machineCaller?.kind === 'agent' ? machineCaller.credential : null;
    if (integrationCredential) {
      if (body.sorobanIntentId !== undefined) {
        throw new SigningRequestServiceError('Soroban Intent Proposal linkage is available only through verified Human workflow handoff in this version.', 400, 'soroban_origin_unsupported');
      }
      if (body.network !== 'public' && body.network !== 'testnet') {
        throw new SigningRequestServiceError('Network must be public or testnet.', 400, 'invalid_network');
      }
      assertDeploymentNetwork(body.network);
      if (body.privateNote !== undefined && body.privateNote !== null && body.privateNote !== '') {
        throw new SigningRequestServiceError(
          'Integration Request creation uses Private Commitment for private context in this version.',
          400,
          'integration_private_note_unsupported',
        );
      }
      const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? '';
      if (!idempotencyKey) {
        throw new SigningRequestServiceError('Idempotency-Key header is required for Integration Request creation.', 400, 'idempotency_key_required');
      }
      if (body.payment !== undefined) {
        if (xdr.trim()) {
          throw new SigningRequestServiceError('Provide either semantic payment input or exact XDR, not both.', 400, 'conflicting_request_input');
        }
        if (!body.payment || typeof body.payment !== 'object' || Array.isArray(body.payment)) {
          throw new ClassicPaymentPrepareError('Payment instruction must be an object.', 400, 'invalid_payments');
        }
        if (body.privateCommitment !== undefined && body.privateCommitment !== null) {
          throw new SigningRequestServiceError(
            'Semantic Integration payment creation does not support Private Commitment in this version.',
            400,
            'integration_semantic_payment_private_commitment_unsupported',
          );
        }
        const beforeCreate = requestCreationQuota(request, body.network, `service:${integrationCredential.serviceId}`);
        const quotaRequestStore = {
          ...blobSigningRequestStore,
          createRequest: async (stored: Parameters<typeof blobSigningRequestStore.createRequest>[0]) => {
            await beforeCreate();
            return blobSigningRequestStore.createRequest(stored);
          },
        };
        const result = await createIntegrationPaymentSigningRequest(
          quotaRequestStore,
          integrationCredential,
          {
            network: body.network,
            payment: body.payment as Omit<ClassicPaymentInstruction, 'network'>,
            idempotencyKey,
            externalReference: body.externalReference,
          },
          { ...serviceOptions, accountLoader: loadAccount },
        );
        return noStoreJson({
          request: result.request,
          replayed: result.replayed,
          ...(result.externalReference ? { externalReference: result.externalReference } : {}),
          access: { shareable: false, activityBound: false },
          context: {},
        }, result.replayed ? 200 : 201);
      }
      if (!xdr.trim()) {
        throw new SigningRequestServiceError('Provide semantic payment input or transaction envelope XDR.', 400, 'invalid_request_input');
      }
      const privateCommitment = privateCommitmentForCreate(body, xdr);
      const beforeCreate = requestCreationQuota(request, body.network, `service:${integrationCredential.serviceId}`);
      const quotaRequestStore = {
        ...blobSigningRequestStore,
        createRequest: async (stored: Parameters<typeof blobSigningRequestStore.createRequest>[0]) => {
          await beforeCreate();
          return blobSigningRequestStore.createRequest(stored);
        },
      };
      const result = await createIntegrationSigningRequest(
        quotaRequestStore,
        integrationCredential,
        {
          network: body.network,
          xdr,
          idempotencyKey,
          externalReference: body.externalReference,
          privateCommitment,
        },
        { ...serviceOptions, accountLoader: loadAccount },
      );
      return noStoreJson({
        request: result.request,
        replayed: result.replayed,
        ...(result.externalReference ? { externalReference: result.externalReference } : {}),
        access: { shareable: false, activityBound: false },
        context: {
          ...(privateCommitment ? { privateCommitment: { ...privateCommitment, createdAt: result.request.createdAt } } : {}),
        },
      }, result.replayed ? 200 : 201);
    }
    if (agentCredential) {
      if (body.sorobanIntentId !== undefined) {
        throw new SigningRequestServiceError('Soroban Intent Proposal linkage is available only through verified Human workflow handoff in this version.', 400, 'soroban_origin_unsupported');
      }
      if (body.network !== 'public' && body.network !== 'testnet') {
        throw new SigningRequestServiceError('Network must be public or testnet.', 400, 'invalid_network');
      }
      assertDeploymentNetwork(body.network);
      if (!xdr.trim()) {
        throw new SigningRequestServiceError('Transaction envelope XDR is required.', 400, 'invalid_xdr');
      }
      if (body.privateCommitment !== undefined && body.privateCommitment !== null) {
        throw new SigningRequestServiceError(
          'Agent Request creation does not support Private Commitment in this version.',
          400,
          'agent_private_commitment_unsupported',
        );
      }
      const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? '';
      if (!idempotencyKey) {
        throw new SigningRequestServiceError('Idempotency-Key header is required for Agent Request creation.', 400, 'idempotency_key_required');
      }
      const privateNoteText = privateNoteForCreate(body);
      const beforeCreate = requestCreationQuota(request, body.network, agentCredential.principal.address);
      const quotaAgentStore = {
        ...blobAgentCredentialStore,
        claimIdempotency: async (...args: Parameters<typeof blobAgentCredentialStore.claimIdempotency>) => {
          await beforeCreate();
          return blobAgentCredentialStore.claimIdempotency(...args);
        },
      };
      const result = await createAgentSigningRequest(
        quotaAgentStore,
        blobSigningRequestStore,
        agentCredential,
        {
          network: body.network,
          xdr,
          idempotencyKey,
          externalReference: body.externalReference,
          privateNote: privateNoteText,
        },
        { ...serviceOptions, accountLoader: loadAccount },
      );
      return noStoreJson({
        request: result.request,
        replayed: result.replayed,
        ...(result.externalReference ? { externalReference: result.externalReference } : {}),
        access: { shareable: false, activityBound: true },
        context: {
          ...(privateNoteText ? { privateNote: initialPrivateNote(privateNoteText, result.request.createdAt) } : {}),
        },
        task: projectClassicAgentTask({
          request: result.request,
          credentialAccess: agentCredential.access,
          hasSigned: signerHasSignedTransaction(agentCredential.principal.address, result.request.mergedXdr, result.request.network),
        }),
      }, result.replayed ? 200 : 201);
    }
    const privateCommitment = privateCommitmentForCreate(body, xdr);
    const privateNoteText = privateNoteForCreate(body);
    if (privateCommitment && privateNoteText) {
      throw new SigningRequestServiceError(
        'Private note and Private Commitment are mutually exclusive request context modes.',
        400,
        'conflicting_private_context',
      );
    }
    const requestNetwork = body.network === 'public' || body.network === 'testnet' ? body.network : null;
    if (!requestNetwork) {
      throw new SigningRequestServiceError('Network must be public or testnet.', 400, 'invalid_network');
    }
    assertDeploymentNetwork(requestNetwork);
    const creatorSession = await verifiedSignerSessionFromRequest(blobAuthStore, request, requestNetwork);
    if (!creatorSession) {
      throw new SigningRequestServiceError(
        'Unlock a signer wallet before starting a durable proposal.',
        401,
        'request_creator_identity_required',
      );
    }
    const accountCache = new Map<string, ReturnType<typeof loadAccount>>();
    const accountLoader: typeof loadAccount = (accountId, network) => {
      const key = `${network}:${accountId}`;
      const cached = accountCache.get(key);
      if (cached) return cached;
      const pending = loadAccount(accountId, network);
      accountCache.set(key, pending);
      return pending;
    };
    const creatorCanAccess = await signerCanAccessTransaction(
      creatorSession.address,
      xdr,
      requestNetwork,
      accountLoader,
    );
    if (!creatorCanAccess) {
      throw new SigningRequestServiceError(
        'The confirmed wallet is not a current signer for this transaction.',
        403,
        'request_creator_not_signer',
      );
    }
    if (body.sorobanIntentId !== undefined && typeof body.sorobanIntentId !== 'string') {
      throw new SorobanRequestOriginError('Invalid Soroban Intent id.', 400, 'invalid_soroban_intent_id');
    }
    const sorobanIntentId = typeof body.sorobanIntentId === 'string' ? body.sorobanIntentId.trim().toUpperCase() : '';
    const sorobanOrigin = body.sorobanIntentId !== undefined
      ? await verifySorobanRequestOrigin(blobSorobanIntentStore, {
          intentId: sorobanIntentId,
          network: requestNetwork,
          transactionHash: transactionHashHex(xdr, requestNetwork),
        })
      : undefined;
    const capability = createCapabilityToken();
    const beforeCreate = requestCreationQuota(request, requestNetwork, creatorSession.address);
    const requestStore = {
      ...blobSigningRequestStore,
      createRequest: async (stored: Parameters<typeof blobSigningRequestStore.createRequest>[0]) => {
        await beforeCreate();
        return blobSigningRequestStore.createRequest({
          ...stored,
          creatorAddress: creatorSession.address,
          ...(privateNoteText ? { initialPrivateNote: initialPrivateNote(privateNoteText, stored.createdAt) } : {}),
          ...(privateCommitment ? { privateCommitment: { ...privateCommitment, createdAt: stored.createdAt } } : {}),
        });
      },
    };
    const result = await createSigningRequest(
      requestStore,
      { network: body.network, xdr },
      {
        ...serviceOptions,
        accountLoader,
        capabilityHash: capabilityHashForToken(capability),
        ...(sorobanOrigin ? { sorobanOrigin, executionPolicy: { mode: 'multisigtools' as const } } : {}),
      },
    );
    const activityBound = creatorSession
      ? await bindRequestParticipantBestEffort(result.id, creatorSession.address)
      : false;
    return noStoreJson({
      request: result,
      capability,
      access: { shareable: true, activityBound },
      context: {
        ...(privateNoteText ? { privateNote: initialPrivateNote(privateNoteText, result.createdAt) } : {}),
        ...(privateCommitment ? { privateCommitment } : {}),
      },
    }, 201);
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const access = await authorizeRequest(request);
    const body = await readJsonBody(request);
    if (access.mode === 'service') {
      throw new SigningRequestServiceError(
        'Integration credentials can inspect their own Request but cannot contribute signer decisions or Stellar authorization.',
        403,
        'integration_request_write_denied',
      );
    }
    const isSignatureContribution = typeof body.signedXdr === 'string'
      && body.signedXdr.trim().length > 0
      && body.retainActivity !== true
      && body.decision !== 'decline'
      && typeof body.privateNote !== 'string';
    if (access.mode === 'contribution' && !access.capabilityMatched && !isSignatureContribution) {
      throw new SigningRequestServiceError(
        'This short-lived signing continuation can add another valid signature, but changing proposal metadata still requires the private link or a confirmed signer session.',
        403,
        'request_write_denied',
      );
    }
    if (access.mode === 'capability') {
      if (access.capabilityClosed) return capabilityClosedResponse(access.network, access.capabilityClosed);
      const current = await getSigningRequest(blobSigningRequestStore, access.id, serviceOptions);
      if (current.status === 'submitted' || current.status === 'expired') {
        return capabilityClosedResponse(current.network, current.status);
      }
    }

    if (access.mode === 'agent') {
      requireAgentPermission(access, body.decision === 'decline' ? 'write' : 'sign');
    }
    if (body.retainActivity === true) {
      if (!access.actorAddress || !['session', 'capability'].includes(access.mode)) {
        throw new SigningRequestServiceError(
          'Confirm a current signer wallet before saving this proposal to Activity.',
          403,
          'history_access_denied',
        );
      }
      const allowed = await signerCanAccessTransaction(
        access.actorAddress,
        access.stored.baseXdr,
        access.stored.network,
      );
      if (!allowed) {
        throw new SigningRequestServiceError(
          'Only a current signer can save this active proposal to retained Activity.',
          403,
          'history_access_denied',
        );
      }
      const snapshot = await getSigningRequest(blobSigningRequestStore, access.id, serviceOptions);
      if (snapshot.status === 'submitted' || snapshot.status === 'expired') {
        throw new SigningRequestServiceError(
          'This proposal is already closed. Retained Activity access must be established while it is active.',
          409,
          'history_access_denied',
        );
      }
      await bindRequestParticipant(access.id, access.actorAddress);
      return noStoreJson({
        request: snapshot,
        access: { shareable: access.capabilityMatched, activityBound: true },
      });
    }
    if (typeof body.privateNote === 'string') {
      throw new SigningRequestServiceError(
        'Private proposal context is frozen once signing begins. Create a replacement proposal to change it.',
        409,
        'private_note_immutable',
      );
    }
    if (body.decision === 'decline') {
      if (!access.actorAddress) {
        throw new SigningRequestServiceError('Unlock a signer wallet before declining this proposal.', 401, 'decline_identity_required');
      }
      await recordDecline(access.id, access.actorAddress);
      const snapshot = await getSigningRequest(blobSigningRequestStore, access.id, serviceOptions);
      return noStoreJson({
        request: snapshot,
        decision: 'declined' as const,
        ...(access.mode === 'agent' ? { task: agentRequestTask(access, snapshot, true) } : {}),
      });
    }

    const signedXdr = typeof body.signedXdr === 'string' ? body.signedXdr : '';
    const result = await contributeSigningRequest(
      blobSigningRequestStore,
      access.id,
      signedXdr,
      access.mode === 'agent' && access.agentCredential
        ? {
            ...serviceOptions,
            expectedSignerAddress: access.agentCredential.principal.address,
            contributionActor: agentActorForCredential(access.agentCredential),
          }
        : serviceOptions,
    );
    for (const signerAddress of result.acceptedSignerAddresses) {
      await bindRequestParticipantBestEffort(access.id, signerAddress);
    }

    if (
      access.mode !== 'agent'
      && result.addedSignatureCount === 1
      && result.contributionDigest
      && result.acceptedSignerAddresses.length === 1
    ) {
      try {
        const signerAddress = result.acceptedSignerAddresses[0];
        const issued = await issueContributionGrant(blobAuthStore, {
          address: signerAddress,
          network: result.request.network,
          requestId: result.request.id,
          contributionDigest: result.contributionDigest,
        }, authConfigForRequest(request));
        return noStoreJson(
          {
            request: result.request,
            addedSignatureCount: result.addedSignatureCount,
            duplicateSignatureCount: result.duplicateSignatureCount,
            access: { contributionGrantExpiresAt: issued.grant.expiresAt },
          },
          200,
          { 'Set-Cookie': contributionGrantCookie(issued.token) },
        );
      } catch (cause) {
        // The contribution is already a durable canonical fact. A convenience
        // continuation grant must never turn a successful signature into a 5xx.
        console.error('Contribution grant issuance failed', { requestId: access.id, cause });
      }
    }

    return noStoreJson({
      request: result.request,
      addedSignatureCount: result.addedSignatureCount,
      duplicateSignatureCount: result.duplicateSignatureCount,
      ...(access.contributionGrantExpiresAt
        ? { access: { contributionGrantExpiresAt: access.contributionGrantExpiresAt } }
        : {}),
      ...(access.mode === 'agent' ? { task: agentRequestTask(access, result.request) } : {}),
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const access = await authorizeRequest(request);
    if (access.stored.executionPolicy?.mode === 'external') {
      throw new SigningRequestServiceError(
        'This Request is externally executed. MultiSigTools coordinates signer authorization but does not broadcast the final transaction.',
        409,
        'external_executor_required',
      );
    }
    if (access.mode === 'service') {
      throw new SigningRequestServiceError(
        'Integration credentials can coordinate and inspect Classic Requests but cannot trigger MultiSigTools network submission.',
        403,
        'integration_submit_denied',
      );
    }
    if (access.mode === 'agent') {
      throw new SigningRequestServiceError(
        'Agent credentials cannot submit transactions to Stellar. Sign access contributes authorization; final network submission remains a separate action.',
        403,
        'agent_submit_denied',
      );
    }
    // A contribution grant is issued only after this server accepts an exact
    // Stellar signature for this Request. Final submission broadcasts the
    // already-authorized merged XDR; it does not mutate proposal intent.
    if (access.mode === 'capability' && access.capabilityClosed) {
      return capabilityClosedResponse(access.network, access.capabilityClosed);
    }
    if (access.mode === 'capability') {
      const current = await getSigningRequest(blobSigningRequestStore, access.id, serviceOptions);
      if (current.status === 'submitted' || current.status === 'expired') {
        return capabilityClosedResponse(current.network, current.status);
      }
    }
    const submitBody = request.headers.get('content-type')?.toLowerCase().includes('application/json')
      ? await readJsonBody(request)
      : {};
    const snapshot = await submitSigningRequest(blobSigningRequestStore, access.id, {
      ...serviceOptions,
      acceptedEffectsDigest: typeof submitBody.acceptedEffectsDigest === 'string'
        ? submitBody.acceptedEffectsDigest
        : undefined,
      submittedByAddress: access.actorAddress,
    });
    if (access.mode === 'session' && access.actorAddress && !access.activityBound) {
      await bindRequestParticipantBestEffort(snapshot.id, access.actorAddress);
    }
    return noStoreJson({ request: snapshot });
  } catch (cause) {
    return errorResponse(cause);
  }
}
