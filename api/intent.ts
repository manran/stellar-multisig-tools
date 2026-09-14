import { blobAgentCredentialStore } from '../server/blobAgentCredentialStore.js';
import { blobSorobanIntentStore } from '../server/blobSorobanIntentStore.js';
import {
  AgentCredentialServiceError,
  authenticateAgentCredential,
} from '../server/agentCredentialService.js';
import { createAgentSorobanIntent } from '../server/agentSorobanIntentService.js';
import { BoxServiceError } from '../server/boxService.js';
import { ContractIntentServiceError } from '../server/contractIntentService.js';
import {
  assertDeploymentNetwork,
  DeploymentNetworkPolicyError,
} from '../server/deploymentNetworkPolicy.js';
import { noStoreJson, publicCorsHeaders } from '../server/httpResponse.js';
import { readJsonObjectBody, RequestBodyError } from '../server/requestBody.js';
import { RequestStorageUnavailableError } from '../server/blobRequestStore.js';
import { configuredSorobanPlanningSource } from '../server/sorobanIntentConfig.js';
import { SorobanIntentPlanningError } from '../server/sorobanIntentPlanningService.js';
import { SorobanIntentServiceError } from '../server/sorobanIntentService.js';
import {
  beforeFirstDurableWrite,
  enforceSemanticRateLimit,
  SEMANTIC_RATE_LIMIT_IDS,
  SemanticRateLimitError,
  semanticRateLimitKey,
} from '../server/semanticRateLimit.js';

const MAX_BODY_BYTES = 64 * 1024;
const METHODS = 'POST, OPTIONS';
const CORS_HEADERS = {
  ...publicCorsHeaders(METHODS),
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key',
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
  ) {
    return json({ error: cause.message, code: cause.code }, cause.status);
  }
  if (cause instanceof SorobanIntentPlanningError) {
    return json({ error: cause.message, code: cause.code }, 503);
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
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) {
    throw new AgentCredentialServiceError(
      'Agent credential is required.',
      401,
      'agent_credential_required',
    );
  }
  return authenticateAgentCredential(blobAgentCredentialStore, match[1].trim());
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonObjectBody(request, MAX_BODY_BYTES);
    const network = body.network === 'public' || body.network === 'testnet' ? body.network : null;
    if (!network) {
      throw new ContractIntentServiceError('Network must be public or testnet.', 400, 'invalid_network');
    }
    assertDeploymentNetwork(network);
    const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? '';
    if (!idempotencyKey) {
      throw new BoxServiceError('Idempotency-Key header is required.', 400, 'idempotency_key_required');
    }
    const agent = await agentCredentialFor(request);
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
    return json({
      operation: 'contract.intent.create',
      version: 1,
      replayed: result.replayed,
      intent: result.intent,
    }, result.replayed ? 200 : 201);
  } catch (cause) {
    return errorResponse(cause);
  }
}
