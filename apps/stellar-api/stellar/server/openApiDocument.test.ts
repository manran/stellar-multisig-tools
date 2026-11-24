import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GET as getOpenApi } from '../routes/openapi.js';
import { GET as getOperations } from '../routes/operations.js';
import {
  STELLAR_PUBLIC_DOCS_BASE,
  STELLAR_TESTNET_API_BASE,
} from '../../../../packages/stellar-core/src/apiOrigins.js';
import { HEADLESS_OPERATION_CATALOG } from '../../../../packages/stellar-core/src/headlessOperations.js';
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
  const testnetIntegrationCreate = paths['/integration-testnet'].post as JsonObject;
  const inspect = paths['/contract-interface'].get as JsonObject;
  const intent = paths['/intent'].post as JsonObject;
  const intentInspect = paths['/intent'].get as JsonObject;
  const intentContribute = paths['/intent'].patch as JsonObject;
  const intentExecution = paths['/intent'].put as JsonObject;
  const build = paths['/contract-call'].post as JsonObject;
  const prepare = paths['/contract-prepare'].post as JsonObject;
  const integrationExecution = paths['/integration-execution'].get as JsonObject;
  const paymentPrepare = paths['/payment-prepare'].post as JsonObject;
  const requestCreate = paths['/request'].post as JsonObject;
  const requestSubmit = paths['/request'].put as JsonObject;

  assert.equal(testnetIntegrationCreate.operationId, 'integration.testnet.create');
  assert.deepEqual(testnetIntegrationCreate.security, []);
  assert.deepEqual(testnetIntegrationCreate['x-multisig-access'], ['public']);
  assert.equal((((testnetIntegrationCreate.requestBody as JsonObject).content as JsonObject)['application/json'] as JsonObject).schema && ((((testnetIntegrationCreate.requestBody as JsonObject).content as JsonObject)['application/json'] as JsonObject).schema as JsonObject).$ref, '#/components/schemas/TestnetIntegrationCreateInput');
  assert.ok((testnetIntegrationCreate.responses as JsonObject)['201']);
  assert.deepEqual(inspect.security, []);
  assert.equal(inspect.operationId, 'contract.interface.inspect');
  assert.equal(intent.operationId, 'contract.intent.create.integration.intent.create');
  assert.deepEqual(intent['x-multisig-operation-ids'], ['contract.intent.create', 'integration.intent.create']);
  assert.deepEqual(intent.security, [{ agentBearer: [] }, { integrationBearer: [] }, { humanBearer: [] }, { humanSession: [] }]);
  assert.equal(intentInspect.operationId, 'contract.intent.inspect.integration.intent.inspect.integration.intent.browser.inspect');
  assert.deepEqual(intentInspect.security, [{ agentBearer: [] }, { integrationBearer: [] }, { humanBearer: [] }, { humanSession: [] }, { intentCapability: [] }]);
  assert.equal(intentContribute.operationId, 'contract.intent.contribute.integration.intent.browser.contribute');
  assert.deepEqual(intentContribute.security, [{ agentBearer: [] }, { humanBearer: [] }, { humanSession: [] }, { intentCapability: [] }]);
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
  assert.deepEqual(intentExecution.security, [{ agentBearer: [] }, { integrationBearer: [] }, { humanBearer: [] }, { humanSession: [] }]);
  assert.equal(build.operationId, 'contract.call.build');
  assert.equal(prepare.operationId, 'contract.call.prepare');
  assert.equal(integrationExecution.operationId, 'integration.execution.inspect');
  assert.deepEqual(integrationExecution.security, [{ integrationBearer: [] }]);
  assert.deepEqual(integrationExecution['x-multisig-operation-ids'], ['integration.execution.inspect']);
  assert.equal(paymentPrepare.operationId, 'classic.payment.prepare.integration.classic.payment.prepare');
  assert.deepEqual(paymentPrepare.security, [{ agentBearer: [] }, { integrationBearer: [] }, { humanBearer: [] }, { humanSession: [] }]);
  assert.equal(requestCreate.operationId, 'proposal.create.integration.request.create');
  assert.equal(requestSubmit.operationId, 'proposal.submit.integration.request.submit');
  const requestPatch = paths['/request'].patch as JsonObject;
  assert.deepEqual(requestPatch['x-multisig-operation-ids'], ['proposal.contribute', 'proposal.decline', 'proposal.activity.retain']);
  const patchVariants = ((document.components as JsonObject).schemas as Record<string, JsonObject>).ProposalPatchInput.oneOf as JsonObject[];
  assert.equal(patchVariants.find((item) => (item.required as string[]).includes('retainActivity'))?.['x-multisig-access'], 'human');
  assert.ok((intentExecution.responses as JsonObject)['201']);
  assert.ok((testnetIntegrationCreate.responses as JsonObject)['413']);
  assert.ok((testnetIntegrationCreate.responses as JsonObject)['415']);
  assert.deepEqual(requestSubmit.security, [{ integrationBearer: [] }, { humanBearer: [] }, { humanSession: [] }, { requestCapability: [] }]);
  const inbox = paths['/inbox'].get as JsonObject;
  assert.equal(inbox.operationId, 'signer.inbox.list');
  assert.deepEqual(inbox.security, [{ agentBearer: [] }, { humanSession: [] }]);
  assert.deepEqual(inbox['x-multisig-effects'], ['none']);
  assert.ok(((paths['/agent-grants'].post as JsonObject).responses as JsonObject)['201']);
  assert.equal((paths['/auth'].get as JsonObject).operationId, 'signer.auth.challenge');
  assert.equal((paths['/auth'].post as JsonObject).operationId, 'signer.auth.exchange');
  assert.deepEqual((paths['/agent-access'].delete as JsonObject).security, [{ humanBearer: [] }, { humanSession: [] }]);
  assert.deepEqual((paths['/agent-grants'].get as JsonObject)['x-multisig-operation-ids'], ['agent.grant.inspect', 'agent.grant.challenge']);
  assert.equal(paths['/preparation'], undefined);

  const components = document.components as JsonObject;
  const schemas = (components.schemas as Record<string, JsonObject>);
  const securitySchemes = components.securitySchemes as Record<string, JsonObject>;
  assert.ok(securitySchemes.integrationBearer);
  assert.ok(securitySchemes.intentCapability);
  assert.match(String(securitySchemes.integrationBearer.description), /non-signer external service credential/i);
  assert.match(String(securitySchemes.intentCapability.description), /mic_/);
  assert.deepEqual(schemas.TestnetIntegrationCreateInput.required, ['serviceId', 'label']);
  assert.deepEqual(schemas.TestnetIntegrationCreateResult.required, ['operation', 'version', 'service', 'apiKey']);
  assert.deepEqual(schemas.RuntimeConfigResult.required, ['operation', 'version', 'stellarNetwork', 'fixedNetwork', 'capabilities']);
  assert.deepEqual(
    (((schemas.RuntimeConfigResult.properties as JsonObject).capabilities as JsonObject).properties as JsonObject).classicManagedExecution,
    {
      type: 'object',
      required: ['testnet', 'public'],
      properties: { testnet: { type: 'boolean' }, public: { type: 'boolean' } },
      additionalProperties: false,
    },
  );
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
  assert.deepEqual(schemas.AgentTask.required, ['version', 'id', 'kind', 'network', 'state', 'signatureRequired', 'nextActions']);
  assert.equal(((schemas.AgentTask.properties as JsonObject).signatureRequired as JsonObject).type, 'boolean');
  assert.equal(((schemas.SignerInboxResult.properties as JsonObject).signature_required_count as JsonObject).type, 'integer');
  assert.deepEqual(((schemas.AgentTask.properties as JsonObject).state as JsonObject).enum, ['action_required', 'waiting', 'completed', 'expired', 'failed', 'cancelled']);
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
  assert.deepEqual(schemas.IntegrationExecutionInspectResult.required, ['operation', 'version', 'serviceId', 'network', 'classic']);
  assert.deepEqual(((schemas.IntegrationExecutionInspectResult.properties as JsonObject).classic as JsonObject).required, ['scopeConfigured', 'managedAvailable', 'managedSourceAccountCount', 'externalSourceAccountCount', 'channelCount', 'channelSoftLimit', 'channelAccounts']);
  assert.deepEqual(schemas.ClassicPaymentPrepareInput.required, ['network', 'sourceAccount', 'payments']);
  assert.ok((schemas.ClassicPaymentPrepareResult.properties as JsonObject).transactionSourceAccount);
  assert.ok((schemas.ClassicPaymentPrepareResult.properties as JsonObject).transactionSourceSequence);
  assert.deepEqual(schemas.ClassicPaymentInstructionInput.required, ['sourceAccount', 'payments']);
  assert.deepEqual(schemas.ProposalCreateInput.required, ['network']);
  assert.deepEqual(schemas.ProposalCreateInput.oneOf, [
    { required: ['xdr'] },
    { required: ['payment'], description: 'Semantic Classic payment creation is available to Integration Service callers. For MST-managed semantic execution, runtime capabilities.classicManagedExecution must be true for the selected network. Otherwise prepare an unsigned payment with integration.classic.payment.prepare and create a Request using its xdr, or explicitly configure external execution.' },
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
  assert.deepEqual(document.servers, [{ url: STELLAR_TESTNET_API_BASE }]);
  assert.equal((document.externalDocs as JsonObject).url, `${STELLAR_PUBLIC_DOCS_BASE}/developers`);

  const catalogResponse = await getOperations();
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json() as {
    base: string;
    openapi: string;
    documentation: string;
    operations: Array<{ id: string; schema: { href: string; path: string; method: string } }>;
  };
  assert.equal(catalog.base, STELLAR_TESTNET_API_BASE);
  assert.equal(catalog.openapi, `${STELLAR_TESTNET_API_BASE}/openapi.json`);
  assert.equal(catalog.documentation, `${STELLAR_PUBLIC_DOCS_BASE}/developers`);
  assert.equal(catalog.operations.length, HEADLESS_OPERATION_CATALOG.length);
  assert.ok(catalog.operations.every((operation) =>
    operation.schema.href === `${STELLAR_TESTNET_API_BASE}/openapi.json`
    && operation.schema.path.startsWith('/')
    && !operation.schema.path.startsWith('/api/')
    && HTTP_METHODS.has(operation.schema.method.toLowerCase())));
});

test('Stellar API deployment advertises standard service description and documentation links', () => {
  const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as {
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    rewrites: Array<{ source: string; destination: string }>;
  };
  const globalHeaders = new Map(config.headers[0].headers.map((header) => [header.key, header.value]));
  const link = globalHeaders.get('Link') ?? '';
  assert.match(link, /<\/openapi\.json>; rel="service-desc"/);
  assert.match(link, /<https:\/\/docs\.multisig\.tools\/stellar\/developers>; rel="service-doc"/);
  assert.equal(globalHeaders.get('Access-Control-Expose-Headers'), 'Link');
  assert.ok(config.rewrites.some((rewrite) =>
    rewrite.source === '/openapi.json' && rewrite.destination === '/api/openapi'));
});
