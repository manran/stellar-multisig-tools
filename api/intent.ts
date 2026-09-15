import { blobAgentCredentialStore } from '../server/blobAgentCredentialStore.js';
import { blobAuthStore } from '../server/blobAuthStore.js';
import { blobSorobanIntentStore } from '../server/blobSorobanIntentStore.js';
import {
  AgentCredentialServiceError,
  agentActorForCredential,
  authenticateAgentCredential,
  requireAgentAccess,
} from '../server/agentCredentialService.js';
import { createAgentSorobanIntent } from '../server/agentSorobanIntentService.js';
import { authConfigForRequest } from '../server/authConfig.js';
import { AuthServiceError, privateWorkspaceSessionFromRequest } from '../server/authService.js';
import { BoxServiceError } from '../server/boxService.js';
import { ContractIntentServiceError } from '../server/contractIntentService.js';
import {
  assertDeploymentNetwork,
  DeploymentNetworkPolicyError,
} from '../server/deploymentNetworkPolicy.js';
import { createHumanSorobanIntent } from '../server/humanSorobanIntentService.js';
import { createImportedSorobanIntent } from '../server/importedSorobanIntentService.js';
import { noStoreJson, publicCorsHeaders } from '../server/httpResponse.js';
import { readJsonObjectBody, RequestBodyError } from '../server/requestBody.js';
import { RequestStorageUnavailableError } from '../server/blobRequestStore.js';
import { configuredSorobanPlanningSource } from '../server/sorobanIntentConfig.js';
import { SorobanIntentPlanningError } from '../server/sorobanIntentPlanningService.js';
import { SorobanIntentServiceError } from '../server/sorobanIntentService.js';
import { replanExpiredSorobanIntent, SorobanIntentReplanServiceError } from '../server/sorobanIntentReplanService.js';
import {
  prepareSorobanIntentExecution,
  SorobanIntentExecutionServiceError,
} from '../server/sorobanIntentExecutionService.js';
import {
  contributeSorobanIntentAuthorization,
  getSorobanIntentAuthorization,
  SorobanIntentAuthorizationServiceError,
} from '../server/sorobanIntentAuthorizationService.js';
import { isValidSigningRequestId } from '../server/requestLocator.js';
import { privateSessionAddressFromRequest } from '../src/stellar/privateSessionTransport.js';
import {
  beforeFirstDurableWrite,
  enforceSemanticRateLimit,
  SEMANTIC_RATE_LIMIT_IDS,
  SemanticRateLimitError,
  semanticRateLimitKey,
} from '../server/semanticRateLimit.js';

const MAX_BODY_BYTES = 64 * 1024;
const METHODS = 'GET, POST, PATCH, PUT, OPTIONS';
const INTENT_ID_HEADER = 'x-multisig-intent-id';
const CORS_HEADERS = {
  ...publicCorsHeaders(METHODS),
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, X-MultiSig-Intent-Id, X-MultiSig-Session-Address',
};

function json(data: unknown, status = 200): Response {
  return noStoreJson(data, status, CORS_HEADERS);
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function errorResponse(cause: unknown): Response {
  if (
    cause instanceof DeploymentNetworkPolicyError
    || cause instanceof RequestBodyError
    || cause instanceof AgentCredentialServiceError
    || cause instanceof BoxServiceError
    || cause instanceof ContractIntentServiceError
    || cause instanceof SorobanIntentServiceError
    || cause instanceof SorobanIntentAuthorizationServiceError
    || cause instanceof SorobanIntentExecutionServiceError
    || cause instanceof SorobanIntentReplanServiceError
  ) {
    return json({ error: cause.message, code: cause.code }, cause.status);
  }
  if (cause instanceof SorobanIntentPlanningError) {
    const status = cause.code === 'source_account_auth_unsupported' || cause.code === 'contract_account_auth_unsupported' ? 409 : 503;
    return json({ error: cause.message, code: cause.code }, status);
  }
  if (cause instanceof SemanticRateLimitError) {
    return json({ error: cause.message, code: cause.code }, cause.status);
  }
  if (cause instanceof RequestStorageUnavailableError) {
    return json({ error: cause.message, code: 'storage_not_configured' }, 503);
  }
  console.error('Soroban Intent API error', cause);
  return json({ error: 'Soroban Intent service is temporarily unavailable.', code: 'internal_error' }, 500);
}

async function agentCredentialFor(request: Request) {
  const authorization = request.headers.get('authorization')?.trim() ?? '';
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) {
    throw new AgentCredentialServiceError('Invalid Agent authorization header.', 401, 'invalid_agent_credential');
  }
  return authenticateAgentCredential(blobAgentCredentialStore, match[1].trim());
}

