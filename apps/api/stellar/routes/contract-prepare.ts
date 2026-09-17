import { assertDeploymentNetwork, DeploymentNetworkPolicyError } from '../server/deploymentNetworkPolicy.js';
import { publicCorsHeaders, publicCorsJson } from '../server/httpResponse.js';
import { readJsonObjectBody, RequestBodyError } from '../server/requestBody.js';
import type { StellarNetwork } from '../../../../src/stellar/types.js';
import {
  enforcePreparedSorobanTransaction,
  simulateSorobanTransaction,
  SorobanSimulationError,
} from '../../../../src/stellar/sorobanRpc.js';

const MAX_BODY_BYTES = 300 * 1024;
const METHODS = 'POST, OPTIONS';

function json(data: unknown, status = 200): Response {
  return publicCorsJson(data, METHODS, status);
}

function errorResponse(cause: unknown): Response {
  if (cause instanceof RequestBodyError || cause instanceof DeploymentNetworkPolicyError) {
    return json({ error: cause.message, code: cause.code }, cause.status);
  }
  if (cause instanceof SorobanSimulationError) {
    const status = cause.kind === 'unsupported' || cause.kind === 'invalid' ? 400 : 503;
    return json({ error: cause.message, code: `soroban_simulation_${cause.kind}` }, status);
  }
  console.error('Contract call preparation API error', cause);
  return json({ error: 'Contract call preparation is temporarily unavailable.', code: 'internal_error' }, 500);
}
export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: publicCorsHeaders(METHODS) });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonObjectBody(request, MAX_BODY_BYTES);
    const network: StellarNetwork | null = body.network === 'public' || body.network === 'testnet'
      ? body.network
      : null;
    const xdr = typeof body.xdr === 'string' ? body.xdr : '';
    if (!network) {
      return json({ error: 'Network must be public or testnet.', code: 'invalid_network' }, 400);
    }
    assertDeploymentNetwork(network);
    const mode = body.mode === undefined || body.mode === 'record'
      ? 'record'
      : body.mode === 'enforce'
        ? 'enforce'
        : null;
    if (!mode) return json({ error: 'Mode must be record or enforce.', code: 'invalid_mode' }, 400);
    if (mode === 'enforce') {
      const verification = await enforcePreparedSorobanTransaction({ envelopeXdr: xdr, network });
      return json({
        operation: 'contract.call.prepare',
        version: 1,
        mode,
        verification,
      });
    }
    const simulation = await simulateSorobanTransaction({ envelopeXdr: xdr, network });
    return json({
      operation: 'contract.call.prepare',
      version: 1,
      mode,
      simulation,
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}
