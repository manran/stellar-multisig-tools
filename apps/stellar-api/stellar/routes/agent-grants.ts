import { blobAgentGrantStore } from '../server/blobAgentGrantStore.js';
import { blobAgentCredentialStore } from '../server/blobAgentCredentialStore.js';
import { AgentCredentialServiceError } from '../server/agentCredentialService.js';
import { blobAuthStore } from '../server/blobAuthStore.js';
import { AgentGrantError, beginAgentGrant, inspectAgentGrant, grantPreview,
  agentApprovalMessage, approvalTransaction, verifyAgentApproval, decideAgentGrant,
  pollAgentGrant } from '../server/agentGrantService.js';
import { getOrCreateAuthServerKeypair, requirePrivateWorkspaceSession, AuthServiceError } from '../server/authService.js';
import { authConfigForRequest } from '../server/authConfig.js';
import { assertDeploymentNetwork, DeploymentNetworkPolicyError } from '../server/deploymentNetworkPolicy.js';
import { privateSessionAddressFromRequest } from '../../../../packages/stellar-core/src/privateSessionTransport.js';
import type { SignerPrincipalRef } from '../../../../packages/stellar-core/src/agentAccessTypes.js';
import { noStoreJson, publicCorsHeaders, publicCorsJson } from '../server/httpResponse.js';
import { RequestBodyError, readJsonObjectBody } from '../server/requestBody.js';
import { RequestStorageUnavailableError } from '../server/blobRequestStore.js';
import { limitAgentGrant, grantRequestSource } from '../server/agentGrantRateLimit.js';

function errorResponse(cause: unknown): Response {
  if (cause instanceof AgentGrantError) {
    return publicCorsJson({ error: cause.message, code: cause.code, ...(cause.details ? { details: cause.details } : {}) }, 'GET, POST, OPTIONS', cause.status);
  }
  if (cause instanceof AgentCredentialServiceError || cause instanceof AuthServiceError || cause instanceof RequestBodyError
    || cause instanceof DeploymentNetworkPolicyError) {
    return publicCorsJson({ error: cause.message, code: cause.code }, 'GET, POST, OPTIONS', cause.status);
  }
  if (cause instanceof RequestStorageUnavailableError) {
    return publicCorsJson({ error: 'Agent pairing storage is unavailable.', code: 'storage_unavailable' }, 'GET, POST, OPTIONS', 503);
  }
  console.error('Agent pairing API error', cause);
  return publicCorsJson({ error: 'Agent pairing is temporarily unavailable.', code: 'internal_error' }, 'GET, POST, OPTIONS', 500);
}

async function signerPrincipal(request: Request): Promise<SignerPrincipalRef> {
  const session = await requirePrivateWorkspaceSession(
    blobAuthStore, request, authConfigForRequest(request),
    'Confirm this wallet to approve Agent access.',
  );
  if (session.network !== 'testnet') {
    throw new AgentGrantError('This pairing request is Testnet only.', 409, 'network_mismatch');
  }
  if (privateSessionAddressFromRequest(request) !== session.address) {
    throw new AgentGrantError('Selected wallet does not match the authenticated signer.', 401, 'session_identity_mismatch');
  }
  return { type: 'signer', address: session.address, network: 'testnet' };
}

function checkBrowserOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== 'https://stellar-testnet.multisig.tools') {
    throw new AgentGrantError('Agent approval must come from the Testnet workspace.', 403, 'invalid_origin');
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: publicCorsHeaders('GET, POST, OPTIONS') });
}

export async function GET(request: Request) {
  try {
    assertDeploymentNetwork('testnet');
    const params = new URL(request.url).searchParams;
    const id = params.get('id') ?? '';
    const { grant, decision } = await inspectAgentGrant(blobAgentGrantStore, id);
    if (params.get('challenge') !== '1') {
      return publicCorsJson(grantPreview(grant, decision), 'GET, POST, OPTIONS');
    }
    if (decision) throw new AgentGrantError('Agent pairing was already decided.', 409, 'grant_already_decided');
    const principal = await signerPrincipal(request);
    const config = authConfigForRequest(request);
    const server = await getOrCreateAuthServerKeypair(blobAuthStore);
    return noStoreJson({ ...grantPreview(grant, decision),
      message: agentApprovalMessage(grant, principal, config.webAuthDomain),
      transaction: approvalTransaction(grant, principal, config.webAuthDomain, server),
      signer: principal.address });
  } catch (cause) { return errorResponse(cause); }
}

export async function POST(request: Request) {
  try {
    assertDeploymentNetwork('testnet');
    const body = await readJsonObjectBody(request, 16 * 1024);
    if (body.action === 'request') {
      await limitAgentGrant('request:' + grantRequestSource(request));
      const created = await beginAgentGrant(blobAgentGrantStore, body.label, body.access, body.network);
      return publicCorsJson(created, 'GET, POST, OPTIONS', 201);
    }
    if (body.action === 'poll') {
      const code = typeof body.deviceCode === 'string' ? body.deviceCode : '';
      // The grant secret is never used as a human session and is single-use.
      const result = await pollAgentGrant(blobAgentGrantStore,
        { ...blobAgentCredentialStore,
          putCredential: async (credential) => {
            await limitAgentGrant('mint:' + credential.principal.network + ':' + credential.principal.address);
            return blobAgentCredentialStore.putCredential(credential);
          },
        }, code);
      return publicCorsJson(result, 'GET, POST, OPTIONS');
    }
    if (body.action === 'approve' || body.action === 'deny') {
      checkBrowserOrigin(request);
      const id = typeof body.requestId === 'string' ? body.requestId : '';
      const { grant, decision } = await inspectAgentGrant(blobAgentGrantStore, id);
      if (decision) throw new AgentGrantError('Agent pairing was already decided.', 409, 'grant_already_decided');
      const principal = await signerPrincipal(request);
      if (body.action === 'approve') {
        const config = authConfigForRequest(request);
        const server = await getOrCreateAuthServerKeypair(blobAuthStore);
        if (body.mode === 'sep53' && typeof body.signature === 'string') {
          verifyAgentApproval(grant, principal, config.webAuthDomain, server,
            { mode: 'sep53', signature: body.signature });
        } else if (body.mode === 'transaction' && typeof body.transaction === 'string') {
          verifyAgentApproval(grant, principal, config.webAuthDomain, server,
            { mode: 'transaction', transaction: body.transaction });
        } else {
          throw new AgentGrantError('Fresh wallet approval is required.', 403, 'approval_signature_required');
        }
      }
      await limitAgentGrant('approval:' + principal.network + ':' + principal.address);
      await decideAgentGrant(blobAgentGrantStore, id,
        body.action === 'approve'
          ? { status: 'approved', principal, decidedAt: new Date().toISOString() }
          : { status: 'denied', decidedAt: new Date().toISOString() });
      return noStoreJson({ status: body.action === 'approve' ? 'approved' : 'denied' });
    }
    throw new AgentGrantError('Unknown Agent pairing operation.', 400, 'invalid_action');
  } catch (cause) { return errorResponse(cause); }
}
