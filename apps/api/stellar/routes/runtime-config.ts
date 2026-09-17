import {
  configuredDeploymentNetwork,
  DeploymentNetworkPolicyError,
} from '../server/deploymentNetworkPolicy.js';
import { publicCorsHeaders, publicCorsJson } from '../server/httpResponse.js';

const METHODS = 'GET, OPTIONS';

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: publicCorsHeaders(METHODS) });
}

export async function GET(): Promise<Response> {
  try {
    const network = configuredDeploymentNetwork();
    return publicCorsJson({
      operation: 'runtime.config.inspect',
      version: 1,
      stellarNetwork: network,
      fixedNetwork: network === 'dual' ? null : network,
    }, METHODS);
  } catch (cause) {
    if (cause instanceof DeploymentNetworkPolicyError) {
      return publicCorsJson({ error: cause.message, code: cause.code }, METHODS, cause.status);
    }
    console.error('Runtime config API error', cause);
    return publicCorsJson({ error: 'Runtime configuration is unavailable.', code: 'internal_error' }, METHODS, 500);
  }
}
