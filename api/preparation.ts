import { blobAgentCredentialStore } from '../server/blobAgentCredentialStore.js';
import { blobAuthStore } from '../server/blobAuthStore.js';
import { blobSigningRequestStore, RequestStorageUnavailableError } from '../server/blobRequestStore.js';
import { blobSorobanPreparationStore } from '../server/blobSorobanPreparationStore.js';
import { authConfigForRequest } from '../server/authConfig.js';
import { AuthServiceError, privateWorkspaceSessionFromRequest } from '../server/authService.js';
import {
  AgentCredentialServiceError,
  agentActorForCredential,
  authenticateAgentCredential,
  requireAgentAccess,
} from '../server/agentCredentialService.js';
import type { StoredSignerAgentCredential } from '../server/agentCredentialStore.js';
import { createAgentSorobanPreparation } from '../server/agentSorobanPreparationService.js';
import { BoxServiceError } from '../server/boxService.js';
import { assertDeploymentNetwork, DeploymentNetworkPolicyError } from '../server/deploymentNetworkPolicy.js';
import { noStoreJson, publicCorsHeaders } from '../server/httpResponse.js';
import { readJsonObjectBody, RequestBodyError } from '../server/requestBody.js';
import { capabilityHashForToken, requestCapabilityMatches } from '../server/requestAccess.js';
import { createCapabilityToken, isValidSigningRequestId } from '../server/requestLocator.js';
import {
  contributeSorobanPreparation,
  createSorobanPreparation,
  freezeSorobanPreparation,
  getSorobanPreparation,
  preparationViewerAction,
  refreshSorobanPreparationAuthorizationWindow,
  SorobanPreparationServiceError,
} from '../server/sorobanPreparationService.js';
import {
  beforeFirstDurableWrite,
  enforceSemanticRateLimit,
  SEMANTIC_RATE_LIMIT_IDS,
  SemanticRateLimitError,
  semanticRateLimitKey,
} from '../server/semanticRateLimit.js';
import { loadAccount, loadNetworkParameters } from '../src/stellar/horizon.js';
import type { SorobanPreparationApiError } from '../src/stellar/sorobanPreparationTypes.js';
import type { StellarNetwork } from '../src/stellar/types.js';
import { enforcePreparedSorobanTransaction, prepareEnforcedSorobanTransaction, SorobanSimulationError } from '../src/stellar/sorobanRpc.js';

const MAX_BODY_BYTES = 300 * 1024;
const CAPABILITY_HEADER = 'x-multisig-capability';
const REQUEST_ID_HEADER = 'x-multisig-request-id';
const METHODS = 'GET, POST, PATCH, PUT, OPTIONS';
const CORS_HEADERS = {
  ...publicCorsHeaders(METHODS),
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, X-MultiSig-Capability, X-MultiSig-Request-Id',
};

function json(data: unknown, status = 200): Response {
  return noStoreJson(data, status, CORS_HEADERS);
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function errorResponse(cause: unknown): Response {
  if (cause instanceof DeploymentNetworkPolicyError) {
    return json({ error: cause.message, code: cause.code }, cause.status);
  }
  if (cause instanceof RequestBodyError || cause instanceof AuthServiceError || cause instanceof AgentCredentialServiceError || cause instanceof BoxServiceError || cause instanceof SorobanPreparationServiceError) {
    return json({ error: cause.message, code: cause.code } satisfies SorobanPreparationApiError, cause.status);
  }
  if (cause instanceof SemanticRateLimitError) {
    return json({ error: cause.message, code: cause.code } satisfies SorobanPreparationApiError, cause.status);
  }
  if (cause instanceof RequestStorageUnavailableError) {
    return json({ error: cause.message, code: 'storage_not_configured' } satisfies SorobanPreparationApiError, 503);
  }
  console.error('Soroban preparation API error', cause);
  return json({ error: 'Contract authorization service is temporarily unavailable.', code: 'internal_error' } satisfies SorobanPreparationApiError, 500);
}

function locator(request: Request) {
  const id = request.headers.get(REQUEST_ID_HEADER)?.trim().toUpperCase() ?? '';
  const capability = request.headers.get(CAPABILITY_HEADER)?.trim().toUpperCase() ?? '';
  if (!isValidSigningRequestId(id)) {
    throw new SorobanPreparationServiceError('A valid authorization request id is required.', 400, 'invalid_request_id');
  }
  return { id, capability };
}

async function sessionFor(request: Request, network: StellarNetwork) {
  try {
    const session = await privateWorkspaceSessionFromRequest(blobAuthStore, request, authConfigForRequest(request));
    return session && session.network === network ? session : null;
  } catch (cause) {
    if (cause instanceof AuthServiceError) return null;
    throw cause;
  }
}

async function agentCredentialFor(request: Request): Promise<StoredSignerAgentCredential | null> {
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) throw new AgentCredentialServiceError('Invalid Agent authorization header.', 401, 'invalid_agent_credential');
  return authenticateAgentCredential(blobAgentCredentialStore, match[1].trim());
}

