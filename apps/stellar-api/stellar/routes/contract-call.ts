import { buildContractCall, ContractCallServiceError } from '../server/contractCallService.js';
import { assertDeploymentNetwork, DeploymentNetworkPolicyError } from '../server/deploymentNetworkPolicy.js';
import { publicCorsHeaders, publicCorsJson } from '../server/httpResponse.js';
import { readJsonObjectBody, RequestBodyError } from '../server/requestBody.js';

const MAX_BODY_BYTES = 64 * 1024;
const METHODS = 'POST, OPTIONS';

function json(data: unknown, status = 200): Response {
  return publicCorsJson(data, METHODS, status);
}

function errorResponse(cause: unknown): Response {
  if (cause instanceof RequestBodyError || cause instanceof ContractCallServiceError || cause instanceof DeploymentNetworkPolicyError) {
    return json({ error: cause.message, code: cause.code }, cause.status);
  }
  console.error('Contract call API error', cause);
  return json({ error: 'Contract call builder is temporarily unavailable.', code: 'internal_error' }, 500);
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: publicCorsHeaders(METHODS) });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonObjectBody(request, MAX_BODY_BYTES);
    if (body.network === 'public' || body.network === 'testnet') assertDeploymentNetwork(body.network);
    return json(await buildContractCall({
      network: body.network,
      transactionSource: body.transactionSource,
      contractId: body.contractId,
      method: body.method,
      arguments: body.arguments,
      lifetimeSeconds: body.lifetimeSeconds,
    }));
  } catch (cause) {
    return errorResponse(cause);
  }
}
