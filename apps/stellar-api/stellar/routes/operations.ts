import {
  STELLAR_PUBLIC_DOCS_BASE,
  stellarApiBaseForDeployment,
} from '../../../../packages/stellar-core/src/apiOrigins.js';
import { HEADLESS_API_REVISION, HEADLESS_OPERATION_CATALOG } from '../../../../packages/stellar-core/src/headlessOperations.js';
import { configuredDeploymentNetwork } from '../server/deploymentNetworkPolicy.js';
import { publicCorsHeaders, publicDiscoveryJson } from '../server/httpResponse.js';

const METHODS = 'GET, HEAD, OPTIONS';

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: publicCorsHeaders(METHODS) });
}

export async function GET(request?: Request): Promise<Response> {
  const apiBase = stellarApiBaseForDeployment(configuredDeploymentNetwork());
  const openapi = `${apiBase}/openapi.json`;

  return publicDiscoveryJson(request, {
    contract: 'multisig-tools.headless-operations',
    version: 1,
    apiVersion: HEADLESS_API_REVISION,
    base: apiBase,
    openapi,
    documentation: `${STELLAR_PUBLIC_DOCS_BASE}/developers`,
    operations: HEADLESS_OPERATION_CATALOG.map((operation) => ({
      ...operation,
      schema: {
        href: openapi,
        path: operation.path,
        method: operation.method,
        pointer: '#/x-multisig-operations/' + operation.id,
      },
    })),
  }, METHODS);
}

export const HEAD = GET;
