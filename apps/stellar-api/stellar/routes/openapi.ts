import { stellarApiBaseForDeployment } from '../../../../packages/stellar-core/src/apiOrigins.js';
import { configuredDeploymentNetwork, DeploymentNetworkPolicyError } from '../server/deploymentNetworkPolicy.js';
import { publicCorsHeaders, publicCorsJson, publicDiscoveryJson } from '../server/httpResponse.js';
import { createOpenApiDocument } from '../server/openApiDocument.js';

const METHODS = 'GET, HEAD, OPTIONS';
const MEDIA_TYPE = 'application/vnd.oai.openapi+json;version=3.1';

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: publicCorsHeaders(METHODS) });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const deploymentNetwork = configuredDeploymentNetwork();
    return publicDiscoveryJson(request,
      createOpenApiDocument(stellarApiBaseForDeployment(deploymentNetwork), deploymentNetwork),
      METHODS, MEDIA_TYPE);

  } catch (cause) {
    if (cause instanceof DeploymentNetworkPolicyError) {
      return publicCorsJson({ error: cause.message, code: cause.code }, METHODS, cause.status);
    }
    console.error('OpenAPI discovery error', cause);
    return publicCorsJson({ error: 'API description is unavailable.', code: 'internal_error' }, METHODS, 500);
  }
}

export const HEAD = GET;
