import {
  STELLAR_PUBLIC_DOCS_BASE,
  stellarApiBaseForDeployment,
} from '../../../../src/stellar/apiOrigins.js';
import { HEADLESS_OPERATION_CATALOG } from '../../../../src/stellar/headlessOperations.js';
import { configuredDeploymentNetwork } from '../server/deploymentNetworkPolicy.js';
import { publicCorsHeaders, publicCorsJson } from '../server/httpResponse.js';

const METHODS = 'GET, OPTIONS';

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: publicCorsHeaders(METHODS) });
}

export async function GET(): Promise<Response> {
  const apiBase = stellarApiBaseForDeployment(configuredDeploymentNetwork());
  const openapi = `${apiBase}/openapi.json`;

  return publicCorsJson({
    contract: 'multisig-tools.headless-operations',
    version: 1,
    base: apiBase,
    openapi,
    documentation: `${STELLAR_PUBLIC_DOCS_BASE}/developers`,
    operations: HEADLESS_OPERATION_CATALOG.map((operation) => ({
      ...operation,
      schema: {
        href: openapi,
        path: operation.path,
        method: operation.method,
      },
    })),
  }, METHODS);
}
