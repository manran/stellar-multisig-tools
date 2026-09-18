import { blobAgentCredentialStore } from '../server/blobAgentCredentialStore.js';
import { blobAuthStore } from '../server/blobAuthStore.js';
import { blobSorobanIntentStore } from '../server/blobSorobanIntentStore.js';
import {
  AgentCredentialServiceError,
  agentActorForCredential,
  requireAgentAccess,
} from '../server/agentCredentialService.js';
import { createAgentSorobanIntent } from '../server/agentSorobanIntentService.js';
import { projectSorobanAgentTask } from '../server/agentTaskProjection.js';
import {
  IntegrationCredentialServiceError,
  integrationCallerForCredential,
} from '../server/integrationCredentialService.js';
import {
  createIntegrationSorobanIntent,
  resolveAndBindIntegrationSorobanExecutor,
} from '../server/integrationSorobanIntentService.js';
import { BoxServiceError } from '../server/boxService.js';
import { CallerAuthenticationError, machineCallerFromRequest, verifiedSignerSessionFromRequest } from '../server/callerAuthentication.js';
import { ContractIntentServiceError } from '../server/contractIntentService.js';
import {
  assertSorobanIntentCancellationOwner,
  cancelSorobanIntent,
  SorobanIntentCancellationServiceError,
} from '../server/sorobanIntentCancellationService.js';
import {
  assertDeploymentNetwork,
  DeploymentNetworkPolicyError,
} from '../server/deploymentNetworkPolicy.js';
import { createHumanSorobanIntent } from '../server/humanSorobanIntentService.js';
import { createImportedSorobanIntent } from '../server/importedSorobanIntentService.js';
import { noStoreJson, publicCorsHeaders } from '../server/httpResponse.js';
import { projectSorobanIntentEvidence } from '../server/sorobanIntentEvidence.js';
import { projectIntegrationSorobanJob } from '../server/integrationSorobanJobProjection.js';
import { readJsonObjectBody, RequestBodyError } from '../server/requestBody.js';
import { RequestStorageUnavailableError } from '../server/blobRequestStore.js';
import { configuredSorobanManagedExecutor, configuredSorobanPlanningSource } from '../server/sorobanIntentConfig.js';
import { SorobanIntentPlanningError } from '../server/sorobanIntentPlanningService.js';
import { SorobanIntentServiceError } from '../server/sorobanIntentService.js';
import { replanExpiredSorobanIntent, SorobanIntentReplanServiceError } from '../server/sorobanIntentReplanService.js';
import {
  prepareSorobanIntentExecution,
  SorobanIntentExecutionServiceError,
} from '../server/sorobanIntentExecutionService.js';
import {
  reconcileSorobanIntentExecution,
  SorobanIntentExecutionReconciliationServiceError,
} from '../server/sorobanIntentExecutionReconciliationService.js';
import {
  contributeSorobanIntentAuthorization,
  getSorobanIntentAuthorization,
  SorobanIntentAuthorizationServiceError,
} from '../server/sorobanIntentAuthorizationService.js';
import { isValidSigningRequestId } from '../server/requestLocator.js';
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
  if (cause instanceof SorobanIntentExecutionServiceError || cause instanceof SorobanIntentExecutionReconciliationServiceError) {
    return json({ error: cause.message, code: cause.code, ...(cause.details ? { details: cause.details } : {}) }, cause.status);
  }
  if (
    cause instanceof DeploymentNetworkPolicyError
    || cause instanceof RequestBodyError
    || cause instanceof CallerAuthenticationError
    || cause instanceof AgentCredentialServiceError
    || cause instanceof IntegrationCredentialServiceError
    || cause instanceof BoxServiceError
    || cause instanceof ContractIntentServiceError
    || cause instanceof SorobanIntentServiceError
    || cause instanceof SorobanIntentAuthorizationServiceError
    || cause instanceof SorobanIntentCancellationServiceError
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
  const machineCaller = await machineCallerFromRequest(blobAgentCredentialStore, request);
  const integrationCredential = machineCaller?.kind === 'service' ? machineCaller.credential : null;
  const agent = machineCaller?.kind === 'agent' ? machineCaller.credential : null;
  const session = machineCaller ? null : await verifiedSignerSessionFromRequest(blobAuthStore, request, stored.network);
  const authorization = await getSorobanIntentAuthorization(blobSorobanIntentStore, id);

  if (integrationCredential) {
    if (stored.integration?.serviceId !== integrationCredential.serviceId) {
      throw new SorobanIntentAuthorizationServiceError(
        'This Integration credential does not own this Soroban Intent.',
        403,
        'integration_intent_access_denied',
      );
    }
    if (required === 'sign') {
      throw new SorobanIntentAuthorizationServiceError(
        'Integration credentials cannot contribute Soroban signer authorization.',
        403,
        'integration_intent_sign_denied',
      );
    }
    return { id, integrationCredential, agent: null, session: null, stored, authorization, address: undefined };
  }

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
  return { id, integrationCredential: null, agent, session, stored, authorization, address };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const access = await storedIntentAccess(request, 'read');
    const [contributions, preparations, observations] = await Promise.all([
      blobSorobanIntentStore.listContributions(access.id),
      blobSorobanIntentStore.listExecutionPreparations?.(access.id) ?? Promise.resolve([]),
      blobSorobanIntentStore.listExecutionObservations?.(access.id) ?? Promise.resolve([]),
    ]);
    return json({
      operation: 'contract.intent.inspect',
      version: 1,
      intent: access.stored,
      authorization: access.authorization,
      evidence: projectSorobanIntentEvidence(access.stored, contributions, preparations, observations),
      ...(access.integrationCredential ? {
        job: integrationJob(request, access.stored, access.authorization, preparations, observations),
      } : {}),
      ...(access.agent ? {
        task: agentTask(
          access.stored,
          access.authorization,
          access.agent.access,
          access.agent.principal.address,
          preparations,
          observations,
        ),
      } : {}),
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}

function integrationReviewUrl(request: Request, id: string): string {
  const url = new URL(request.url);
  url.pathname = '/a';
  url.search = '';
  url.hash = id;
  return url.toString();
}

function integrationJob(
  request: Request,
  stored: Parameters<typeof projectIntegrationSorobanJob>[0]['stored'],
  authorization: Parameters<typeof projectIntegrationSorobanJob>[0]['authorization'],
  preparations: Parameters<typeof projectIntegrationSorobanJob>[0]['preparations'] = [],
  observations: Parameters<typeof projectIntegrationSorobanJob>[0]['observations'] = [],
) {
  return projectIntegrationSorobanJob({
    stored, authorization, preparations, observations,
    reviewUrl: integrationReviewUrl(request, stored.id),
  });
}

async function loadIntegrationJob(
  request: Request,
  stored: Parameters<typeof projectIntegrationSorobanJob>[0]['stored'],
  authorization: Parameters<typeof projectIntegrationSorobanJob>[0]['authorization'],
) {
  const [latestStored, preparations, observations] = await Promise.all([
    blobSorobanIntentStore.getIntent(stored.id),
    blobSorobanIntentStore.listExecutionPreparations?.(stored.id) ?? Promise.resolve([]),
    blobSorobanIntentStore.listExecutionObservations?.(stored.id) ?? Promise.resolve([]),
  ]);
  return integrationJob(request, latestStored ?? stored, authorization, preparations, observations);
}

function agentTask(
  stored: Parameters<typeof projectSorobanAgentTask>[0]['stored'],
  authorization: Parameters<typeof projectSorobanAgentTask>[0]['authorization'],
  credentialAccess: Parameters<typeof projectSorobanAgentTask>[0]['credentialAccess'],
  principalAddress: string,
  preparations: Parameters<typeof projectSorobanAgentTask>[0]['preparations'] = [],
  observations: Parameters<typeof projectSorobanAgentTask>[0]['observations'] = [],
) {
  return projectSorobanAgentTask({
    stored,
    authorization,
    credentialAccess,
    principalAddress,
    preparations,
    observations,
  });
}

async function loadAgentTask(
  stored: Parameters<typeof projectSorobanAgentTask>[0]['stored'],
  authorization: Parameters<typeof projectSorobanAgentTask>[0]['authorization'],
  agent: NonNullable<Awaited<ReturnType<typeof storedIntentAccess>>['agent']>,
) {
  const [latestStored, preparations, observations] = await Promise.all([
    blobSorobanIntentStore.getIntent(stored.id),
    blobSorobanIntentStore.listExecutionPreparations?.(stored.id) ?? Promise.resolve([]),
    blobSorobanIntentStore.listExecutionObservations?.(stored.id) ?? Promise.resolve([]),
  ]);
  return agentTask(
    latestStored ?? stored,
    authorization,
    agent.access,
    agent.principal.address,
    preparations,
    observations,
  );
}

function executorFromBody(body: Record<string, unknown>): unknown {
  const executor = body.executor;
  const legacy = body.executionSource;
  if (executor !== undefined && legacy !== undefined && executor !== legacy) {
    throw new BoxServiceError(
      'Provide executor or legacy executionSource, not two different executor addresses.',
      400,
      'conflicting_execution_account',
    );
  }
  return executor ?? legacy;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonObjectBody(request, MAX_BODY_BYTES);
    const network = body.network === 'public' || body.network === 'testnet' ? body.network : null;
    if (!network) {
      throw new ContractIntentServiceError('Network must be public or testnet.', 400, 'invalid_network');
    }
    assertDeploymentNetwork(network);
    const machineCaller = await machineCallerFromRequest(blobAgentCredentialStore, request);
    const integrationCredential = machineCaller?.kind === 'service' ? machineCaller.credential : null;
    const agent = machineCaller?.kind === 'agent' ? machineCaller.credential : null;
    if (!integrationCredential && body.executor !== undefined) {
      throw new ContractIntentServiceError(
        'Executor selection at Intent creation is available only to Integration Services.',
        400,
        'executor_integration_only',
      );
    }
    if (body.preparedXdr !== undefined) {
      if (integrationCredential) {
        throw new BoxServiceError(
          'Integration services create semantic Soroban Intents and cannot import prepared XDR.',
          403,
          'integration_prepared_xdr_unsupported',
        );
      }
      if (agent) {
        throw new AgentCredentialServiceError(
          'Prepared XDR import is a Human review transition. Agents should create semantic Soroban Intents directly.',
          403,
          'prepared_xdr_import_human_only',
        );
      }
      const session = await verifiedSignerSessionFromRequest(blobAuthStore, request, network);
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
    if (integrationCredential) {
      if (body.privateNote !== undefined && body.privateNote !== null && body.privateNote !== '') {
        throw new BoxServiceError(
          'Integration Intent creation does not accept private plaintext context in this version.',
          400,
          'integration_private_note_unsupported',
        );
      }
      const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? '';
      if (!idempotencyKey) {
        throw new BoxServiceError('Idempotency-Key header is required for Integration Intent creation.', 400, 'idempotency_key_required');
      }
      const beforeCreate = beforeFirstDurableWrite(async () => {
        await enforceSemanticRateLimit(request, {
          rateLimitId: SEMANTIC_RATE_LIMIT_IDS.requestCreate,
          rateLimitKey: semanticRateLimitKey(network, `service:${integrationCredential.serviceId}`),
          errorCode: 'request_create_rate_limited',
          errorMessage: 'This Integration has created too many Intents recently. Try again later.',
        });
      });
      const quotaStore = {
        ...blobSorobanIntentStore,
        createIntent: async (...args: Parameters<typeof blobSorobanIntentStore.createIntent>) => {
          await beforeCreate();
          return blobSorobanIntentStore.createIntent(...args);
        },
      };
      const result = await createIntegrationSorobanIntent(
        quotaStore,
        integrationCredential,
        {
          network,
          contractId: body.contractId,
          method: body.method,
          arguments: body.arguments,
          idempotencyKey,
          externalReference: body.externalReference,
          executor: body.executor,
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
        job: integrationJob(request, result.intent, authorization),
      }, result.replayed ? 200 : 201);
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
        task: agentTask(
          result.intent,
          authorization,
          agent.access,
          agent.principal.address,
        ),
      }, result.replayed ? 200 : 201);
    }

    const session = await verifiedSignerSessionFromRequest(blobAuthStore, request, network);
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
    if (!access.address) {
      throw new SorobanIntentAuthorizationServiceError('A current signer is required.', 403, 'intent_signer_required');
    }
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
      ...(access.agent ? {
        task: agentTask(
          access.stored,
          result.authorization,
          access.agent.access,
          access.agent.principal.address,
        ),
      } : {}),
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const access = await storedIntentAccess(request, 'write');
    const body = await readJsonObjectBody(request, MAX_BODY_BYTES);
    if (body.action === 'reconcile_execution') {
      const result = await reconcileSorobanIntentExecution(
        blobSorobanIntentStore,
        access.id,
        typeof body.transactionHash === 'string' ? body.transactionHash : '',
      );
      const job = access.integrationCredential
        ? await loadIntegrationJob(request, access.stored, access.authorization)
        : undefined;
      const task = access.agent
        ? await loadAgentTask(access.stored, access.authorization, access.agent)
        : undefined;
      return json({
        operation: 'contract.intent.execution.reconcile',
        version: 1,
        transactionHash: result.transactionHash,
        observed: result.observed,
        replayed: result.replayed,
        ...(result.observation ? { observation: result.observation } : {}),
        ...(job ? { job } : {}),
        ...(task ? { task } : {}),
      });
    }
    if (body.action === 'cancel') {
      assertSorobanIntentCancellationOwner(access.stored, access.integrationCredential
        ? { serviceId: access.integrationCredential.serviceId }
        : { principalAddress: access.address });
      const result = await cancelSorobanIntent(
        blobSorobanIntentStore,
        access.id,
        access.integrationCredential
          ? { cancelledBy: integrationCallerForCredential(access.integrationCredential) }
          : {
              ...(access.address ? { cancelledByAddress: access.address } : {}),
              ...(access.agent ? { cancelledBy: agentActorForCredential(access.agent) } : {}),
            },
      );
      const authorization = await getSorobanIntentAuthorization(blobSorobanIntentStore, access.id);
      const job = access.integrationCredential
        ? await loadIntegrationJob(request, result.intent, authorization)
        : undefined;
      const task = access.agent
        ? await loadAgentTask(result.intent, authorization, access.agent)
        : undefined;
      return json({
        operation: 'contract.intent.cancel',
        version: 1,
        replayed: result.replayed,
        intent: result.intent,
        authorization,
        cancellation: result.cancellation,
        ...(job ? { job } : {}),
        ...(task ? { task } : {}),
      });
    }
    const integrationOwnedExecution = Boolean(access.stored.integration);
    if (integrationOwnedExecution && !access.integrationCredential) {
      throw new SorobanIntentExecutionServiceError(
        'This Soroban Intent has Integration-owned execution. Signers authorize it in MultiSigTools but cannot prepare, refresh, or replace its executor.',
        409,
        'external_executor_required',
      );
    }
    if (body.action === 'replan') {
      const rateLimitIdentity = access.integrationCredential
        ? `service:${access.integrationCredential.serviceId}`
        : access.address;
      if (!rateLimitIdentity) {
        throw new SorobanIntentAuthorizationServiceError('A current Intent actor is required.', 403, 'intent_access_denied');
      }
      await enforceSemanticRateLimit(request, {
        rateLimitId: SEMANTIC_RATE_LIMIT_IDS.requestCreate,
        rateLimitKey: semanticRateLimitKey(access.stored.network, rateLimitIdentity),
        errorCode: 'intent_replan_rate_limited',
        errorMessage: 'This actor has refreshed Soroban authorization too many times recently. Try again later.',
      });
      const result = await replanExpiredSorobanIntent(
        blobSorobanIntentStore,
        access.id,
        configuredSorobanPlanningSource(access.stored.network),
        { authorization: access.authorization },
      );
      const job = access.integrationCredential
        ? await loadIntegrationJob(request, result.intent, result.authorization)
        : undefined;
      const task = access.agent
        ? await loadAgentTask(result.intent, result.authorization, access.agent)
        : undefined;
      return json({
        operation: 'contract.intent.replan',
        version: 1,
        intent: result.intent,
        authorization: result.authorization,
        previousAuthorizationPlanDigest: result.previousAuthorizationPlanDigest,
        authorizationPlanRevision: result.authorizationPlanRevision,
        ...(job ? { job } : {}),
        ...(task ? { task } : {}),
      });
    }
    if (body.action !== undefined && body.action !== 'prepare_execution' && body.action !== 'refresh_execution') {
      throw new SorobanIntentExecutionServiceError(
        'Unsupported Soroban Intent execution action.',
        400,
        'invalid_intent_execution_action',
      );
    }
    const requestedExecutor = executorFromBody(body);
    let executionSource = typeof requestedExecutor === 'string' ? requestedExecutor.trim() : '';
    let executorBinding;
    if (access.integrationCredential) {
      if (access.authorization.status !== 'authorization_ready') {
        throw new SorobanIntentExecutionServiceError(
          'Soroban Intent authorization is not ready for execution.',
          409,
          'intent_authorization_not_ready',
        );
      }
      const resolved = await resolveAndBindIntegrationSorobanExecutor(
        blobSorobanIntentStore,
        access.stored,
        access.integrationCredential,
        requestedExecutor,
        access.stored.executionPolicy?.executor || requestedExecutor !== undefined
          ? null
          : configuredSorobanManagedExecutor(access.stored.network),
      );
      executionSource = resolved.executor.address;
      executorBinding = resolved.executor;
      if (body.acceptedEffectsDigest !== undefined) {
        throw new SorobanIntentExecutionServiceError(
          'Integration execution cannot accept changed effects on behalf of signers. Refresh the AuthorizationPlan and collect fresh AUTH.',
          409,
          'intent_execution_effects_reauthorization_required',
        );
      }
    }
    let execution;
    try {
      execution = await prepareSorobanIntentExecution(
        blobSorobanIntentStore,
        access.id,
        executionSource,
        {
          authorization: access.authorization,
          ...(typeof body.acceptedEffectsDigest === 'string' ? { acceptedEffectsDigest: body.acceptedEffectsDigest } : {}),
          ...(access.integrationCredential ? { requireExactEffects: true } : {}),
          ...(access.address ? { preparedByAddress: access.address } : {}),
          ...(access.agent ? { preparedBy: agentActorForCredential(access.agent) } : {}),
          ...(access.integrationCredential ? { preparedBy: integrationCallerForCredential(access.integrationCredential) } : {}),
        },
      );
    } catch (cause) {
      if (
        access.integrationCredential
        && cause instanceof SorobanIntentExecutionServiceError
        && cause.code === 'intent_execution_effects_review_required'
      ) {
        throw new SorobanIntentExecutionServiceError(
          'Final effects changed after external-service authorization. Refresh the AuthorizationPlan and collect fresh AUTH instead of accepting drift on behalf of signers.',
          409,
          'intent_execution_effects_reauthorization_required',
          cause.details,
        );
      }
      throw cause;
    }
    if (
      access.integrationCredential
      && execution.effectsDiff.currentDigest !== execution.effectsDiff.expectedDigest
    ) {
      throw new SorobanIntentExecutionServiceError(
        'Final effects changed after external-service authorization. Refresh the AuthorizationPlan and collect fresh AUTH before execution.',
        409,
        'intent_execution_effects_reauthorization_required',
        { effectsDiff: execution.effectsDiff },
      );
    }
    const job = access.integrationCredential
      ? await loadIntegrationJob(request, access.stored, access.authorization)
      : undefined;
    const task = access.agent
      ? await loadAgentTask(access.stored, access.authorization, access.agent)
      : undefined;
    return json({
      operation: 'contract.intent.execution.prepare',
      version: 1,
      execution: { ...execution, ...(executorBinding ? { executor: executorBinding } : {}) },
      ...(job ? { job } : {}),
      ...(task ? { task } : {}),
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}
