import { blobAgentCredentialStore } from '../server/blobAgentCredentialStore.js';
import { blobAuthStore } from '../server/blobAuthStore.js';
import { blobContractWorkspaceStore } from '../server/blobContractWorkspaceStore.js';
import { RequestStorageUnavailableError } from '../server/blobRequestStore.js';
import { authConfigForRequest } from '../server/authConfig.js';
import { AuthServiceError, requirePrivateWorkspaceSession } from '../server/authService.js';
import { assertDeploymentNetwork, DeploymentNetworkPolicyError } from '../server/deploymentNetworkPolicy.js';
import {
  AgentCredentialServiceError,
  authenticateAgentCredential,
  requireAgentAccess,
} from '../server/agentCredentialService.js';
import {
  ContractWorkspaceServiceError,
  forgetContractWorkspace,
  keepContractWorkspace,
  listContractWorkspaces,
} from '../server/contractWorkspaceService.js';
import { publicCorsHeaders, publicCorsJson } from '../server/httpResponse.js';
import { readJsonObjectBody, RequestBodyError } from '../server/requestBody.js';
import type { SignerPrincipalRef } from '../src/stellar/agentAccessTypes.js';
import type { AgentAccessLevel } from '../src/stellar/agentAccessTypes.js';

const MAX_BODY_BYTES = 8 * 1024;
const METHODS = 'GET, PUT, DELETE, OPTIONS';

function json(data: unknown, status = 200): Response {
  return publicCorsJson(data, METHODS, status);
}

function publicWorkspace(entry: {
  contractId: string;
  network: 'public' | 'testnet';
  createdAt: string;
  updatedAt: string;
}) {
  return {
    contractId: entry.contractId,
    network: entry.network,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function errorResponse(cause: unknown): Response {
  if (
    cause instanceof RequestBodyError
    || cause instanceof AuthServiceError
    || cause instanceof AgentCredentialServiceError
    || cause instanceof ContractWorkspaceServiceError
    || cause instanceof DeploymentNetworkPolicyError
  ) {
    return json({ error: cause.message, code: cause.code }, cause.status);
  }
  if (cause instanceof RequestStorageUnavailableError) {
    return json({ error: cause.message, code: 'storage_not_configured' }, 503);
  }
  console.error('Contract workspace API error', cause);
  return json({ error: 'Contract workspace is temporarily unavailable.', code: 'internal_error' }, 500);
}
async function principalFor(request: Request, requiredAccess: AgentAccessLevel): Promise<SignerPrincipalRef> {
  const authorization = request.headers.get('authorization') ?? '';
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization);
  if (bearer) {
    const credential = await authenticateAgentCredential(blobAgentCredentialStore, bearer[1].trim());
    requireAgentAccess(credential, requiredAccess);
    assertDeploymentNetwork(credential.principal.network);
    await blobAgentCredentialStore.touchCredential(credential.credentialId, new Date().toISOString());
    return credential.principal;
  }
  const session = await requirePrivateWorkspaceSession(
    blobAuthStore,
    request,
    authConfigForRequest(request),
    'Unlock the signer workspace to use saved contracts.',
  );
  assertDeploymentNetwork(session.network);
  return { type: 'signer', network: session.network, address: session.address };
}

function contractIdFromBody(body: Record<string, unknown>): string {
  return typeof body.contractId === 'string' ? body.contractId : '';
}

function assertRequestedNetwork(body: Record<string, unknown>, principal: SignerPrincipalRef): void {
  if (body.network !== undefined && body.network !== principal.network) {
    throw new ContractWorkspaceServiceError('Contract network must match the signer Principal.', 403, 'principal_network_mismatch');
  }
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: publicCorsHeaders(METHODS) });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await principalFor(request, 'read');
    const contracts = await listContractWorkspaces(blobContractWorkspaceStore, principal);
    return json({
      operation: 'contract.workspace.list',
      version: 1,
      principal,
      contracts: contracts.map(publicWorkspace),
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const [principal, body] = await Promise.all([
      principalFor(request, 'write'),
      readJsonObjectBody(request, MAX_BODY_BYTES),
    ]);
    assertRequestedNetwork(body, principal);
    const contract = await keepContractWorkspace(blobContractWorkspaceStore, principal, contractIdFromBody(body));
    return json({ operation: 'contract.workspace.keep', version: 1, principal, contract: publicWorkspace(contract) });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const [principal, body] = await Promise.all([
      principalFor(request, 'write'),
      readJsonObjectBody(request, MAX_BODY_BYTES),
    ]);
    assertRequestedNetwork(body, principal);
    const contractId = contractIdFromBody(body);
    await forgetContractWorkspace(blobContractWorkspaceStore, principal, contractId);
    return json({
      operation: 'contract.workspace.forget',
      version: 1,
      principal,
      contractId: contractId.trim(),
      removed: true,
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}
