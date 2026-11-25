import { blobAgentCredentialStore } from '../server/blobAgentCredentialStore.js';
import { blobAuthStore } from '../server/blobAuthStore.js';
import { RequestStorageUnavailableError } from '../server/blobRequestStore.js';
import { authConfigForRequest } from '../server/authConfig.js';
import { AuthServiceError, requirePrivateWorkspaceSession } from '../server/authService.js';
import {
  AgentCredentialServiceError,
  agentCredentialSummary,
  revokeSignerAgentCredential,
} from '../server/agentCredentialService.js';
import { RequestBodyError, readJsonObjectBody } from '../server/requestBody.js';
import { assertDeploymentNetwork, DeploymentNetworkPolicyError } from '../server/deploymentNetworkPolicy.js';
import { noStoreJson } from '../server/httpResponse.js';
import {
  beforeFirstDurableWrite,
  enforceSemanticRateLimit,
  SEMANTIC_RATE_LIMIT_IDS,
  SemanticRateLimitError,
  semanticRateLimitKey,
} from '../server/semanticRateLimit.js';
import { privateSessionAddressFromRequest } from '../../../../packages/stellar-core/src/privateSessionTransport.js';

const MAX_BODY_BYTES = 16 * 1024;

function errorResponse(cause: unknown): Response {
  if (cause instanceof RequestBodyError) return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
  if (cause instanceof AuthServiceError || cause instanceof DeploymentNetworkPolicyError) return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
  if (cause instanceof AgentCredentialServiceError) return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
  if (cause instanceof SemanticRateLimitError) return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
  if (cause instanceof RequestStorageUnavailableError) return noStoreJson({ error: cause.message, code: 'storage_not_configured' }, 503);
  console.error('Agent access API error', cause);
  return noStoreJson({ error: 'Agent access is temporarily unavailable.', code: 'internal_error' }, 500);
}

async function authorizedPrincipal(request: Request) {
  const session = await requirePrivateWorkspaceSession(
    blobAuthStore,
    request,
    authConfigForRequest(request),
    'Unlock this wallet to manage Agent access.',
  );
  assertDeploymentNetwork(session.network);
  const selectedAddress = privateSessionAddressFromRequest(request);
  if (!selectedAddress || selectedAddress !== session.address) {
    throw new AgentCredentialServiceError('Agent access session does not match the selected wallet.', 401, 'session_identity_mismatch');
  }
  return {
    session,
    principal: { type: 'signer' as const, network: session.network, address: session.address },
  };
}

function agentStoreWithAdminQuota(
  request: Request,
  principal: { network: 'public' | 'testnet'; address: string },
) {
  const beforeWrite = beforeFirstDurableWrite(async () => {
    await enforceSemanticRateLimit(request, {
      rateLimitId: SEMANTIC_RATE_LIMIT_IDS.agentAccessAdmin,
      rateLimitKey: semanticRateLimitKey(principal.network, principal.address),
      errorCode: 'agent_access_rate_limited',
      errorMessage: 'This signer has had too many Agent credential changes recently. Try again later.',
    });
  });
  return {
    ...blobAgentCredentialStore,
    putCredential: async (...args: Parameters<typeof blobAgentCredentialStore.putCredential>) => {
      await beforeWrite();
      return blobAgentCredentialStore.putCredential(...args);
    },
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { principal } = await authorizedPrincipal(request);
    const credentials = (await blobAgentCredentialStore.listCredentials(principal)).map(agentCredentialSummary);
    return noStoreJson({ principal, credentials });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function POST(): Promise<Response> {
  // A private workspace session is not consent for a reusable Agent credential.
  // Use /agent-grants and a new wallet signature bound to the exact grant.
  return noStoreJson({
    error: 'Approve a new Agent pairing with your wallet before issuing credentials.',
    code: 'agent_approval_required',
  }, 403);
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const [{ session, principal }, body] = await Promise.all([
      authorizedPrincipal(request),
      readJsonObjectBody(request, MAX_BODY_BYTES),
    ]);
    if (typeof body.credentialId !== 'string' || !body.credentialId.trim()) {
      throw new AgentCredentialServiceError('Agent credential id is required.', 400, 'invalid_agent_credential_id');
    }
    const credential = await revokeSignerAgentCredential(
      agentStoreWithAdminQuota(request, principal),
      principal,
      body.credentialId,
      session.address,
    );
    return noStoreJson({ principal, credential });
  } catch (cause) {
    return errorResponse(cause);
  }
}
