import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GET as getOpenApi } from '../routes/openapi.js';
import { GET as getOperations } from '../routes/operations.js';
import { HEADLESS_OPERATION_CATALOG } from '../../../../src/stellar/headlessOperations.js';
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
  const intentExecution = paths['/api/intent'].put as JsonObject;
  const build = paths['/api/contract-call'].post as JsonObject;
  const prepare = paths['/api/contract-prepare'].post as JsonObject;
  const paymentPrepare = paths['/api/payment-prepare'].post as JsonObject;

  assert.deepEqual(inspect.security, []);
  assert.equal(inspect.operationId, 'contract.interface.inspect');
  assert.equal(intent.operationId, 'contract.intent.create.integration.intent.create');
  assert.deepEqual(intent['x-multisig-operation-ids'], ['contract.intent.create', 'integration.intent.create']);
  assert.deepEqual(intent.security, [{ agentBearer: [] }, { integrationBearer: [] }, { humanSession: [] }]);
  assert.equal(intentInspect.operationId, 'contract.intent.inspect.integration.intent.inspect.integration.intent.browser.inspect');
  assert.deepEqual(intentInspect.security, [{ agentBearer: [] }, { integrationBearer: [] }, { humanSession: [] }, { intentCapability: [] }]);
  assert.equal(intentContribute.operationId, 'contract.intent.contribute.integration.intent.browser.contribute');
  assert.deepEqual(intentContribute.security, [{ agentBearer: [] }, { humanSession: [] }, { intentCapability: [] }]);
  assert.equal(intentExecution.operationId, 'contract.intent.execution.prepare.integration.intent.execution.prepare.contract.intent.execution.reconcile.integration.intent.execution.reconcile.contract.intent.replan.integration.intent.replan.contract.intent.cancel.integration.intent.cancel.integration.intent.browser.issue');
  assert.deepEqual(intentExecution['x-multisig-operation-ids'], [
    'contract.intent.execution.prepare',
    'integration.intent.execution.prepare',
    'contract.intent.execution.reconcile',
    'integration.intent.execution.reconcile',
    'contract.intent.replan',
    'integration.intent.replan',
    'contract.intent.cancel',
    'integration.intent.cancel',
    'integration.intent.browser.issue',
  ]);
  assert.deepEqual(intentExecution.security, [{ agentBearer: [] }, { integrationBearer: [] }, { humanSession: [] }]);
  assert.equal(build.operationId, 'contract.call.build');
  assert.equal(prepare.operationId, 'contract.call.prepare');
  assert.equal(paymentPrepare.operationId, 'classic.payment.prepare.integration.classic.payment.prepare');
  assert.deepEqual(paymentPrepare.security, [{ agentBearer: [] }, { integrationBearer: [] }, { humanSession: [] }]);
  assert.equal(paths['/api/preparation'], undefined);

  const components = document.components as JsonObject;
  const schemas = (components.schemas as Record<string, JsonObject>);
  const securitySchemes = components.securitySchemes as Record<string, JsonObject>;
  assert.ok(securitySchemes.integrationBearer);
  assert.ok(securitySchemes.intentCapability);
  assert.match(String(securitySchemes.integrationBearer.description), /non-signer external service credential/i);
  assert.match(String(securitySchemes.intentCapability.description), /mic_/);
  assert.deepEqual(schemas.ContractIntentCreateInput.required, ['network']);
  assert.deepEqual(schemas.ContractInterfaceResult.required, ['operation', 'version', 'network', 'contractId', 'methods', 'abi']);
  assert.deepEqual(schemas.ContractAbi.required, ['schema', 'functions', 'types']);
  assert.deepEqual((schemas.ContractAbi.properties as JsonObject).schema, { type: 'string', const: 'fresnica-soroban-abi-v1' });
  assert.deepEqual(schemas.ContractInputComposition.required, ['mode', 'guided']);
  assert.ok((((schemas.ContractInput.properties as JsonObject).kind as JsonObject).enum as string[]).includes('json'));
  assert.equal(((schemas.ContractIntentCreateInput.properties as JsonObject).arguments as JsonObject).additionalProperties, true);
  assert.ok(!(schemas.StoredSorobanIntent.required as string[]).includes('creatorAddress'));
  assert.ok((schemas.StoredSorobanIntent.properties as JsonObject).integration);
  assert.ok((schemas.SigningRequest.properties as JsonObject).execution);
  assert.deepEqual(schemas.RequestExecution.oneOf, [{ $ref: '#/components/schemas/MultiSigToolsExecution' }, { $ref: '#/components/schemas/ExternalServiceExecution' }]);
  assert.ok(!(schemas.ServiceIntegrationContext.required as string[]).includes('executionMode'));
  assert.ok((schemas.StoredSorobanIntent.properties as JsonObject).executionPolicy);
  assert.ok((schemas.StoredSorobanIntent.properties as JsonObject).cancellation);
  assert.deepEqual((schemas.ExecutionPolicy.properties as JsonObject).mode, { type: 'string', enum: ['multisigtools', 'external'] });
  assert.deepEqual(schemas.ContractIntentCreateInput.oneOf, [
    { required: ['contractId', 'method', 'arguments'] },
    { required: ['preparedXdr'] },
  ]);
  assert.deepEqual(schemas.ContractIntentInspectResult.required, ['operation', 'version', 'intent', 'authorization', 'evidence']);
  assert.deepEqual(schemas.IntegrationSorobanJob.required, ['version', 'id', 'kind', 'network', 'state', 'nextActions', 'reviewUrl']);
  assert.deepEqual((schemas.IntegrationSorobanJob.properties as JsonObject).state, {
    type: 'string', enum: ['waiting_for_authorization', 'ready', 'executing', 'completed', 'expired', 'failed', 'cancelled'],
  });
  assert.deepEqual(((schemas.IntegrationSorobanJob.properties as JsonObject).nextActions as JsonObject).items, {
    type: 'string', enum: ['prepare_execution', 'submit_execution', 'reconcile_execution', 'refresh_execution', 'replan', 'cancel'],
  });
  for (const name of ['ContractIntentCreateResult', 'ContractIntentInspectResult', 'ContractIntentExecutionResult', 'ContractIntentExecutionReconcileResult', 'ContractIntentReplanResult', 'ContractIntentCancelResult']) {
    assert.ok((schemas[name].properties as JsonObject).job);
  }
  assert.deepEqual(schemas.AgentTask.required, ['version', 'id', 'kind', 'network', 'state', 'nextActions']);
  assert.deepEqual((schemas.AgentTask.properties as JsonObject).state, {
    type: 'string', enum: ['action_required', 'waiting', 'completed', 'expired', 'failed', 'cancelled'],
  });
  const agentTaskAction = (((schemas.AgentTask.properties as JsonObject).nextActions as JsonObject).items as JsonObject);
  assert.deepEqual(agentTaskAction.required, ['code', 'requiredAccess', 'available']);
  for (const name of ['ContractIntentCreateResult', 'ContractIntentInspectResult', 'ContractIntentContributionResult', 'ContractIntentExecutionResult', 'ContractIntentExecutionReconcileResult', 'ContractIntentReplanResult', 'ContractIntentCancelResult', 'ProposalResult']) {
    assert.ok((schemas[name].properties as JsonObject).task);
  }
  assert.deepEqual(schemas.SorobanIntentEvidenceEvent.required, [
    'version', 'eventId', 'type', 'occurredAt', 'authorizationPlanDigest', 'authorizationPlanRevision',
  ]);
  assert.deepEqual((schemas.SorobanIntentEvidenceEvent.properties as JsonObject).type, {
    type: 'string', enum: ['intent_created', 'intent_cancelled', 'authorization_added', 'authorization_plan_revised', 'execution_prepared', 'execution_confirmed', 'execution_failed'],
  });
  assert.deepEqual(schemas.ContractIntentContributionInput.required, ['entryIndex', 'signatureBase64']);
  assert.deepEqual(schemas.ContractIntentCancelInput.required, ['action']);
  assert.equal(((schemas.ContractIntentCancelInput.properties as JsonObject).action as JsonObject).const, 'cancel');
  assert.match(String(((schemas.ContractIntentCancelInput.properties as JsonObject).action as JsonObject).description), /cannot be revoked/i);
  assert.ok((schemas.ProposalCreateInput.properties as JsonObject).sorobanIntentId);
  assert.deepEqual(schemas.SorobanRequestOrigin.required, ['version', 'intentId', 'authorizationPlanDigest', 'authorizationPlanRevision', 'executionPreparedAt', 'effectsDigest']);
  assert.ok((schemas.SigningRequest.properties as JsonObject).sorobanOrigin);
  assert.deepEqual(schemas.ContractIntentExecutionInput.anyOf, [
    { required: ['executor'] },
    { required: ['executionSource'] },
    { required: ['action'] },
  ]);
  const executionInput = schemas.ContractIntentExecutionInput.properties as JsonObject;
  assert.ok(executionInput.executor);
  assert.equal((executionInput.executionSource as JsonObject).deprecated, true);
  assert.ok(executionInput.acceptedEffectsDigest);
  assert.deepEqual((schemas.ExecutionPolicy.properties as JsonObject).fallback, { type: 'string', const: 'multisigtools_managed' });
  assert.deepEqual(schemas.SorobanExecutorBinding.required, ['address', 'source']);
  assert.deepEqual((schemas.SorobanExecutorBinding.properties as JsonObject).source, {
    type: 'string', enum: ['intent', 'service_default', 'contract_policy', 'service_prepare', 'multisigtools_managed'],
  });
  assert.ok((schemas.ContractIntentCreateInput.properties as JsonObject).executor);
  assert.ok((schemas.SorobanIntentExecutionPreparation.properties as JsonObject).effects);
  assert.ok((schemas.SorobanIntentExecutionPreparation.properties as JsonObject).preparedAt);
  assert.deepEqual(schemas.ContractIntentExecutionReconcileInput.required, ['action', 'transactionHash']);
  assert.deepEqual(schemas.ContractIntentExecutionReconcileResult.required, ['operation', 'version', 'transactionHash', 'observed', 'replayed']);
  assert.deepEqual(schemas.SorobanIntentExecutionObservation.required, ['version', 'transactionHash', 'authorizationPlanDigest', 'authorizationPlanRevision', 'executionSource', 'ledger', 'successful', 'observedAt']);
  assert.deepEqual(schemas.SorobanEffectsDiff.required, ['version', 'kind', 'severity', 'requiresExplicitReview', 'requiresReauthorization', 'expectedDigest', 'currentDigest', 'structureChanged', 'maxChangeBasisPoints', 'numericChanges']);
  assert.deepEqual(schemas.ContractIntentReplanInput.required, ['action']);
  assert.deepEqual(schemas.ContractCallBuildInput.required, [
    'network',
    'transactionSource',
    'contractId',
    'method',
    'arguments',
    'lifetimeSeconds',
  ]);
  assert.deepEqual(schemas.ContractPrepareInput.required, ['network', 'xdr']);
  assert.deepEqual((schemas.ContractPrepareInput.properties as JsonObject).mode, { type: 'string', enum: ['record', 'enforce'], default: 'record' });
  assert.deepEqual(schemas.ContractPrepareResult.required, ['operation', 'version', 'mode', 'simulation']);
  assert.deepEqual(schemas.ContractEnforceResult.required, ['operation', 'version', 'mode', 'verification']);
  assert.deepEqual(schemas.ClassicPaymentPrepareInput.required, ['network', 'sourceAccount', 'payments']);
  assert.deepEqual(schemas.ClassicPaymentInstructionInput.required, ['sourceAccount', 'payments']);
  assert.deepEqual(schemas.ProposalCreateInput.required, ['network']);
  assert.deepEqual(schemas.ProposalCreateInput.oneOf, [
    { required: ['xdr'] },
    { required: ['payment'], description: 'Semantic Classic payment creation is currently available to Integration Service callers.' },
  ]);
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
  const config = JSON.parse(readFileSync(new URL('../../../../vercel.json', import.meta.url), 'utf8')) as {
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

  const html = readFileSync(new URL('../../../../index.html', import.meta.url), 'utf8');
  assert.match(html, /rel="service-desc"[^>]+href="\/openapi\.json"/);
  assert.match(html, /rel="service-doc"[^>]+href="\/developers"/);
});
