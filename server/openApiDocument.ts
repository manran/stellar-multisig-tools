import {
  HEADLESS_OPERATION_CATALOG,
  type HeadlessOperationAccess,
  type HeadlessOperationDescriptor,
} from '../src/stellar/headlessOperations.js';

type OpenApiObject = Record<string, unknown>;

const schema = (name: string): OpenApiObject => ({ $ref: `#/components/schemas/${name}` });
const jsonContent = (value: OpenApiObject): OpenApiObject => ({
  'application/json': { schema: value },
});
const body = (value: OpenApiObject): OpenApiObject => ({
  required: true,
  content: jsonContent(value),
});
const response = (description: string, value: OpenApiObject): OpenApiObject => ({
  description,
  content: jsonContent(value),
});
const parameter = (
  name: string,
  location: 'header' | 'query',
  required: boolean,
  value: OpenApiObject,
  description: string,
): OpenApiObject => ({ name, in: location, required, schema: value, description });

function operationParameters(path: string, method: string): OpenApiObject[] {
  const values: OpenApiObject[] = [];
  if (path === '/api/contract-interface') {
    values.push(
      parameter('network', 'query', true, schema('StellarNetwork'), 'Must match this deployment.'),
      parameter('contract', 'query', true, { type: 'string', pattern: '^C[A-Z2-7]{55}$' }, 'Stellar contract address.'),
    );
  }
  if (path === '/api/request') {
    values.push(
      parameter('x-multisig-request-id', 'header', method !== 'post', { type: 'string' }, 'Authorization or Proposal id.'),
      parameter('x-multisig-capability', 'header', false, { type: 'string' }, 'Private share capability when using capability access.'),
    );
  }
  if (path === '/api/request' && method === 'get') {
    values.push(
      parameter('view', 'query', false, { type: 'string', enum: ['history'] }, 'Request retained history projection.'),
      parameter('account', 'query', false, { type: 'string', pattern: '^G[A-Z2-7]{55}$' }, 'Optional Treasury scope for history.'),
    );
  }
  if (path === '/api/intent' && method !== 'post') {
    values.push(parameter('X-MultiSig-Intent-Id', 'header', true, { type: 'string' }, 'Soroban Intent id.'));
  }
  if (path === '/api/intent' && method === 'post') {
    values.push(parameter('Idempotency-Key', 'header', false, { type: 'string' }, 'Required for Agent or Integration Intent creation; Human sessions do not need it.'));
  }
  if (path === '/api/request' && method === 'post') {
    values.push(parameter('Idempotency-Key', 'header', false, { type: 'string' }, 'Required for Agent or Integration Request creation; ignored for Human sessions.'));
  }
  return values;
}

function requestBody(path: string, method: string): OpenApiObject | undefined {
  if (path === '/api/intent' && method === 'post') return body(schema('ContractIntentCreateInput'));
  if (path === '/api/intent' && method === 'patch') return body(schema('ContractIntentContributionInput'));
  if (path === '/api/intent' && method === 'put') return body({ oneOf: [schema('ContractIntentExecutionInput'), schema('ContractIntentExecutionReconcileInput'), schema('ContractIntentReplanInput')] });
  if (path === '/api/contract-call' && method === 'post') return body(schema('ContractCallBuildInput'));
  if (path === '/api/contract-prepare' && method === 'post') return body(schema('ContractPrepareInput'));
  if (path === '/api/contracts' && (method === 'put' || method === 'delete')) return body(schema('ContractWorkspaceInput'));
  if (path === '/api/payment-prepare' && method === 'post') return body(schema('ClassicPaymentPrepareInput'));
  if (path === '/api/account-create-prepare' && method === 'post') return body(schema('ClassicCreateAccountPrepareInput'));
  if (path === '/api/request' && method === 'post') return body(schema('ProposalCreateInput'));
  if (path === '/api/request' && method === 'patch') return body(schema('ProposalPatchInput'));
  return undefined;
}

function successSchema(path: string, method: string): OpenApiObject {
  if (path === '/api/runtime-config') return schema('RuntimeConfigResult');
  if (path === '/api/contract-interface') return schema('ContractInterfaceResult');
  if (path === '/api/intent' && method === 'post') return schema('ContractIntentCreateResult');
  if (path === '/api/intent' && method === 'get') return schema('ContractIntentInspectResult');
  if (path === '/api/intent' && method === 'patch') return schema('ContractIntentContributionResult');
  if (path === '/api/intent' && method === 'put') return { oneOf: [schema('ContractIntentExecutionResult'), schema('ContractIntentExecutionReconcileResult'), schema('ContractIntentReplanResult')] };
  if (path === '/api/contract-call') return schema('ContractCallBuildResult');
  if (path === '/api/contract-prepare') return { oneOf: [schema('ContractPrepareResult'), schema('ContractEnforceResult')] };
  if (path === '/api/contracts' && method === 'get') return schema('ContractWorkspaceListResult');
  if (path === '/api/contracts' && method === 'put') return schema('ContractWorkspaceKeepResult');
  if (path === '/api/contracts' && method === 'delete') return schema('ContractWorkspaceForgetResult');
  if (path === '/api/payment-prepare') return schema('ClassicPaymentPrepareResult');
  if (path === '/api/account-create-prepare') return schema('ClassicCreateAccountPrepareResult');
  if (path === '/api/request') return schema('ProposalResult');
  return { type: 'object', additionalProperties: true };
}