async function humanSessionFor(request: Request, network: 'public' | 'testnet') {
  const selectedAddress = privateSessionAddressFromRequest(request);
  if (!selectedAddress) return null;
  try {
    const session = await privateWorkspaceSessionFromRequest(
      blobAuthStore,
      request,
      authConfigForRequest(request),
    );
    return session && session.network === network && session.address === selectedAddress ? session : null;
  } catch (cause) {
    if (cause instanceof AuthServiceError) return null;
    throw cause;
  }
}

function intentIdFromRequest(request: Request): string {
  const id = request.headers.get(INTENT_ID_HEADER)?.trim().toUpperCase() ?? '';
  if (!isValidSigningRequestId(id)) {
    throw new SorobanIntentAuthorizationServiceError('A valid Soroban Intent id is required.', 400, 'invalid_intent_id');
  }
  return id;
}

async function storedIntentAccess(request: Request, required: 'read' | 'write' | 'sign') {
  const id = intentIdFromRequest(request);
  const stored = await blobSorobanIntentStore.getIntent(id);
  if (!stored) throw new SorobanIntentAuthorizationServiceError('Soroban Intent not found.', 404, 'intent_not_found');
  assertDeploymentNetwork(stored.network);
  const agent = await agentCredentialFor(request);
  const session = agent ? null : await humanSessionFor(request, stored.network);
  const authorization = await getSorobanIntentAuthorization(blobSorobanIntentStore, id);

  if (agent) {
    requireAgentAccess(agent, required);
    if (agent.principal.network !== stored.network) {
      throw new AgentCredentialServiceError('Agent credential network does not match this Soroban Intent.', 403, 'principal_network_mismatch');
    }
  } else if (!session) {
    throw new SorobanIntentAuthorizationServiceError(
      'Confirm the selected Stellar wallet before opening this Soroban Intent.',
      401,
      'intent_authentication_required',
    );
  }

  const address = agent?.principal.address ?? session!.address;
  const participant = stored.creatorAddress === address || authorization.authorizers.some(
    (authorizer) => authorizer.activeSigners.some((signer) => signer.publicKey === address),
  );
  if (!participant) {
    throw new SorobanIntentAuthorizationServiceError(
      'This wallet is not the Intent creator or a current signer for its remaining Soroban authorization.',
      403,
      'intent_access_denied',
    );
  }
  if (agent) await blobAgentCredentialStore.touchCredential(agent.credentialId, new Date().toISOString());
  return { id, agent, session, stored, authorization, address };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const access = await storedIntentAccess(request, 'read');
    return json({
      operation: 'contract.intent.inspect',
      version: 1,
      intent: access.stored,
      authorization: access.authorization,
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonObjectBody(request, MAX_BODY_BYTES);
    const network = body.network === 'public' || body.network === 'testnet' ? body.network : null;
    if (!network) {
      throw new ContractIntentServiceError('Network must be public or testnet.', 400, 'invalid_network');
    }
    assertDeploymentNetwork(network);
    const agent = await agentCredentialFor(request);
    if (body.preparedXdr !== undefined) {
      if (agent) {
        throw new AgentCredentialServiceError(
          'Prepared XDR import is a Human review transition. Agents should create semantic Soroban Intents directly.',
          403,
          'prepared_xdr_import_human_only',
        );
      }
      const session = await humanSessionFor(request, network);
      if (!session) {
        throw new SorobanIntentAuthorizationServiceError(
          'Confirm the selected Stellar wallet before importing this Soroban Intent.',
          401,
          'intent_creator_required',
        );
      }
      const beforeCreate = beforeFirstDurableWrite(async () => {
        await enforceSemanticRateLimit(request, {
          rateLimitId: SEMANTIC_RATE_LIMIT_IDS.requestCreate,
          rateLimitKey: semanticRateLimitKey(network, session.address),
          errorCode: 'request_create_rate_limited',
          errorMessage: 'This signer has created too many Intents recently. Try again later.',
        });
      });
      const intent = await createImportedSorobanIntent(blobSorobanIntentStore, session.address, {
        network,
        preparedXdr: body.preparedXdr,
        privateNote: body.privateNote,
        externalReference: body.externalReference,
      }, { beforeCreate });
      const authorization = await getSorobanIntentAuthorization(blobSorobanIntentStore, intent.id);
      return json({ operation: 'contract.intent.create', version: 1, replayed: false, intent, authorization }, 201);
    }
    if (agent) {
      const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? '';
      if (!idempotencyKey) {
        throw new BoxServiceError('Idempotency-Key header is required for Agent Intent creation.', 400, 'idempotency_key_required');
      }
      const beforeCreate = beforeFirstDurableWrite(async () => {
        await enforceSemanticRateLimit(request, {
          rateLimitId: SEMANTIC_RATE_LIMIT_IDS.requestCreate,
          rateLimitKey: semanticRateLimitKey(network, agent.principal.address),
          errorCode: 'request_create_rate_limited',
          errorMessage: 'This signer has created too many Intents recently. Try again later.',
        });
      });
      const quotaStore = {
        ...blobAgentCredentialStore,
        claimIdempotency: async (...args: Parameters<typeof blobAgentCredentialStore.claimIdempotency>) => {
          await beforeCreate();
          return blobAgentCredentialStore.claimIdempotency(...args);
        },
      };
      const result = await createAgentSorobanIntent(
        quotaStore,
        blobSorobanIntentStore,
        agent,
        {
          network,
          contractId: body.contractId,
          method: body.method,
          arguments: body.arguments,
          idempotencyKey,
          privateNote: body.privateNote,
          externalReference: body.externalReference,
        },
        { planningSource: configuredSorobanPlanningSource(network) },
      );
      const authorization = await getSorobanIntentAuthorization(blobSorobanIntentStore, result.intent.id);
      return json({
        operation: 'contract.intent.create',
        version: 1,
        replayed: result.replayed,
        intent: result.intent,
        authorization,
      }, result.replayed ? 200 : 201);
    }

    const session = await humanSessionFor(request, network);
    if (!session) {
      throw new SorobanIntentAuthorizationServiceError(
        'Confirm the selected Stellar wallet before creating this Soroban Intent.',
        401,
        'intent_creator_required',
      );
    }
    const beforeCreate = beforeFirstDurableWrite(async () => {
      await enforceSemanticRateLimit(request, {
        rateLimitId: SEMANTIC_RATE_LIMIT_IDS.requestCreate,
        rateLimitKey: semanticRateLimitKey(network, session.address),
        errorCode: 'request_create_rate_limited',
        errorMessage: 'This signer has created too many Intents recently. Try again later.',
      });
    });
    const intent = await createHumanSorobanIntent(
      blobSorobanIntentStore,
      session.address,
      {
        network,
        contractId: body.contractId,
        method: body.method,
        arguments: body.arguments,
        privateNote: body.privateNote,
        externalReference: body.externalReference,
      },
      {
        planningSource: configuredSorobanPlanningSource(network),
        beforeCreate,
      },
    );
    const authorization = await getSorobanIntentAuthorization(blobSorobanIntentStore, intent.id);
    return json({
      operation: 'contract.intent.create',
      version: 1,
      replayed: false,
      intent,
      authorization,
    }, 201);
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const access = await storedIntentAccess(request, 'sign');
    const body = await readJsonObjectBody(request, MAX_BODY_BYTES);
    const result = await contributeSorobanIntentAuthorization(
      blobSorobanIntentStore,
      access.id,
      {
        entryIndex: body.entryIndex as number,
        signerAddress: access.address,
        signatureBase64: typeof body.signatureBase64 === 'string' ? body.signatureBase64 : '',
      },
      access.agent ? { contributionActor: agentActorForCredential(access.agent) } : {},
    );
    return json({
      operation: 'contract.intent.contribute',
      version: 1,
      added: result.added,
      authorization: result.authorization,
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const access = await storedIntentAccess(request, 'write');
    const body = await readJsonObjectBody(request, MAX_BODY_BYTES);
    if (body.action === 'replan') {
      await enforceSemanticRateLimit(request, {
        rateLimitId: SEMANTIC_RATE_LIMIT_IDS.requestCreate,
        rateLimitKey: semanticRateLimitKey(access.stored.network, access.address),
        errorCode: 'intent_replan_rate_limited',
        errorMessage: 'This signer has refreshed Soroban authorization too many times recently. Try again later.',
      });
      const result = await replanExpiredSorobanIntent(
        blobSorobanIntentStore,
        access.id,
        configuredSorobanPlanningSource(access.stored.network),
        { authorization: access.authorization },
      );
      return json({
        operation: 'contract.intent.replan',
        version: 1,
        intent: result.intent,
        authorization: result.authorization,
        previousAuthorizationPlanDigest: result.previousAuthorizationPlanDigest,
        authorizationPlanRevision: result.authorizationPlanRevision,
      });
    }
    const executionSource = typeof body.executionSource === 'string' ? body.executionSource : '';
    const execution = await prepareSorobanIntentExecution(
      blobSorobanIntentStore,
      access.id,
      executionSource,
      { authorization: access.authorization },
    );
    return json({
      operation: 'contract.intent.execution.prepare',
      version: 1,
      execution,
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}
