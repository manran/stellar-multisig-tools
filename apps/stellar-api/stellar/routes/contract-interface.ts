import { ContractCallServiceError, inspectContractInterface } from '../server/contractCallService.js';
import { assertDeploymentNetwork, DeploymentNetworkPolicyError } from '../server/deploymentNetworkPolicy.js';
import { publicCorsHeaders, publicCorsJson } from '../server/httpResponse.js';

const METHODS = 'GET, OPTIONS';

function json(data: unknown, status = 200): Response {
  return publicCorsJson(data, METHODS, status);
}

function errorResponse(cause: unknown): Response {
  if (cause instanceof ContractCallServiceError || cause instanceof DeploymentNetworkPolicyError) {
    return json({ error: cause.message, code: cause.code }, cause.status);
  }
  console.error('Contract interface API error', cause);
  return json({ error: 'Contract interface is temporarily unavailable.', code: 'internal_error' }, 500);
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: publicCorsHeaders(METHODS) });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const network = url.searchParams.get('network');
    if (network === 'public' || network === 'testnet') assertDeploymentNetwork(network);
    return json(await inspectContractInterface(url.searchParams.get('contract') ?? '', network));
  } catch (cause) {
    return errorResponse(cause);
  }
}