function security(path: string, method: string, access: HeadlessOperationAccess): OpenApiObject[] {
  if (access === 'public') return [];
  if (path === '/api/intent') {
    if (method === 'patch') return [{ agentBearer: [] }, { humanSession: [] }];
    return [{ agentBearer: [] }, { integrationBearer: [] }, { humanSession: [] }];
  }
  if (path === '/api/contracts') return [{ agentBearer: [] }, { humanSession: [] }];
  if (path === '/api/payment-prepare' || path === '/api/account-create-prepare') return [{ agentBearer: [] }, { integrationBearer: [] }, { humanSession: [] }];
  if (path === '/api/request' && method === 'put') return [{ humanSession: [] }, { requestCapability: [] }];
  if (path === '/api/request' && (method === 'post' || method === 'get')) {
    return [{ agentBearer: [] }, { integrationBearer: [] }, { humanSession: [] }, { requestCapability: [] }];
  }
  return [{ agentBearer: [] }, { humanSession: [] }, { requestCapability: [] }];
}

function transportOperationId(path: string, method: string, operations: readonly HeadlessOperationDescriptor[]): string {
  if (operations.length === 1) return operations[0].id;
  return operations.map((item) => item.id).join('.');
}

function openApiPaths(): OpenApiObject {
  const groups = new Map<string, HeadlessOperationDescriptor[]>();
  for (const operation of HEADLESS_OPERATION_CATALOG) {
    const key = `${operation.method.toLowerCase()} ${operation.path}`;
    groups.set(key, [...(groups.get(key) ?? []), operation]);
  }

  const paths: OpenApiObject = {};
  for (const [key, operations] of groups) {
    const separator = key.indexOf(' ');
    const method = key.slice(0, separator);
    const path = key.slice(separator + 1);
    const first = operations[0];
    const parameters = operationParameters(path, method);
    const request = requestBody(path, method);
    const statuses = method === 'post' && ['/api/intent', '/api/request'].includes(path)
      ? {
          '200': response('Idempotent replay.', successSchema(path, method)),
          '201': response('Created.', successSchema(path, method)),
        }
      : { '200': response('Successful operation.', successSchema(path, method)) };
    const pathItem = (paths[path] ?? {}) as OpenApiObject;
    pathItem[method] = {
      operationId: transportOperationId(path, method, operations),
      summary: operations.map((item) => item.summary).join(' / '),
      tags: [first.id.split('.')[0]],
      security: security(path, method, first.access),
      ...(parameters.length ? { parameters } : {}),
      ...(request ? { requestBody: request } : {}),
      responses: {
        ...statuses,
        '400': response('Invalid request.', schema('ApiError')),
        '401': response('Authentication required.', schema('ApiError')),
        '403': response('Access denied.', schema('ApiError')),
        '409': response('State or deployment-network conflict.', schema('ApiError')),
        '429': response('Rate limited.', schema('ApiError')),
        '500': response('Internal error.', schema('ApiError')),
        '503': response('Dependency unavailable.', schema('ApiError')),
      },
      'x-multisig-operation-ids': operations.map((item) => item.id),
      'x-multisig-access': operations.map((item) => item.access),
      'x-multisig-effects': [...new Set(operations.map((item) => item.effect))],
    };
    paths[path] = pathItem;
  }
  return paths;
}

const stellarNetwork = { type: 'string', enum: ['public', 'testnet'] };
const operationVersion = { type: 'integer', const: 1 };
const xdr = { type: 'string', minLength: 1, description: 'Base64 Stellar transaction-envelope XDR.' };
const contractId = { type: 'string', pattern: '^C[A-Z2-7]{55}$' };
const accountId = { type: 'string', pattern: '^G[A-Z2-7]{55}$' };
const timestamp = { type: 'string', format: 'date-time' };