function isCurrentSigner(address: string, preparation: Awaited<ReturnType<typeof getSorobanPreparation>>): boolean {
  return preparation.transactionSignerKeys.includes(address)
    || preparation.authorizers.some((authorizer) =>
      authorizer.activeSigners.some((signer) => signer.publicKey === address));
}

async function storedAccess(request: Request) {
  const { id, capability } = locator(request);
  const stored = await blobSorobanPreparationStore.getPreparation(id);
  if (!stored) throw new SorobanPreparationServiceError('Authorization request not found.', 404, 'preparation_not_found');
  assertDeploymentNetwork(stored.network);
  const capabilityMatched = Boolean(capability && requestCapabilityMatches(stored, capability));
  const agent = await agentCredentialFor(request);
  const session = agent ? null : await sessionFor(request, stored.network);
  const preparation = await getSorobanPreparation(blobSorobanPreparationStore, id, {
    accountLoader: loadAccount,
    networkParametersLoader: loadNetworkParameters,
  });
  if (agent) {
    requireAgentAccess(agent, 'read');
    if (agent.principal.network !== stored.network || !isCurrentSigner(agent.principal.address, preparation)) {
      throw new SorobanPreparationServiceError(
        'The Agent credential Principal is not a current signer for this contract authorization.',
        403,
        'preparation_access_denied',
      );
    }
    await blobAgentCredentialStore.touchCredential(agent.credentialId, new Date().toISOString());
  } else if (!capabilityMatched && (!session || !isCurrentSigner(session.address, preparation))) {
    throw new SorobanPreparationServiceError(
      'This authorization request requires its private share link or a current signer session.',
      403,
      'preparation_access_denied',
    );
  }
  return { id, capability, capabilityMatched, session, agent, stored, preparation };
}

const executionVerifier = async (envelopeXdr: string, network: StellarNetwork) => {
  try {
    await enforcePreparedSorobanTransaction({ envelopeXdr, network });
    return { status: 'verified' as const };
  } catch (cause) {
    if (cause instanceof SorobanSimulationError && cause.kind === 'invalid') {
      return { status: 'invalid' as const, detail: cause.message };
    }
    return {
      status: 'unavailable' as const,
      detail: cause instanceof Error ? `Unable to verify Soroban execution: ${cause.message}` : 'Unable to verify Soroban execution.',
    };
  }
};

