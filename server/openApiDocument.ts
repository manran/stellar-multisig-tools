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
    values.push(parameter('Idempotency-Key', 'header', false, { type: 'string' }, 'Required for Agent Intent creation; Human sessions do not need it.'));
  }
  if (path === '/api/request' && method === 'post') {
    values.push(parameter('Idempotency-Key', 'header', false, { type: 'string' }, 'Required for Agent credential creation; ignored for Human sessions.'));
  }
  return values;
}

function requestBody(path: string, method: string): OpenApiObject | undefined {
  if (path === '/api/intent' && method === 'post') return body(schema('ContractIntentCreateInput'));
  if (path === '/api/intent' && method === 'patch') return body(schema('ContractIntentContributionInput'));
  if (path === '/api/intent' && method === 'put') return body(schema('ContractIntentExecutionInput'));
  if (path === '/api/contract-call' && method === 'post') return body(schema('ContractCallBuildInput'));
  if (path === '/api/contract-prepare' && method === 'post') return body(schema('ContractPrepareInput'));
  if (path === '/api/contracts' && (method === 'put' || method === 'delete')) return body(schema('ContractWorkspaceInput'));
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
  if (path === '/api/intent' && method === 'put') return schema('ContractIntentExecutionResult');
  if (path === '/api/contract-call') return schema('ContractCallBuildResult');
  if (path === '/api/contract-prepare') return schema('ContractPrepareResult');
  if (path === '/api/contracts' && method === 'get') return schema('ContractWorkspaceListResult');
  if (path === '/api/contracts' && method === 'put') return schema('ContractWorkspaceKeepResult');
  if (path === '/api/contracts' && method === 'delete') return schema('ContractWorkspaceForgetResult');
  if (path === '/api/request') return schema('ProposalResult');
  return { type: 'object', additionalProperties: true };
}

function security(path: string, method: string, access: HeadlessOperationAccess): OpenApiObject[] {
  if (access === 'public') return [];
  if (path === '/api/intent') return [{ agentBearer: [] }, { humanSession: [] }];
  if (path === '/api/contracts') return [{ agentBearer: [] }, { humanSession: [] }];
  if (path === '/api/request' && method === 'put') return [{ humanSession: [] }, { requestCapability: [] }];
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
    SorobanAuthorizationPlan: {
      type: 'object',
      required: ['version', 'network', 'intentDigest', 'authorizationPlanDigest', 'authorizationEntriesXdr', 'executionBinding'],
      properties: {
        version: operationVersion,
        network: stellarNetwork,
        intentDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        authorizationPlanDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        authorizationEntriesXdr: { type: 'array', items: { type: 'string' } },
        executionBinding: { type: 'string', const: 'detached' },
        boundSourceAccount: accountId,
      },
      additionalProperties: false,
    },
    StoredSorobanIntent: {
      type: 'object',
      required: ['version', 'id', 'network', 'intent', 'authorizationPlan', 'createdAt', 'creatorAddress', 'discoverySignerKeys'],
      properties: {
        version: operationVersion,
        id: { type: 'string' },
        network: stellarNetwork,
        intent: schema('SorobanIntent'),
        authorizationPlan: schema('SorobanAuthorizationPlan'),
        createdAt: timestamp,
        creatorAddress: accountId,
        discoverySignerKeys: { type: 'array', items: accountId },
        creatorActor: { type: 'object', additionalProperties: true },
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
      required: ['operation', 'version', 'intent', 'authorization'],
      properties: {
        operation: { type: 'string', const: 'contract.intent.inspect' },
        version: operationVersion,
        intent: schema('StoredSorobanIntent'),
        authorization: schema('SorobanIntentAuthorizationSnapshot'),
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
      properties: { executionSource: accountId },
      additionalProperties: false,
    },
    SorobanIntentExecutionPreparation: {
      type: 'object',
      required: ['version', 'intentId', 'network', 'intentDigest', 'authorizationPlanDigest', 'executionSource', 'transactionSequence', 'transactionHash', 'validUntil', 'latestLedger', 'xdr'],
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
      properties: { network: stellarNetwork, xdr },
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
      required: ['endpointUrl', 'network', 'transactionHash', 'latestLedger', 'minResourceFee', 'transactionDataXdr', 'returnValuePreview', 'authorizationEntries', 'eventCount', 'stateChangeCount', 'restoreRequired', 'cpuInstructions', 'memoryBytes', 'assembledXdr'],
      properties: {
        endpointUrl: { type: 'string', format: 'uri' },
        network: stellarNetwork,
        transactionHash: { type: 'string' },
        latestLedger: { type: 'integer' },
        minResourceFee: { type: ['string', 'null'] },
        transactionDataXdr: { type: ['string', 'null'] },
        returnValuePreview: { type: ['string', 'null'] },
        authorizationEntries: { type: 'array', items: schema('AuthorizationEntry') },
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
      required: ['operation', 'version', 'simulation'],
      properties: {
        operation: { type: 'string', const: 'contract.call.prepare' },
        version: operationVersion,
        simulation: schema('SorobanSimulation'),
      },
      additionalProperties: false,
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
    ProposalCreateInput: {
      type: 'object',
      required: ['network', 'xdr'],
      properties: {
        network: stellarNetwork,
        xdr,
        externalReference: {},
        privateNote: { type: 'string' },
        privateCommitment: {},
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
      description: 'Composable Stellar transaction construction and shared-authorization operations for Human, Agent, bot, script, wallet, plugin, MCP, and CLI consumers. Building or preparing XDR never signs or submits it. Final network submission remains Human-only.',
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