const components: OpenApiObject = {
  securitySchemes: {
    agentBearer: { type: 'http', scheme: 'bearer', description: 'Signer Agent credential (msa_...). Human SEP-10 bearer sessions are also accepted where documented.' },
    integrationBearer: { type: 'http', scheme: 'bearer', description: 'Non-signer external service credential (msi_...). Deployment scope restricts networks, Classic source accounts, Soroban contracts/methods, and Soroban execution source accounts.' },
    humanSession: { type: 'apiKey', in: 'cookie', name: 'mst_auth', description: 'Human SEP-10 session cookie.' },
    requestCapability: { type: 'apiKey', in: 'header', name: 'x-multisig-capability', description: 'Private share capability paired with x-multisig-request-id.' },
  },
  schemas: {
    StellarNetwork: stellarNetwork,
    ApiError: {
      type: 'object',
      required: ['error', 'code'],
      properties: {
        error: { type: 'string' },
        code: { type: 'string' },
        network: stellarNetwork,
        requestStatus: { type: 'string' },
        details: { type: 'object', additionalProperties: true },
      },
      additionalProperties: false,
    },
    RuntimeConfigResult: {
      type: 'object',
      required: ['operation', 'version', 'stellarNetwork', 'fixedNetwork'],
      properties: {
        operation: { type: 'string', const: 'runtime.config.inspect' },
        version: operationVersion,
        stellarNetwork: { type: 'string', enum: ['public', 'testnet', 'dual'] },
        fixedNetwork: { oneOf: [stellarNetwork, { type: 'null' }] },
      },
      additionalProperties: false,
    },
    ContractInput: {
      type: 'object',
      required: ['name', 'doc', 'typeLabel', 'kind'],
      properties: {
        name: { type: 'string' },
        doc: { type: 'string' },
        typeLabel: { type: 'string' },
        kind: { type: 'string', enum: ['address', 'bool', 'integer', 'string', 'symbol', 'bytes', 'bytesN', 'unsupported'] },
        bytesLength: { type: 'integer', minimum: 0 },
        unsupportedReason: { type: 'string' },
      },
      additionalProperties: false,
    },
    ContractMethod: {
      type: 'object',
      required: ['name', 'doc', 'inputs', 'outputs', 'guided'],
      properties: {
        name: { type: 'string' },
        doc: { type: 'string' },
        inputs: { type: 'array', items: schema('ContractInput') },
        outputs: { type: 'array', items: { type: 'string' } },
        guided: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    ContractInterfaceResult: {
      type: 'object',
      required: ['operation', 'version', 'network', 'contractId', 'methods'],
      properties: {
        operation: { type: 'string', const: 'contract.interface.inspect' },
        version: operationVersion,
        network: stellarNetwork,
        contractId,
        methods: { type: 'array', items: schema('ContractMethod') },
      },
      additionalProperties: false,
    },
    ContractIntentCreateInput: {
      type: 'object',
      required: ['network'],
      oneOf: [
        { required: ['contractId', 'method', 'arguments'] },
        { required: ['preparedXdr'] },
      ],
      properties: {
        network: stellarNetwork,
        contractId,
        method: { type: 'string', minLength: 1, maxLength: 64 },
        arguments: { type: 'object', maxProperties: 64, additionalProperties: { type: 'string' } },
        preparedXdr: xdr,
        privateNote: { type: 'string' },
        externalReference: { type: 'string' },
      },
      additionalProperties: false,
    },
    SorobanIntent: {
      type: 'object',
      required: ['version', 'network', 'hostFunctionXdr', 'intentDigest'],
      properties: {
        version: operationVersion,
        network: stellarNetwork,
        hostFunctionXdr: { type: 'string', minLength: 1 },
        intentDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      },
      additionalProperties: false,
    },
    SorobanEffectsSnapshot: {
      type: 'object',
      required: ['version', 'digest', 'structureDigest', 'stateChangeCount', 'eventCount', 'stateChanges', 'events', 'numericEffects', 'truncated'],
      properties: {
        version: operationVersion,
        digest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        structureDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        stateChangeCount: { type: 'integer', minimum: 0 },
        eventCount: { type: 'integer', minimum: 0 },
        stateChanges: { type: 'array', items: { type: 'object', additionalProperties: true } },
        events: { type: 'array', items: { type: 'object', additionalProperties: true } },
        numericEffects: { type: 'array', items: { type: 'object', required: ['key', 'label', 'value'], properties: { key: { type: 'string' }, label: { type: 'string' }, value: { type: 'string' } }, additionalProperties: false } },
        truncated: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    SorobanEffectsDiff: {
      type: 'object',
      required: ['version', 'kind', 'severity', 'requiresExplicitReview', 'requiresReauthorization', 'expectedDigest', 'currentDigest', 'structureChanged', 'maxChangeBasisPoints', 'numericChanges'],
      properties: {
        version: operationVersion,
        kind: { type: 'string', enum: ['unchanged', 'numeric', 'structural'] },
        severity: { type: 'string', enum: ['none', 'low', 'medium', 'high', 'critical'] },
        requiresExplicitReview: { type: 'boolean' },
        requiresReauthorization: { type: 'boolean', description: 'True when the effect structure changed and the existing AUTH must be superseded by a fresh authorization-plan revision.' },
        expectedDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        currentDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        structureChanged: { type: 'boolean' },
        maxChangeBasisPoints: { oneOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
        numericChanges: { type: 'array', items: { type: 'object', required: ['key', 'label', 'expected', 'actual', 'difference', 'basisPoints'], properties: { key: { type: 'string' }, label: { type: 'string' }, expected: { type: 'string' }, actual: { type: 'string' }, difference: { type: 'string' }, basisPoints: { oneOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] } }, additionalProperties: false } },
      },
      additionalProperties: false,
    },
    SorobanAuthorizationPlan: {
      type: 'object',
      required: ['version', 'network', 'intentDigest', 'authorizationPlanDigest', 'authorizationEntriesXdr', 'effects', 'executionBinding'],
      properties: {
        version: operationVersion,
        network: stellarNetwork,
        intentDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        authorizationPlanDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        authorizationEntriesXdr: { type: 'array', items: { type: 'string' } },
        effects: schema('SorobanEffectsSnapshot'),
        executionBinding: { type: 'string', const: 'detached' },
        boundSourceAccount: accountId,
      },
      additionalProperties: false,
    },
    StoredSorobanIntent: {
      type: 'object',
      required: ['version', 'id', 'network', 'intent', 'authorizationPlan', 'createdAt', 'discoverySignerKeys'],
      properties: {
        version: operationVersion,
        id: { type: 'string' },
        network: stellarNetwork,
        intent: schema('SorobanIntent'),
        authorizationPlan: schema('SorobanAuthorizationPlan'),
        authorizationPlanRevision: { type: 'integer', minimum: 1 },
        authorizationPlanHistory: {
          type: 'array',
          items: {
            type: 'object',
            required: ['revision', 'authorizationPlan', 'supersededAt'],
            properties: {
              revision: { type: 'integer', minimum: 1 },
              authorizationPlan: schema('SorobanAuthorizationPlan'),
              supersededAt: timestamp,
            },
            additionalProperties: false,
          },
        },
        createdAt: timestamp,
        creatorAddress: accountId,
        discoverySignerKeys: { type: 'array', items: accountId },
        creatorActor: { type: 'object', additionalProperties: true },
        integration: schema('ServiceIntegrationContext'),
        executionPolicy: schema('ExecutionPolicy'),
        privateContext: { type: 'object', additionalProperties: true },
      },
      additionalProperties: false,
    },
    SorobanIntentAuthorizationSnapshot: {
      type: 'object',
      required: ['id', 'network', 'intentDigest', 'authorizationPlanDigest', 'executionBinding', 'status', 'authorizationEntriesXdr', 'contributionCount', 'authorizers'],
      properties: {
        id: { type: 'string' },
        network: stellarNetwork,
        intentDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        authorizationPlanDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        executionBinding: { type: 'string', const: 'detached' },
        status: { type: 'string', enum: ['awaiting_authorization', 'authorization_ready', 'expired', 'blocked'] },
        statusDetail: { type: 'string' },
        authorizationEntriesXdr: { type: 'array', items: { type: 'string' } },
        contributionCount: { type: 'integer', minimum: 0 },
        authorizers: { type: 'array', items: { type: 'object', additionalProperties: true } },
      },
      additionalProperties: false,
    },
    SorobanIntentEvidenceEvent: {
      type: 'object',
      required: ['version', 'eventId', 'type', 'occurredAt', 'authorizationPlanDigest', 'authorizationPlanRevision'],
      properties: {
        version: operationVersion,
        eventId: { type: 'string', minLength: 1 },
        type: { type: 'string', enum: ['intent_created', 'authorization_added', 'authorization_plan_revised', 'execution_prepared', 'execution_confirmed', 'execution_failed'] },
        occurredAt: timestamp,
        actorAddress: accountId,
        actor: { type: 'object', additionalProperties: true },
        authorizationPlanDigest: { type: 'string', minLength: 1 },
        authorizationPlanRevision: { type: 'integer', minimum: 1 },
        previousAuthorizationPlanDigest: { type: 'string', minLength: 1 },
        entryIndex: { type: 'integer', minimum: 0 },
        contributionDigest: { type: 'string', minLength: 1 },
        executionSource: accountId,
        transactionSequence: { type: 'string' },
        transactionHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        effectsDigest: { type: 'string', minLength: 1 },
        effectsAccepted: { type: 'boolean' },
        validUntil: { oneOf: [timestamp, { type: 'null' }] },
        latestLedger: { type: 'integer', minimum: 1 },
        ledger: { type: 'integer', minimum: 1 },
        successful: { type: 'boolean' },
        observedAt: timestamp,
      },
      additionalProperties: false,
    },
    ContractIntentCreateResult: {
      type: 'object',
      required: ['operation', 'version', 'replayed', 'intent', 'authorization'],
      properties: {
        operation: { type: 'string', const: 'contract.intent.create' },
        version: operationVersion,
        replayed: { type: 'boolean' },
        intent: schema('StoredSorobanIntent'),
        authorization: schema('SorobanIntentAuthorizationSnapshot'),
      },
      additionalProperties: false,
    },
    ContractIntentInspectResult: {
      type: 'object',
      required: ['operation', 'version', 'intent', 'authorization', 'evidence'],
      properties: {
        operation: { type: 'string', const: 'contract.intent.inspect' },
        version: operationVersion,
        intent: schema('StoredSorobanIntent'),
        authorization: schema('SorobanIntentAuthorizationSnapshot'),
        evidence: { type: 'array', items: schema('SorobanIntentEvidenceEvent') },
      },
      additionalProperties: false,
    },
    ContractIntentContributionInput: {
      type: 'object',
      required: ['entryIndex', 'signatureBase64'],
      properties: {
        entryIndex: { type: 'integer', minimum: 0 },
        signatureBase64: { type: 'string', minLength: 1 },
      },
      additionalProperties: false,
    },
    ContractIntentContributionResult: {
      type: 'object',
      required: ['operation', 'version', 'added', 'authorization'],
      properties: {
        operation: { type: 'string', const: 'contract.intent.contribute' },
        version: operationVersion,
        added: { type: 'boolean' },
        authorization: schema('SorobanIntentAuthorizationSnapshot'),
      },
      additionalProperties: false,
    },
    ContractIntentExecutionInput: {
      type: 'object',
      required: ['executionSource'],
      properties: { executionSource: accountId, acceptedEffectsDigest: { type: 'string', pattern: '^[0-9a-f]{64}$', description: 'Explicit acceptance of the exact current effects digest after reviewing a critical numeric-only diff. Structural changes cannot be accepted here and require a fresh authorization-plan revision.' } },
      additionalProperties: false,
    },
    ContractIntentExecutionReconcileInput: {
      type: 'object',
      required: ['action', 'transactionHash'],
      properties: {
        action: { type: 'string', const: 'reconcile_execution' },
        transactionHash: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
      },
      additionalProperties: false,
    },
    ContractIntentReplanInput: {
      type: 'object',
      required: ['action'],
      properties: { action: { type: 'string', const: 'replan' } },
      additionalProperties: false,
    },
    SorobanIntentExecutionPreparation: {
      type: 'object',
      required: ['version', 'intentId', 'network', 'intentDigest', 'authorizationPlanDigest', 'executionSource', 'transactionSequence', 'transactionHash', 'validUntil', 'latestLedger', 'effectsDiff', 'effectsAccepted', 'xdr'],
      properties: {
        version: operationVersion,
        intentId: { type: 'string' },
        network: stellarNetwork,
        intentDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        authorizationPlanDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        executionSource: accountId,
        transactionSequence: { type: 'string' },
        transactionHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        validUntil: { oneOf: [timestamp, { type: 'null' }] },
        latestLedger: { type: 'integer', minimum: 1 },
        effectsDiff: schema('SorobanEffectsDiff'),
        effectsAccepted: { type: 'boolean' },
        xdr,
      },
      additionalProperties: false,
    },
    ContractIntentExecutionResult: {
      type: 'object',
      required: ['operation', 'version', 'execution'],
      properties: {
        operation: { type: 'string', const: 'contract.intent.execution.prepare' },
        version: operationVersion,
        execution: schema('SorobanIntentExecutionPreparation'),
      },
      additionalProperties: false,
    },
    SorobanIntentExecutionObservation: {
      type: 'object',
      required: ['version', 'transactionHash', 'authorizationPlanDigest', 'authorizationPlanRevision', 'executionSource', 'ledger', 'successful', 'observedAt'],
      properties: {
        version: operationVersion,
        transactionHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        authorizationPlanDigest: { type: 'string', minLength: 1 },
        authorizationPlanRevision: { type: 'integer', minimum: 1 },
        executionSource: accountId,
        ledger: { type: 'integer', minimum: 1 },
        successful: { type: 'boolean' },
        observedAt: timestamp,
        networkCreatedAt: timestamp,
      },
      additionalProperties: false,
    },
    ContractIntentExecutionReconcileResult: {
      type: 'object',
      required: ['operation', 'version', 'transactionHash', 'observed', 'replayed'],
      properties: {
        operation: { type: 'string', const: 'contract.intent.execution.reconcile' },
        version: operationVersion,
        transactionHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        observed: { type: 'boolean' },
        replayed: { type: 'boolean' },
        observation: schema('SorobanIntentExecutionObservation'),
      },
      additionalProperties: false,
    },
    ContractIntentReplanResult: {
      type: 'object',
      required: ['operation', 'version', 'intent', 'authorization', 'previousAuthorizationPlanDigest', 'authorizationPlanRevision'],
      properties: {
        operation: { type: 'string', const: 'contract.intent.replan' },
        version: operationVersion,
        intent: schema('StoredSorobanIntent'),
        authorization: schema('SorobanIntentAuthorizationSnapshot'),
        previousAuthorizationPlanDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        authorizationPlanRevision: { type: 'integer', minimum: 2 },
      },
      additionalProperties: false,
    },
    ContractCallBuildInput: {
      type: 'object',
      required: ['network', 'transactionSource', 'contractId', 'method', 'arguments', 'lifetimeSeconds'],
      properties: {
        network: stellarNetwork,
        transactionSource: accountId,
        contractId,
        method: { type: 'string', minLength: 1, maxLength: 64 },
        arguments: { type: 'object', maxProperties: 64, additionalProperties: { type: 'string' } },
        lifetimeSeconds: { type: 'integer', enum: [3600, 86400, 604800] },
      },
      additionalProperties: false,
    },
    ContractCallBuildResult: {
      type: 'object',
      required: ['operation', 'version', 'network', 'transactionSource', 'sourceSequence', 'contractId', 'method', 'xdr', 'validUntil'],
      properties: {
        operation: { type: 'string', const: 'contract.call.build' },
        version: operationVersion,
        network: stellarNetwork,
        transactionSource: accountId,
        sourceSequence: { type: 'string' },
        contractId,
        method: { type: 'string' },
        xdr,
        validUntil: timestamp,
      },
      additionalProperties: false,
    },
    ContractPrepareInput: {
      type: 'object',
      required: ['network', 'xdr'],
      properties: { network: stellarNetwork, xdr, mode: { type: 'string', enum: ['record', 'enforce'], default: 'record' } },
      additionalProperties: false,
    },
    AuthorizationEntry: {
      type: 'object',
      required: ['index', 'credentialType', 'authorizer', 'nonce', 'signatureExpirationLedger', 'signed', 'sourceAccountAuthorization', 'authorizationKind', 'verificationModel', 'signers', 'invocation'],
      properties: {
        index: { type: 'integer', minimum: 0 },
        credentialType: { type: 'string' },
        authorizer: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        nonce: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        signatureExpirationLedger: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        signed: { type: 'boolean' },
        sourceAccountAuthorization: { type: 'boolean' },
        authorizationKind: { type: 'string' },
        verificationModel: { type: 'string' },
        signers: { type: 'array', items: { type: 'object', additionalProperties: true } },
        invocation: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
        inspectionError: { type: 'string' },
      },
      additionalProperties: false,
    },
    SorobanSimulation: {
      type: 'object',
      required: ['endpointUrl', 'network', 'transactionHash', 'latestLedger', 'minResourceFee', 'transactionDataXdr', 'returnValuePreview', 'authorizationEntries', 'effects', 'eventCount', 'stateChangeCount', 'restoreRequired', 'cpuInstructions', 'memoryBytes', 'assembledXdr'],
      properties: {
        endpointUrl: { type: 'string', format: 'uri' },
        network: stellarNetwork,
        transactionHash: { type: 'string' },
        latestLedger: { type: 'integer' },
        minResourceFee: { type: ['string', 'null'] },
        transactionDataXdr: { type: ['string', 'null'] },
        returnValuePreview: { type: ['string', 'null'] },
        authorizationEntries: { type: 'array', items: schema('AuthorizationEntry') },
        effects: schema('SorobanEffectsSnapshot'),
        eventCount: { type: 'integer', minimum: 0 },
        stateChangeCount: { type: 'integer', minimum: 0 },
        restoreRequired: { type: 'boolean' },
        cpuInstructions: { type: ['string', 'null'] },
        memoryBytes: { type: ['string', 'null'] },
        assembledXdr: { type: ['string', 'null'] },
      },
      additionalProperties: false,
    },
    ContractPrepareResult: {
      type: 'object',
      required: ['operation', 'version', 'mode', 'simulation'],
      properties: {
        operation: { type: 'string', const: 'contract.call.prepare' },
        version: operationVersion,
        mode: { type: 'string', const: 'record' },
        simulation: schema('SorobanSimulation'),
      },
      additionalProperties: false,
    },
    ContractEnforceVerification: {
      type: 'object',
      required: ['endpointUrl', 'latestLedger', 'effects'],
      properties: {
        endpointUrl: { type: 'string', format: 'uri' },
        latestLedger: { type: 'integer' },
        effects: schema('SorobanEffectsSnapshot'),
      },
      additionalProperties: false,
    },
    ContractEnforceResult: {
      type: 'object',
      required: ['operation', 'version', 'mode', 'verification'],
      properties: {
        operation: { type: 'string', const: 'contract.call.prepare' },
        version: operationVersion,
        mode: { type: 'string', const: 'enforce' },
        verification: schema('ContractEnforceVerification'),
      },
      additionalProperties: false,
    },
    ServiceActor: {
      type: 'object',
      required: ['type', 'id'],
      properties: {
        type: { type: 'string', const: 'service' },
        id: { type: 'string' },
        label: { type: 'string' },
      },
      additionalProperties: false,
    },
    ServiceIntegrationContext: {
      type: 'object',
      required: ['version', 'serviceId'],
      properties: {
        version: operationVersion,
        serviceId: { type: 'string' },
        serviceLabel: { type: 'string' },
        correlationId: { type: 'string' },
      },
      additionalProperties: false,
    },
    ExecutionPolicy: {
      type: 'object',
      required: ['mode'],
      properties: {
        mode: { type: 'string', enum: ['multisigtools', 'external'] },
      },
      additionalProperties: false,
    },
    ExternalServiceExecution: {
      type: 'object',
      required: ['mode', 'executor'],
      properties: {
        mode: { type: 'string', const: 'external' },
        executor: schema('ServiceActor'),
      },
      additionalProperties: false,
    },
    MultiSigToolsExecution: {
      type: 'object',
      required: ['mode'],
      properties: { mode: { type: 'string', const: 'multisigtools' } },
      additionalProperties: false,
    },
    RequestExecution: {
      oneOf: [schema('MultiSigToolsExecution'), schema('ExternalServiceExecution')],
    },
    Principal: {
      type: 'object',
      required: ['type', 'network', 'address'],
      properties: { type: { type: 'string', const: 'signer' }, network: stellarNetwork, address: accountId },
      additionalProperties: false,
    },
    ContractWorkspaceInput: {
      type: 'object',
      required: ['contractId'],
      properties: { network: stellarNetwork, contractId },
      additionalProperties: false,
    },
    ContractWorkspace: {
      type: 'object',
      required: ['contractId', 'network', 'createdAt', 'updatedAt'],
      properties: { contractId, network: stellarNetwork, createdAt: timestamp, updatedAt: timestamp },
      additionalProperties: false,
    },
    ContractWorkspaceListResult: {
      type: 'object',
      required: ['operation', 'version', 'principal', 'contracts'],
      properties: {
        operation: { type: 'string', const: 'contract.workspace.list' },
        version: operationVersion,
        principal: schema('Principal'),
        contracts: { type: 'array', items: schema('ContractWorkspace') },
      },
      additionalProperties: false,
    },
    ContractWorkspaceKeepResult: {
      type: 'object',
      required: ['operation', 'version', 'principal', 'contract'],
      properties: {
        operation: { type: 'string', const: 'contract.workspace.keep' },
        version: operationVersion,
        principal: schema('Principal'),
        contract: schema('ContractWorkspace'),
      },
      additionalProperties: false,
    },
    ContractWorkspaceForgetResult: {
      type: 'object',
      required: ['operation', 'version', 'principal', 'contractId', 'removed'],
      properties: {
        operation: { type: 'string', const: 'contract.workspace.forget' },
        version: operationVersion,
        principal: schema('Principal'),
        contractId,
        removed: { type: 'boolean', const: true },
      },
      additionalProperties: false,
    },
    ClassicPaymentAssetInput: {
      oneOf: [
        { type: 'object', required: ['type'], properties: { type: { type: 'string', const: 'native' } }, additionalProperties: false },
        { type: 'object', required: ['type', 'code', 'issuer'], properties: { type: { type: 'string', const: 'credit' }, code: { type: 'string', minLength: 1, maxLength: 12 }, issuer: accountId }, additionalProperties: false },
      ],
    },
    ClassicPaymentInput: {
      type: 'object',
      required: ['destination', 'amount', 'asset'],
      properties: {
        destination: accountId,
        amount: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,7})?$' },
        asset: schema('ClassicPaymentAssetInput'),
      },
      additionalProperties: false,
    },
    ClassicPaymentInstructionInput: {
      type: 'object',
      required: ['sourceAccount', 'payments'],
      properties: {
        sourceAccount: accountId,
        payments: { type: 'array', minItems: 1, maxItems: 100, items: schema('ClassicPaymentInput') },
        memo: { type: 'string' },
        memoHashHex: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
        lifetimeSeconds: { type: 'integer', enum: [3600, 86400, 604800], default: 86400 },
      },
      additionalProperties: false,
    },
    ClassicPaymentPrepareInput: {
      type: 'object',
      required: ['network', 'sourceAccount', 'payments'],
      properties: {
        network: stellarNetwork,
        sourceAccount: accountId,
        payments: { type: 'array', minItems: 1, maxItems: 100, items: schema('ClassicPaymentInput') },
        memo: { type: 'string' },
        memoHashHex: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
        lifetimeSeconds: { type: 'integer', enum: [3600, 86400, 604800], default: 86400 },
      },
      additionalProperties: false,
    },
    ClassicPaymentPrepareResult: {
      type: 'object',
      required: ['operation', 'version', 'network', 'sourceAccount', 'sourceSequence', 'paymentCount', 'feeStroops', 'validUntil', 'transactionHash', 'xdr'],
      properties: {
        operation: { type: 'string', const: 'classic.payment.prepare' },
        version: operationVersion,
        network: stellarNetwork,
        sourceAccount: accountId,
        sourceSequence: { type: 'string' },
        paymentCount: { type: 'integer', minimum: 1, maximum: 100 },
        feeStroops: { type: 'string', pattern: '^\\d+$' },
        validUntil: timestamp,
        transactionHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        xdr,
      },
      additionalProperties: false,
    },
    ClassicCreateAccountPrepareInput: {
      type: 'object',
      required: ['network', 'sourceAccount', 'destination', 'startingBalance'],
      properties: {
        network: stellarNetwork,
        sourceAccount: accountId,
        destination: accountId,
        startingBalance: { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,7})?$' },
        memo: { type: 'string' },
        memoHashHex: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
        lifetimeSeconds: { type: 'integer', enum: [3600, 86400, 604800], default: 86400 },
      },
      additionalProperties: false,
    },
    ClassicCreateAccountPrepareResult: {
      type: 'object',
      required: ['operation', 'version', 'network', 'sourceAccount', 'sourceSequence', 'destination', 'startingBalance', 'feeStroops', 'validUntil', 'transactionHash', 'xdr'],
      properties: {
        operation: { type: 'string', const: 'classic.account.create.prepare' },
        version: operationVersion,
        network: stellarNetwork,
        sourceAccount: accountId,
        sourceSequence: { type: 'string' },
        destination: accountId,
        startingBalance: { type: 'string' },
        feeStroops: { type: 'string', pattern: '^\\d+$' },
        validUntil: timestamp,
        transactionHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        xdr,
      },
      additionalProperties: false,
    },
    ProposalCreateInput: {
      type: 'object',
      required: ['network'],
      oneOf: [
        { required: ['xdr'] },
        { required: ['payment'], description: 'Semantic Classic payment creation is currently available to Integration Service callers.' },
      ],
      properties: {
        network: stellarNetwork,
        xdr,
        payment: schema('ClassicPaymentInstructionInput'),
        externalReference: {},
        privateNote: { type: 'string' },
        privateCommitment: {},
        sorobanIntentId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{16}$', description: 'Optional Human workflow hint. The server links it only when the exact transaction hash matches a durable current Soroban execution preparation.' },
      },
      additionalProperties: false,
    },
    ProposalPatchInput: {
      oneOf: [
        { type: 'object', required: ['signedXdr'], properties: { signedXdr: xdr }, additionalProperties: false },
        { type: 'object', required: ['decision'], properties: { decision: { type: 'string', const: 'decline' } }, additionalProperties: false },
        { type: 'object', required: ['retainActivity'], properties: { retainActivity: { type: 'boolean', const: true } }, additionalProperties: false },
      ],
    },
    SorobanRequestOrigin: {
      type: 'object',
      required: ['version', 'intentId', 'authorizationPlanDigest', 'authorizationPlanRevision', 'executionPreparedAt', 'effectsDigest'],
      properties: {
        version: operationVersion,
        intentId: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{16}$' },
        authorizationPlanDigest: { type: 'string', minLength: 1 },
        authorizationPlanRevision: { type: 'integer', minimum: 1 },
        executionPreparedAt: timestamp,
        effectsDigest: { type: 'string', minLength: 1 },
      },
      additionalProperties: false,
    },
    SigningRequest: {
      type: 'object',
      required: ['id', 'network', 'transactionHash', 'baseXdr', 'mergedXdr', 'createdAt', 'expiresAt', 'contributionCount', 'signatureCount', 'status', 'statusReason'],
      properties: {
        id: { type: 'string' },
        network: stellarNetwork,
        transactionHash: { type: 'string' },
        baseXdr: xdr,
        mergedXdr: xdr,
        createdAt: timestamp,
        expiresAt: timestamp,
        contributionCount: { type: 'integer', minimum: 0 },
        signatureCount: { type: 'integer', minimum: 0 },
        status: { type: 'string', enum: ['awaiting_signatures', 'waiting_preconditions', 'ready', 'submitted', 'expired', 'stale', 'blocked'] },
        statusReason: { type: 'string' },
        statusDetail: { type: 'string' },
        submission: { type: 'object', additionalProperties: true },
        execution: schema('RequestExecution'),
        sorobanOrigin: schema('SorobanRequestOrigin'),
      },
      additionalProperties: false,
    },
    ProposalResult: {
      type: 'object',
      required: ['request'],
      properties: {
        request: schema('SigningRequest'),
        capability: { type: 'string' },
        replayed: { type: 'boolean' },
        externalReference: {},
        access: { type: 'object', additionalProperties: true },
        context: { type: 'object', additionalProperties: true },
        history: { type: 'object', additionalProperties: true },
        addedSignatureCount: { type: 'integer', minimum: 0 },
        duplicateSignatureCount: { type: 'integer', minimum: 0 },
        decision: { type: 'string', enum: ['declined'] },
      },
      additionalProperties: false,
    },
  },
};

export function createOpenApiDocument(
  origin = '/',
  deploymentNetwork: 'public' | 'testnet' | 'dual' = 'dual',
): OpenApiObject {
  return {
    openapi: '3.1.1',
    'x-multisig-deployment-network': deploymentNetwork,
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: 'MultiSigTools Headless Operations',
      version: '1.0.0',
      description: 'Composable Stellar coordination operations for Human, signer Agent, bot, script, wallet, plugin, MCP, CLI, and scoped external-service consumers. Building or preparing XDR never grants signer authority. MultiSigTools submission remains Human-only; Integration-owned work may designate an external executor.',
    },
    servers: [{ url: origin }],
    paths: openApiPaths(),
    components,
    externalDocs: {
      description: 'MultiSigTools Agent API and authority model',
      url: `${origin === '/' ? '' : origin}/developers`,
    },
  };
}
