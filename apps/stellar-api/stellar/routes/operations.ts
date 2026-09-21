import { publicCorsHeaders, publicCorsJson } from '../server/httpResponse.js';
import { HEADLESS_OPERATION_CATALOG } from '../../../../src/stellar/headlessOperations.js';

const METHODS = 'GET, OPTIONS';

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: publicCorsHeaders(METHODS) });
}

export async function GET(): Promise<Response> {
  return publicCorsJson({
    contract: 'multisig-tools.headless-operations',
    version: 1,
    openapi: '/openapi.json',
    documentation: '/developers',
    operations: HEADLESS_OPERATION_CATALOG.map((operation) => ({
      ...operation,
      schema: {
        href: '/openapi.json',
        path: operation.path,
        method: operation.method,
      },
    })),
  }, METHODS);
}