export async function GET(request: Request): Promise<Response> {
  try {
    const access = await storedAccess(request);
    const actorAddress = access.agent?.principal.address ?? access.session?.address;
    return json({
      operation: 'contract.authorization.inspect',
      version: 1,
      preparation: access.preparation,
      access: {
        shareable: access.capabilityMatched,
        ...(actorAddress ? { viewerAction: preparationViewerAction(actorAddress, access.preparation) } : {}),
      },
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonObjectBody(request, MAX_BODY_BYTES);
    const network = body.network === 'public' || body.network === 'testnet' ? body.network : null;
    const xdr = typeof body.xdr === 'string' ? body.xdr : '';
    if (!network) throw new SorobanPreparationServiceError('Network must be public or testnet.', 400, 'invalid_network');
    assertDeploymentNetwork(network);
    const agent = await agentCredentialFor(request);
    if (agent) {
      const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? '';
      if (!idempotencyKey) {
        throw new SorobanPreparationServiceError('Idempotency-Key header is required for Agent authorization creation.', 400, 'idempotency_key_required');
      }
      const beforeCreate = beforeFirstDurableWrite(async () => {
        await enforceSemanticRateLimit(request, {
          rateLimitId: SEMANTIC_RATE_LIMIT_IDS.requestCreate,
          rateLimitKey: semanticRateLimitKey(network, agent.principal.address),
          errorCode: 'request_create_rate_limited',
          errorMessage: 'This signer has created too many authorization requests recently. Try again later.',
        });
      });
      const quotaStore = {
        ...blobAgentCredentialStore,
        claimIdempotency: async (...args: Parameters<typeof blobAgentCredentialStore.claimIdempotency>) => {
          await beforeCreate();
          return blobAgentCredentialStore.claimIdempotency(...args);
        },
      };
      const result = await createAgentSorobanPreparation(
        quotaStore,
        blobSorobanPreparationStore,
        agent,
        { network, xdr, idempotencyKey },
        { accountLoader: loadAccount, networkParametersLoader: loadNetworkParameters },
      );
      return json({
        operation: 'contract.authorization.create',
        version: 1,
        preparation: result.preparation,
        replayed: result.replayed,
        access: {
          shareable: false,
          viewerAction: preparationViewerAction(agent.principal.address, result.preparation),
        },
      }, result.replayed ? 200 : 201);
    }
    const session = await sessionFor(request, network);
    if (!session) {
      throw new SorobanPreparationServiceError('Confirm a current signer wallet before starting shared contract authorization.', 401, 'preparation_creator_required');
    }
    const capability = createCapabilityToken();
    const beforeCreate = beforeFirstDurableWrite(async () => {
      await enforceSemanticRateLimit(request, {
        rateLimitId: SEMANTIC_RATE_LIMIT_IDS.requestCreate,
        rateLimitKey: semanticRateLimitKey(network, session.address),
        errorCode: 'request_create_rate_limited',
        errorMessage: 'This signer has created too many authorization requests recently. Try again later.',
      });
    });
    const preparation = await createSorobanPreparation(
      blobSorobanPreparationStore,
      { network, xdr },
      {
        creatorAddress: session.address,
        capabilityHash: capabilityHashForToken(capability),
        accountLoader: loadAccount,
        networkParametersLoader: loadNetworkParameters,
        beforeCreate,
      },
    );
    return json({
      operation: 'contract.authorization.create',
      version: 1,
      preparation,
      capability,
      access: { shareable: true, viewerAction: preparationViewerAction(session.address, preparation) },
    }, 201);
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const access = await storedAccess(request);
    const body = await readJsonObjectBody(request, MAX_BODY_BYTES);
    if (body.action === 'refresh') {
      if (access.agent) requireAgentAccess(access.agent, 'write');
      const result = await refreshSorobanPreparationAuthorizationWindow(
        blobSorobanPreparationStore,
        access.id,
        { accountLoader: loadAccount, networkParametersLoader: loadNetworkParameters },
      );
      return json({
        operation: 'contract.authorization.refresh',
        version: 1,
        preparation: result,
        access: { shareable: access.capabilityMatched },
      });
    }
    const entryIndex = typeof body.entryIndex === 'number' ? body.entryIndex : -1;
    const signerAddress = typeof body.signerAddress === 'string' ? body.signerAddress.trim() : '';
    const signatureBase64 = typeof body.signatureBase64 === 'string' ? body.signatureBase64.trim() : '';
    if (access.agent) {
      requireAgentAccess(access.agent, 'sign');
      if (access.agent.principal.address !== signerAddress) {
        throw new SorobanPreparationServiceError('Agent authorization must be attributable to its signer Principal.', 403, 'preparation_write_denied');
      }
    } else if (!access.capabilityMatched && (!access.session || access.session.address !== signerAddress)) {
      throw new SorobanPreparationServiceError('Confirm the signer wallet before adding this authorization signature.', 403, 'preparation_write_denied');
    }
    const result = await contributeSorobanPreparation(
      blobSorobanPreparationStore,
      access.id,
      { entryIndex, signerAddress, signatureBase64 },
      {
        accountLoader: loadAccount,
        networkParametersLoader: loadNetworkParameters,
        ...(access.agent ? { contributionActor: agentActorForCredential(access.agent) } : {}),
      },
    );
    return json({
      operation: 'contract.authorization.contribute',
      version: 1,
      ...result,
      access: {
        shareable: access.capabilityMatched,
        viewerAction: preparationViewerAction(signerAddress, result.preparation),
      },
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const access = await storedAccess(request);
    if (access.agent) requireAgentAccess(access.agent, 'write');
    const actorAddress = access.agent?.principal.address ?? access.session?.address;
    if (!actorAddress) {
      throw new SorobanPreparationServiceError('Confirm a current transaction signer before creating the Proposal.', 401, 'transaction_signer_required');
    }
    const proposal = await freezeSorobanPreparation(
      blobSorobanPreparationStore,
      blobSigningRequestStore,
      access.id,
      {
        actorAddress,
        ...(access.agent ? { actor: agentActorForCredential(access.agent) } : {}),
        accountLoader: loadAccount,
        networkParametersLoader: loadNetworkParameters,
        sorobanExecutionVerifier: executionVerifier,
        sorobanTransactionPreparer: prepareEnforcedSorobanTransaction,
      },
    );
    if (access.agent && blobSigningRequestStore.putRequestParticipant) {
      const existing = await blobSigningRequestStore.getRequestParticipant?.(proposal.id, actorAddress) ?? null;
      if (!existing) {
        await blobSigningRequestStore.putRequestParticipant(proposal.id, {
          version: 1,
          address: actorAddress,
          joinedAt: proposal.createdAt,
        });
      }
    }
    return json({
      operation: 'contract.authorization.freeze',
      version: 1,
      proposal,
      capability: access.capabilityMatched ? access.capability : undefined,
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}
