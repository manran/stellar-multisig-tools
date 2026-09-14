import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GET as getOpenApi } from '../api/openapi.js';
import { GET as getOperations } from '../api/operations.js';
import { HEADLESS_OPERATION_CATALOG } from '../src/stellar/headlessOperations.js';
import { createOpenApiDocument } from './openApiDocument.js';

type JsonObject = Record<string, unknown>;
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const networkVariable = 'VITE_STELLAR_DEPLOYMENT_NETWORK';
const originalNetwork = process.env[networkVariable];

test.afterEach(() => {
  if (originalNetwork === undefined) delete process.env[networkVariable];
  else process.env[networkVariable] = originalNetwork;
});

function documentedOperations(document: JsonObject) {
  const paths = document.paths as Record<string, JsonObject>;
  return Object.entries(paths).flatMap(([path, pathItem]) =>
    Object.entries(pathItem)
      .filter(([method]) => HTTP_METHODS.has(method))
      .map(([method, operation]) => ({
        path,
        method: method.toUpperCase(),
        operation: operation as JsonObject,
      })));
}

test('OpenAPI covers every catalog transport and business operation exactly once', () => {
  const document = createOpenApiDocument('https://testnet.multisig.tools', 'testnet');
  const transports = documentedOperations(document);
  const expectedTransports = [...new Set(HEADLESS_OPERATION_CATALOG.map(
    (operation) => `${operation.method} ${operation.path}`,
  ))].sort();
  assert.deepEqual(
    transports.map((item) => `${item.method} ${item.path}`).sort(),
    expectedTransports,
  );

  const documentedIds = transports.flatMap((item) =>
    item.operation['x-multisig-operation-ids'] as string[]);
  assert.deepEqual(
    [...documentedIds].sort(),
    HEADLESS_OPERATION_CATALOG.map((operation) => operation.id).sort(),
  );
  assert.equal(document['x-multisig-deployment-network'], 'testnet');
  assert.deepEqual(document.servers, [{ url: 'https://testnet.multisig.tools' }]);

  const operationIds = transports.map((item) => item.operation.operationId as string);
  assert.equal(new Set(operationIds).size, operationIds.length);
  const components = document.components as JsonObject;
  const schemas = components.schemas as Record<string, JsonObject>;
  const references = [...JSON.stringify(document).matchAll(
    /#\/components\/schemas\/([^"]+)/g,
  )].map((match) => match[1]);
  assert.ok(references.length > 0);
  assert.ok(references.every((name) => Object.hasOwn(schemas, name)));
});

test('OpenAPI describes the public Contract composition without UI state', () => {
  const document = createOpenApiDocument();
  const paths = document.paths as Record<string, JsonObject>;
  const inspect = paths['/api/contract-interface'].get as JsonObject;
  const intent = paths['/api/intent'].post as JsonObject;
  const intentInspect = paths['/api/intent'].get as JsonObject;
  const intentContribute = paths['/api/intent'].patch as JsonObject;
  const build = paths['/api/contract-call'].post as JsonObject;
  const prepare = paths['/api/contract-prepare'].post as JsonObject;
  const mutation = paths['/api/preparation'].patch as JsonObject;

  assert.deepEqual(inspect.security, []);
  assert.equal(inspect.operationId, 'contract.interface.inspect');
  assert.equal(intent.operationId, 'contract.intent.create');
  assert.deepEqual(intent.security, [{ agentBearer: [] }]);
  assert.equal(intentInspect.operationId, 'contract.intent.inspect');
  assert.equal(intentContribute.operationId, 'contract.intent.contribute');
  assert.deepEqual(intentContribute.security, [{ agentBearer: [] }]);
  assert.equal(build.operationId, 'contract.call.build');
  assert.equal(prepare.operationId, 'contract.call.prepare');
  assert.equal(mutation.operationId, 'contract.authorization.mutate');
  assert.deepEqual(mutation['x-multisig-operation-ids'], [
    'contract.authorization.contribute',
    'contract.authorization.refresh',
  ]);

  const components = document.components as JsonObject;
  const schemas = (components.schemas as Record<string, JsonObject>);
  assert.deepEqual(schemas.ContractIntentCreateInput.required, ['network', 'contractId', 'method', 'arguments']);
  assert.deepEqual(schemas.ContractIntentContributionInput.required, ['entryIndex', 'signatureBase64']);
  assert.deepEqual(schemas.ContractCallBuildInput.required, [
    'network',
    'transactionSource',
    'contractId',
    'method',
    'arguments',
    'lifetimeSeconds',
  ]);
  assert.deepEqual(schemas.ContractPrepareInput.required, ['network', 'xdr']);
});

test('discovery endpoints expose the deployment-bound description and schema pointers', async () => {
  process.env[networkVariable] = 'testnet';
  const openApiResponse = await getOpenApi(
    new Request('https://testnet.multisig.tools/openapi.json'),
  );
  assert.equal(openApiResponse.status, 200);
  assert.match(openApiResponse.headers.get('content-type') ?? '', /^application\/vnd\.oai\.openapi\+json/);
  const document = await openApiResponse.json() as JsonObject;
  assert.equal(document['x-multisig-deployment-network'], 'testnet');

  const catalogResponse = await getOperations();
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json() as {
    openapi: string;
    documentation: string;
    operations: Array<{ id: string; schema: { href: string; path: string; method: string } }>;
  };
  assert.equal(catalog.openapi, '/openapi.json');
  assert.equal(catalog.documentation, '/developers');
  assert.equal(catalog.operations.length, HEADLESS_OPERATION_CATALOG.length);
  assert.ok(catalog.operations.every((operation) =>
    operation.schema.href === '/openapi.json'
    && operation.schema.path.startsWith('/api/')
    && HTTP_METHODS.has(operation.schema.method.toLowerCase())));
});

test('root HTTP metadata advertises standard service description and documentation links', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    rewrites: Array<{ source: string; destination: string }>;
  };
  const globalHeaders = new Map(config.headers[0].headers.map((header) => [header.key, header.value]));
  const link = globalHeaders.get('Link') ?? '';
  assert.match(link, /<\/openapi\.json>; rel="service-desc"/);
  assert.match(link, /<\/developers>; rel="service-doc"/);
  assert.equal(globalHeaders.get('Access-Control-Expose-Headers'), 'Link');
  assert.ok(config.rewrites.some((rewrite) =>
    rewrite.source === '/openapi.json' && rewrite.destination === '/api/openapi'));

  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /rel="service-desc"[^>]+href="\/openapi\.json"/);
  assert.match(html, /rel="service-doc"[^>]+href="\/developers"/);
});
