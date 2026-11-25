import {
  HEADLESS_OPERATION_CATALOG,
  type HeadlessOperationAccess,
  type HeadlessOperationDescriptor,
} from '../../../../packages/stellar-core/src/headlessOperations.js';

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
  if (path === '/integration-execution') {
    values.push(parameter('network', 'query', true, schema('StellarNetwork'), 'Must match both this deployment and the Integration credential scope.'));
  }
  if (path === '/auth' && method === 'get') {
    values.push(
      parameter('account', 'query', false, { type: 'string', pattern: '^G[A-Z2-7]{55}$' }, 'Signer G address. Omit only to inspect current session.'),
      parameter('network', 'query', false, schema('StellarNetwork'), 'Required for a challenge; must match the fixed deployment.'),
      parameter('unlock_seconds', 'query', false, { type: 'integer', enum: [900, 3600, 28800] }, 'Requested session duration; defaults to 3600.'),
    );
  }
  if (['/agent-grants', '/agent-access', '/intent', '/request', '/payment-prepare', '/account-create-prepare'].includes(path)) {
    values.push(parameter('x-multisig-session-address', 'header', path === '/agent-access', { type: 'string', pattern: '^G[A-Z2-7]{55}$' }, 'Must match the Human session signer for selected-wallet verification. Required for Human-authorized operations that use a selected wallet; not used for machine credentials.'));
  }
  if (path === '/agent-grants' && method === 'get') {
    values.push(
      parameter('id', 'query', true, { type: 'string', pattern: '^[a-f0-9]{32}$' }, 'Pairing request ID, not the secret device code.'),
      parameter('challenge', 'query', false, { type: 'string', const: '1' }, 'Wallet approval challenge; requires a matching Human session.'),
    );
  }
  if (path === '/contract-interface') {
    values.push(
      parameter('network', 'query', true, schema('StellarNetwork'), 'Must match this deployment.'),
      parameter('contract', 'query', true, { type: 'string', pattern: '^C[A-Z2-7]{55}$' }, 'Stellar contract address.'),
    );
  }
  if (path === '/request') {
    values.push(
      parameter('x-multisig-request-id', 'header', method !== 'post', { type: 'string' }, 'Authorization or Proposal id.'),
      parameter('x-multisig-capability', 'header', false, { type: 'string' }, 'Private share capability when using capability access.'),
    );
  }
  if (path === '/request' && method === 'get') {
    values.push(
      parameter('view', 'query', false, { type: 'string', enum: ['history'] }, 'Request retained history projection.'),
      parameter('account', 'query', false, { type: 'string', pattern: '^G[A-Z2-7]{55}$' }, 'Optional Treasury scope for history.'),
    );
  }
  if (path === '/intent' && method !== 'post') {
    values.push(parameter('X-MultiSig-Intent-Id', 'header', true, { type: 'string' }, 'Soroban Intent id.'));
    if (method === 'get' || method === 'patch') {
      values.push(parameter('X-MultiSig-Intent-Capability', 'header', false, { type: 'string' }, 'Short-lived signer-scoped Browser authorization capability (mic_...).'));
    }
  }
  if (path === '/intent' && method === 'post') {
    values.push(parameter('Idempotency-Key', 'header', false, { type: 'string' }, 'Required for Agent or Integration Intent creation; Human sessions do not need it.'));
  }
  if (path === '/request' && method === 'post') {
    values.push(parameter('Idempotency-Key', 'header', false, { type: 'string' }, 'Required for Agent or Integration Request creation; ignored for Human sessions.'));
  }
  return values;
}

function requestBody(path: string, method: string): OpenApiObject | undefined {
  if (path === '/auth' && method === 'post') return body(schema('SignerAuthExchangeInput'));
  if (path === '/agent-access' && method === 'delete') return body({ type: 'object', required: ['credentialId'], properties: { credentialId: { type: 'string', minLength: 1 } }, additionalProperties: false });
  if (path === '/agent-grants' && method === 'post') return body(schema('AgentGrantActionInput'));
  if (path === '/integration-testnet' && method === 'post') return body(schema('TestnetIntegrationCreateInput'));
  if (path === '/intent' && method === 'post') return body(schema('ContractIntentCreateInput'));
  if (path === '/intent' && method === 'patch') return body(schema('ContractIntentContributionInput'));
  if (path === '/intent' && method === 'put') return body({ oneOf: [schema('ContractIntentExecutionInput'), schema('ContractIntentExecutionReconcileInput'), schema('ContractIntentReplanInput'), schema('ContractIntentCancelInput'), schema('BrowserAuthorizationIssueInput')] });
  if (path === '/contract-call' && method === 'post') return body(schema('ContractCallBuildInput'));
  if (path === '/contract-prepare' && method === 'post') return body(schema('ContractPrepareInput'));
  if (path === '/contracts' && (method === 'put' || method === 'delete')) return body(schema('ContractWorkspaceInput'));
  if (path === '/payment-prepare' && method === 'post') return body(schema('ClassicPaymentPrepareInput'));
  if (path === '/account-create-prepare' && method === 'post') return body(schema('ClassicCreateAccountPrepareInput'));
  if (path === '/request' && method === 'post') return body(schema('ProposalCreateInput'));
  if (path === '/request' && method === 'patch') return body(schema('ProposalPatchInput'));
  return undefined;
}

function successSchema(path: string, method: string): OpenApiObject {
  if (path === '/auth') return method === 'get' ? { oneOf: [schema('SignerAuthChallenge'), schema('SignerAuthStatus')] } : schema('SignerAuthSession');
  if (path === '/agent-access') return schema('SignerAgentAccessResult');
  if (path === '/runtime-config') return schema('RuntimeConfigResult');
  if (path === '/inbox') return schema('SignerInboxResult');
  if (path === '/agent-grants') return schema('AgentGrantResult');
  if (path === '/integration-testnet') return schema('TestnetIntegrationCreateResult');
  if (path === '/integration-execution') return schema('IntegrationExecutionInspectResult');
  if (path === '/contract-interface') return schema('ContractInterfaceResult');
  if (path === '/intent' && method === 'post') return schema('ContractIntentCreateResult');
  if (path === '/intent' && method === 'get') return { oneOf: [schema('ContractIntentInspectResult'), schema('BrowserAuthorizationInspectResult')] };
  if (path === '/intent' && method === 'patch') return { oneOf: [schema('ContractIntentContributionResult'), schema('BrowserAuthorizationContributionResult')] };
  if (path === '/intent' && method === 'put') return { oneOf: [schema('ContractIntentExecutionResult'), schema('ContractIntentExecutionReconcileResult'), schema('ContractIntentReplanResult'), schema('ContractIntentCancelResult'), schema('BrowserAuthorizationIssueResult')] };
  if (path === '/contract-call') return schema('ContractCallBuildResult');
  if (path === '/contract-prepare') return { oneOf: [schema('ContractPrepareResult'), schema('ContractEnforceResult')] };
  if (path === '/contracts' && method === 'get') return schema('ContractWorkspaceListResult');
  if (path === '/contracts' && method === 'put') return schema('ContractWorkspaceKeepResult');
  if (path === '/contracts' && method === 'delete') return schema('ContractWorkspaceForgetResult');
  if (path === '/payment-prepare') return schema('ClassicPaymentPrepareResult');
  if (path === '/account-create-prepare') return schema('ClassicCreateAccountPrepareResult');
  if (path === '/request') return schema('ProposalResult');
  return { type: 'object', additionalProperties: true };
}

function security(path: string, method: string, access: HeadlessOperationAccess): OpenApiObject[] {
  if (path === '/agent-grants') return [{}, { humanBearer: [] }, { humanSession: [] }]; // Public actions need no session; challenge/approve/deny require Human session.
  if (path === '/agent-access') return [{ humanBearer: [] }, { humanSession: [] }];
  if (access === 'public') return [];
  if (path === '/intent') {
    if (method === 'patch') return [{ agentBearer: [] }, { humanBearer: [] }, { humanSession: [] }, { intentCapability: [] }];
    if (method === 'get') return [{ agentBearer: [] }, { integrationBearer: [] }, { humanBearer: [] }, { humanSession: [] }, { intentCapability: [] }];
    return [{ agentBearer: [] }, { integrationBearer: [] }, { humanBearer: [] }, { humanSession: [] }];
  }
  if (path === '/integration-execution') return [{ integrationBearer: [] }];
  if (path === '/contracts' || path === '/inbox') return [{ agentBearer: [] }, { humanBearer: [] }, { humanSession: [] }];
  if (path === '/payment-prepare' || path === '/account-create-prepare') return [{ agentBearer: [] }, { integrationBearer: [] }, { humanBearer: [] }, { humanSession: [] }];
  if (path === '/request' && method === 'put') return [{ integrationBearer: [] }, { humanBearer: [] }, { humanSession: [] }, { requestCapability: [] }];
  if (path === '/request' && method === 'post') return [{ agentBearer: [] }, { integrationBearer: [] }, { humanBearer: [] }, { humanSession: [] }];
  if (path === '/request' && method === 'get') return [{ agentBearer: [] }, { integrationBearer: [] }, { humanBearer: [] }, { humanSession: [] }, { requestCapability: [] }];
  return [{ agentBearer: [] }, { humanBearer: [] }, { humanSession: [] }, { requestCapability: [] }];
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
    const statuses = method === 'post' && ['/intent', '/request'].includes(path)
      ? {
          '200': response('Idempotent replay.', successSchema(path, method)),
          '201': response('Created.', successSchema(path, method)),
        }
      : method === 'post' && path === '/integration-testnet'
        ? { '201': response('Created.', successSchema(path, method)) }
        : method === 'post' && path === '/agent-grants'
          ? { '200': response('Pairing status or decision.', successSchema(path, method)), '201': response('Pairing request created.', successSchema(path, method)) }
          : method === 'put' && path === '/intent'
            ? { '200': response('Successful operation.', successSchema(path, method)), '201': response('Browser authorization capability issued.', schema('BrowserAuthorizationIssueResult')) }
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
        '404': response('Resource not found.', schema('ApiError')),
        '409': response('State or configuration conflict. Change the input, configuration or resource state before retrying.', schema('ApiError')),
        '410': response('Resource or capability expired.', schema('ApiError')),
        ...(request ? {
          '413': response('Request body too large.', schema('ApiError')),
          '415': response('Unsupported media type; use application/json.', schema('ApiError')),
        } : {}),
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
    humanSession: { type: 'apiKey', in: 'cookie', name: 'mst_auth', description: 'Human wallet-authenticated session cookie.' },
    humanBearer: { type: 'http', scheme: 'bearer', description: 'Short-lived Human wallet session token from POST /auth. Separate from msa and msi credentials.' },
    requestCapability: { type: 'apiKey', in: 'header', name: 'x-multisig-capability', description: 'Private share capability paired with x-multisig-request-id.' },
    intentCapability: { type: 'apiKey', in: 'header', name: 'x-multisig-intent-capability', description: 'Short-lived signer/origin/current-plan Browser authorization capability (mic_...) paired with x-multisig-intent-id.' },
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
    SignerAuthChallenge: {
      type: 'object', required: ['message', 'transaction', 'network', 'network_passphrase', 'signing_key', 'unlock_seconds'],
      properties: { message: { type: 'string' }, transaction: xdr, network: stellarNetwork, network_passphrase: { type: 'string' }, signing_key: accountId, unlock_seconds: { type: 'integer' } },
      additionalProperties: false,
    },
    SignerAuthExchangeInput: {
      type: 'object', required: ['network'],
      properties: { network: stellarNetwork, mode: { type: 'string', const: 'sep53' }, transaction: xdr, challenge: xdr, signature: { type: 'string' }, unlock_seconds: { type: 'integer', enum: [900, 3600, 28800] } },
      oneOf: [{ required: ['transaction'], not: { required: ['mode'] } }, { required: ['mode', 'challenge', 'signature'] }],
      description: 'Sign the exact sequence-zero challenge or SEP-53 message with the selected signer. Never broadcast the challenge or send a private key.',
      additionalProperties: false,
    },
    SignerAuthSession: {
      type: 'object', required: ['token', 'address', 'network', 'expires_at'],
      properties: { token: { type: 'string' }, address: accountId, network: stellarNetwork, expires_at: { type: 'integer' } },
      additionalProperties: false,
    },
    SignerAuthStatus: {
      type: 'object', required: ['unlocked', 'authenticated'],
      properties: { unlocked: { type: 'boolean' }, authenticated: { type: 'boolean' }, address: accountId, network: stellarNetwork, expires_at: { type: 'integer' } },
      additionalProperties: false,
    },
    SignerAgentAccessResult: {
      type: 'object', required: ['principal'],
      properties: { principal: { type: 'object', additionalProperties: true }, credentials: { type: 'array', items: { type: 'object', additionalProperties: true } }, credential: { type: 'object', additionalProperties: true } },
      additionalProperties: false,
    },
    AgentGrantActionInput: {
      description: 'Device pairing: request returns a one-time deviceCode; poll exchanges it after human approval. Approve requires a matching Human wallet session AND a fresh wallet signature bound to the exact grant.',
      oneOf: [
        { type: 'object', required: ['action', 'label', 'access', 'network'],
          properties: { action: { const: 'request' }, label: { type: 'string', minLength: 1, maxLength: 80 }, access: { type: 'string', enum: ['read', 'write', 'sign'] }, network: { const: 'testnet' } }, additionalProperties: false },
        { type: 'object', required: ['action', 'deviceCode'],
          properties: { action: { const: 'poll' }, deviceCode: { type: 'string', pattern: '^mgd_' } }, additionalProperties: false },
        { type: 'object', required: ['action', 'requestId', 'mode'],
          properties: { action: { const: 'approve' }, requestId: { type: 'string', pattern: '^[a-f0-9]{32}$' },
            mode: { type: 'string', enum: ['sep53', 'transaction'] }, signature: { type: 'string' }, transaction: xdr }, additionalProperties: false },
        { type: 'object', required: ['action', 'requestId'],
          properties: { action: { const: 'deny' }, requestId: { type: 'string', pattern: '^[a-f0-9]{32}$' } }, additionalProperties: false },
      ],
    },
    AgentGrantResult: {
      type: 'object',
      description: 'A pairing preview, pending/denied status, one-time device code, or once-only msa credential. Never forward deviceCode or apiKey to a browser approval URL.',
      properties: {
        status: { type: 'string', enum: ['pending', 'approved', 'denied', 'authorization_pending', 'access_denied'] },
        requestId: { type: 'string' }, userCode: { type: 'string' }, label: { type: 'string' },
        access: { type: 'string', enum: ['read', 'write', 'sign'] }, network: { const: 'testnet' },
        deviceCode: { type: 'string' }, verificationUri: { type: 'string', format: 'uri' },
        message: { type: 'string', description: 'Human-readable exact approval message.' }, transaction: xdr, signer: accountId,
        expiresAt: timestamp, intervalSeconds: { type: 'integer' }, apiKey: { type: 'string', description: 'Only once on successful poll after human wallet approval.' },
      },
      additionalProperties: true,
    },
    TestnetIntegrationCreateInput: {
      type: 'object',
      required: ['serviceId', 'label'],
      anyOf: [
        { required: ['classicSourceAccounts'], properties: { classicSourceAccounts: { minItems: 1 } } },
        { required: ['sorobanContracts'], properties: { sorobanContracts: { minItems: 1 } } },
      ],
      properties: {
        serviceId: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,39}$' },
        label: { type: 'string', minLength: 1, maxLength: 80 },
        enabled: { type: 'boolean', description: 'Optional compatibility field; self-service always creates an enabled profile.' },
        networks: { type: 'array', items: stellarNetwork, description: 'Optional compatibility field; self-service always uses Testnet.' },
        classicSourceAccounts: { type: 'array', items: accountId },
        classicExternalExecutionSourceAccounts: { type: 'array', items: accountId },
        sorobanContracts: {
          type: 'array',
          items: {
            type: 'object',
            required: ['contractId', 'methods'],
            properties: {
              contractId,
              methods: { type: 'array', minItems: 1, items: { type: 'string', pattern: '^[A-Za-z0-9_]{1,64}$' } },
              execution: {
                oneOf: [
                  {
                    type: 'object',
                    required: ['mode'],
                    properties: { mode: { type: 'string', const: 'multisigtools', description: 'Requires runtime-config capabilities.sorobanManagedExecution for the selected network.' } },
                    additionalProperties: false,
                  },
                  {
                    type: 'object',
                    required: ['mode', 'executor'],
                    properties: {
                      mode: { type: 'string', const: 'external' },
                      executor: accountId,
                    },
                    additionalProperties: false,
                  },
                ],
              },
            },
            additionalProperties: false,
          },
        },
        sorobanExecutionAccounts: { type: 'array', items: accountId },
        sorobanDefaultExecutor: accountId,
        profile: {
          type: 'object',
          properties: {
            authorizationExperience: { type: 'string', enum: ['hosted', 'native', 'headless'] },
          },
          additionalProperties: false,
        },
        webhook: {
          type: 'object',
          required: ['url', 'enabled'],
          properties: {
            url: { type: 'string', format: 'uri', pattern: '^https://' },
            enabled: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    TestnetIntegrationCreateResult: {
      type: 'object',
      required: ['operation', 'version', 'service', 'apiKey'],
      properties: {
        operation: { type: 'string', const: 'integration.testnet.create' },
        version: operationVersion,
        service: {
          type: 'object',
          required: ['serviceId', 'label', 'enabled', 'networks'],
          properties: {
            serviceId: { type: 'string' },
            label: { type: 'string' },
            enabled: { type: 'boolean', const: true },
            networks: { type: 'array', minItems: 1, maxItems: 1, items: { type: 'string', const: 'testnet' } },
          },
          additionalProperties: true,
        },
        apiKey: { type: 'string', pattern: '^msi_' },
        webhookSecret: { type: 'string', pattern: '^whsec_' },
      },
      additionalProperties: false,
    },
    RuntimeConfigResult: {
      type: 'object',
      required: ['operation', 'version', 'stellarNetwork', 'fixedNetwork', 'capabilities'],
      properties: {
        operation: { type: 'string', const: 'runtime.config.inspect' },
        version: operationVersion,
        stellarNetwork: { type: 'string', enum: ['public', 'testnet', 'dual'] },
        fixedNetwork: { oneOf: [stellarNetwork, { type: 'null' }] },
        capabilities: {
          type: 'object',
          required: ['classicManagedExecution', 'sorobanManagedExecution'],
          properties: {
            sorobanManagedExecution: {
              type: 'object', required: ['testnet', 'public'],
              properties: { testnet: { type: 'boolean' }, public: { type: 'boolean' } },
              additionalProperties: false,
            },
            classicManagedExecution: {
              type: 'object',
              required: ['testnet', 'public'],
              properties: {
                testnet: { type: 'boolean' },
                public: { type: 'boolean' },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    IntegrationExecutionInspectResult: {
      type: 'object',
      required: ['operation', 'version', 'serviceId', 'network', 'classic'],
      properties: {
        operation: { type: 'string', const: 'integration.execution.inspect' },
        version: operationVersion,
        serviceId: { type: 'string' },
        network: stellarNetwork,
        classic: {
          type: 'object',
          required: [
            'scopeConfigured',
            'managedAvailable',
            'managedSourceAccountCount',
            'externalSourceAccountCount',
            'channelCount',
            'channelSoftLimit',
            'channelAccounts',
          ],
          properties: {
            scopeConfigured: { type: 'boolean' },
            managedAvailable: { type: 'boolean' },
            managedSourceAccountCount: { type: 'integer', minimum: 0 },
            externalSourceAccountCount: { type: 'integer', minimum: 0 },
            channelCount: { type: 'integer', minimum: 0, description: 'Configured baseline channel count.' },
            channelSoftLimit: { type: 'integer', minimum: 1, description: 'Current operational soft limit. It starts at the configured base and doubles automatically when allocated slots reach half of the current limit; deterministic derivation may continue beyond it.' },
            channelAccounts: { type: 'array', items: accountId, description: 'Configured baseline public channel accounts; Testnet may lazily activate later deterministic slots.' },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    ContractInputComposition: {
      type: 'object',
      required: ['mode', 'guided'],
      properties: {
        mode: { type: 'string', enum: ['typed_json', 'dynamic_scval_json', 'scval_xdr_success_only', 'unsupported'] },
        guided: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    ContractInput: {
      type: 'object',
      required: ['name', 'doc', 'typeLabel', 'abiType', 'composition', 'kind'],
      properties: {
        name: { type: 'string' },
        doc: { type: 'string' },
        typeLabel: { type: 'string' },
        abiType: { type: 'object', description: 'Recursive fresnica-soroban-abi-v1 type descriptor.', additionalProperties: true },
        composition: schema('ContractInputComposition'),
        kind: { type: 'string', enum: ['address', 'bool', 'integer', 'string', 'symbol', 'bytes', 'bytesN', 'json', 'unsupported'] },
        bytesLength: { type: 'integer', minimum: 0 },
        unsupportedReason: { type: 'string' },
      },
      additionalProperties: false,
    },
    ContractAbi: {
      type: 'object',
      required: ['schema', 'functions', 'types'],
      properties: {
        schema: { type: 'string', const: 'fresnica-soroban-abi-v1' },
        functions: { type: 'array', items: { type: 'object', additionalProperties: true } },
        types: { type: 'array', items: { type: 'object', additionalProperties: true } },
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
      required: ['operation', 'version', 'network', 'contractId', 'methods', 'abi'],
      properties: {
        operation: { type: 'string', const: 'contract.interface.inspect' },
        version: operationVersion,
        network: stellarNetwork,
        contractId,
        methods: { type: 'array', items: schema('ContractMethod') },
        abi: schema('ContractAbi'),
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
        arguments: { type: 'object', maxProperties: 64, description: 'Named typed JSON values validated recursively against the deployed Contract Spec before ScVal encoding.', additionalProperties: true },
        preparedXdr: xdr,
        privateNote: { type: 'string' },
        externalReference: { type: 'string' },
        executor: { ...accountId, description: 'Optional Integration Service executor override. It must be inside the credential Soroban execution allowlist. If omitted, the Service default is snapshotted when configured; otherwise executor resolution remains deferred.' },
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
        cancellation: schema('SorobanIntentCancellation'),
        privateContext: { type: 'object', additionalProperties: true },
      },
      additionalProperties: false,
    },
    SorobanIntentCancellation: {
      type: 'object',
      required: ['version', 'cancelledAt', 'authorizationPlanDigest', 'authorizationPlanRevision'],
      properties: {
        version: operationVersion,
        cancelledAt: timestamp,
        authorizationPlanDigest: { type: 'string', minLength: 1 },
        authorizationPlanRevision: { type: 'integer', minimum: 1 },
        cancelledByAddress: accountId,
        cancelledBy: { type: 'object', additionalProperties: true },
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
        status: { type: 'string', enum: ['awaiting_authorization', 'authorization_ready', 'expired', 'blocked', 'cancelled'] },
        statusDetail: { type: 'string' },
        authorizationEntriesXdr: { type: 'array', items: { type: 'string' } },
        contributionCount: { type: 'integer', minimum: 0 },
        authorizers: { type: 'array', items: { type: 'object', additionalProperties: true } },
      },
      additionalProperties: false,
    },
    IntegrationSorobanJob: {
      type: 'object',
      required: ['version', 'id', 'kind', 'network', 'state', 'nextActions', 'reviewUrl'],
      properties: {
        version: operationVersion,
        id: { type: 'string', minLength: 1 },
        kind: { type: 'string', const: 'soroban_contract' },
        network: stellarNetwork,
        state: { type: 'string', enum: ['waiting_for_authorization', 'ready', 'executing', 'completed', 'expired', 'failed', 'cancelled'] },
        nextActions: {
          type: 'array',
          uniqueItems: true,
          items: { type: 'string', enum: ['prepare_execution', 'submit_execution', 'reconcile_execution', 'refresh_execution', 'replan', 'cancel'] },
        },
        reviewUrl: { type: 'string', format: 'uri' },
        waitingFor: { type: 'array', uniqueItems: true, items: { oneOf: [accountId, contractId] } },
        expiresAtLedger: { type: 'integer', minimum: 1 },
        externalReference: { type: 'string' },
        reason: { type: 'string', enum: ['authorization_blocked', 'execution_failed', 'execution_unavailable'] },
        execution: {
          type: 'object',
          required: ['owner', 'executor', 'transactionHash', 'preparedAt', 'validUntil'],
          properties: {
            owner: { type: 'string', enum: ['external_service', 'multisigtools'] },
            executor: accountId,
            transactionHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
            preparedAt: timestamp,
            validUntil: { oneOf: [timestamp, { type: 'null' }] },
          },
          additionalProperties: false,
        },
        result: {
          type: 'object',
          required: ['transactionHash', 'ledger', 'successful'],
          properties: {
            transactionHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
            ledger: { type: 'integer', minimum: 1 },
            successful: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    AgentTask: {
      type: 'object',
      required: ['version', 'id', 'kind', 'network', 'state', 'signatureRequired', 'nextActions'],
      properties: {
        version: operationVersion,
        id: { type: 'string', minLength: 1 },
        kind: { type: 'string', enum: ['classic_transaction', 'soroban_contract'] },
        network: stellarNetwork,
        state: { type: 'string', enum: ['action_required', 'waiting', 'completed', 'expired', 'failed', 'cancelled'], description: 'action_required means a required task action is available to the current credential; read-only pending work is waiting.' },
        signatureRequired: { type: 'boolean', description: 'This signer still has a pending signature or authorization decision, independently of the credential scope. A Read Agent can use this signal to notify the signer.' },
        nextActions: {
          type: 'array',
          items: {
            type: 'object',
            required: ['code', 'requiredAccess', 'available'],
            properties: {
              code: { type: 'string', enum: ['contribute_signature', 'contribute_authorization', 'decline', 'prepare_execution', 'refresh_execution', 'replan', 'cancel'] },
              requiredAccess: { type: 'string', enum: ['write', 'sign'] },
              available: { type: 'boolean' },
            },
            additionalProperties: false,
          },
        },
        waitingFor: { type: 'array', uniqueItems: true, items: { oneOf: [accountId, contractId] } },
        expiresAt: timestamp,
        expiresAtLedger: { type: 'integer', minimum: 1 },
        result: {
          type: 'object',
          required: ['transactionHash', 'ledger', 'successful'],
          properties: {
            transactionHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
            ledger: { type: 'integer', minimum: 1 },
            successful: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    SorobanIntentEvidenceEvent: {
      type: 'object',
      required: ['version', 'eventId', 'type', 'occurredAt', 'authorizationPlanDigest', 'authorizationPlanRevision'],
      properties: {
        version: operationVersion,
        eventId: { type: 'string', minLength: 1 },
        type: { type: 'string', enum: ['intent_created', 'intent_cancelled', 'authorization_added', 'authorization_plan_revised', 'execution_prepared', 'execution_confirmed', 'execution_failed'] },
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
        job: schema('IntegrationSorobanJob'),
        task: schema('AgentTask'),
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
        job: schema('IntegrationSorobanJob'),
        task: schema('AgentTask'),
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
        task: schema('AgentTask'),
      },
      additionalProperties: false,
    },
    BrowserAuthorizationChallenge: {
      type: 'object',
      required: ['entryIndex', 'authorizer', 'preimageXdr', 'expiresAtLedger'],
      properties: {
        entryIndex: { type: 'integer', minimum: 0 },
        authorizer: accountId,
        preimageXdr: { type: 'string', minLength: 1, description: 'Signer-specific Soroban authorization preimage for wallet signAuthEntry().' },
        expiresAtLedger: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
    BrowserAuthorization: {
      type: 'object',
      required: ['version', 'intentId', 'network', 'intentDigest', 'authorizationPlanDigest', 'authorizationPlanRevision', 'signerAddress', 'status', 'expiresAt', 'challenges', 'hostedReviewUrl'],
      properties: {
        version: operationVersion,
        intentId: { type: 'string', minLength: 1 },
        network: stellarNetwork,
        intentDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        authorizationPlanDigest: { type: 'string', minLength: 1 },
        authorizationPlanRevision: { type: 'integer', minimum: 1 },
        signerAddress: accountId,
        status: { type: 'string', enum: ['awaiting_authorization', 'authorization_ready', 'expired', 'blocked', 'cancelled'] },
        expiresAt: timestamp,
        challenges: { type: 'array', items: schema('BrowserAuthorizationChallenge') },
        hostedReviewUrl: { type: 'string', format: 'uri' },
      },
      additionalProperties: false,
    },
    BrowserAuthorizationIssueInput: {
      type: 'object',
      required: ['action', 'signerAddress', 'origin'],
      properties: {
        action: { type: 'string', const: 'issue_browser_authorization' },
        signerAddress: accountId,
        origin: { type: 'string', format: 'uri', description: 'Exact Browser origin bound to the short-lived capability.' },
      },
      additionalProperties: false,
    },
    BrowserAuthorizationIssueResult: {
      type: 'object',
      required: ['operation', 'version', 'capability', 'origin', 'browserAuthorization'],
      properties: {
        operation: { type: 'string', const: 'integration.intent.browser.issue' },
        version: operationVersion,
        capability: { type: 'string', pattern: '^mic_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+$' },
        origin: { type: 'string', format: 'uri' },
        browserAuthorization: schema('BrowserAuthorization'),
      },
      additionalProperties: false,
    },
    BrowserAuthorizationInspectResult: {
      type: 'object',
      required: ['operation', 'version', 'browserAuthorization'],
      properties: {
        operation: { type: 'string', const: 'integration.intent.browser.inspect' },
        version: operationVersion,
        browserAuthorization: schema('BrowserAuthorization'),
      },
      additionalProperties: false,
    },
    BrowserAuthorizationContributionResult: {
      type: 'object',
      required: ['operation', 'version', 'added', 'browserAuthorization'],
      properties: {
        operation: { type: 'string', const: 'integration.intent.browser.contribute' },
        version: operationVersion,
        added: { type: 'boolean' },
        browserAuthorization: schema('BrowserAuthorization'),
      },
      additionalProperties: false,
    },
    ContractIntentExecutionInput: {
      type: 'object',
      anyOf: [
        { required: ['executor'] },
        { required: ['executionSource'] },
        { required: ['action'] },
      ],
      properties: {
        action: { type: 'string', enum: ['prepare_execution', 'refresh_execution'], description: 'prepare_execution materializes the current execution package. refresh_execution deliberately materializes a fresh package after a lost, stale, or failed prior attempt. Both reuse the already-bound executor.' },
        executor: { ...accountId, description: 'Preferred executor field. Integration callers may omit it when the Intent already snapshotted an executor. If unresolved, providing it binds the executor for this Intent.' },
        executionSource: { ...accountId, deprecated: true, description: 'Legacy alias for executor.' },
        acceptedEffectsDigest: { type: 'string', pattern: '^[0-9a-f]{64}$', description: 'Explicit acceptance of the exact current effects digest after reviewing a critical numeric-only diff. Structural changes cannot be accepted here and require a fresh authorization-plan revision. Integration Services cannot use this field.' },
      },
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
    ContractIntentCancelInput: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          const: 'cancel',
          description: 'Close this Intent inside MultiSigTools coordination. Detached AUTH or prepared XDR already disclosed outside MultiSigTools cannot be revoked by this operation.',
        },
      },
      additionalProperties: false,
    },
    ContractIntentCancelResult: {
      type: 'object',
      required: ['operation', 'version', 'replayed', 'intent', 'authorization', 'cancellation'],
      properties: {
        operation: { type: 'string', const: 'contract.intent.cancel' },
        version: operationVersion,
        replayed: { type: 'boolean' },
        intent: schema('StoredSorobanIntent'),
        authorization: schema('SorobanIntentAuthorizationSnapshot'),
        cancellation: schema('SorobanIntentCancellation'),
        job: schema('IntegrationSorobanJob'),
        task: schema('AgentTask'),
      },
      additionalProperties: false,
    },
    SorobanIntentExecutionPreparation: {
      type: 'object',
      required: ['version', 'intentId', 'network', 'intentDigest', 'authorizationPlanDigest', 'authorizationPlanRevision', 'executionSource', 'transactionSequence', 'transactionHash', 'validUntil', 'latestLedger', 'effectsDiff', 'effects', 'effectsAccepted', 'preparedAt', 'xdr'],
      properties: {
        version: operationVersion,
        intentId: { type: 'string' },
        network: stellarNetwork,
        intentDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        authorizationPlanDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        authorizationPlanRevision: { type: 'integer', minimum: 1 },
        executor: schema('SorobanExecutorBinding'),
        executionSource: accountId,
        transactionSequence: { type: 'string' },
        transactionHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        validUntil: { oneOf: [timestamp, { type: 'null' }] },
        latestLedger: { type: 'integer', minimum: 1 },
        effectsDiff: schema('SorobanEffectsDiff'),
        effects: schema('SorobanEffectsSnapshot'),
        effectsAccepted: { type: 'boolean' },
        preparedAt: timestamp,
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
        job: schema('IntegrationSorobanJob'),
        task: schema('AgentTask'),
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
        job: schema('IntegrationSorobanJob'),
        task: schema('AgentTask'),
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
        job: schema('IntegrationSorobanJob'),
        task: schema('AgentTask'),
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
        arguments: { type: 'object', maxProperties: 64, description: 'Named typed JSON values validated recursively against the deployed Contract Spec before ScVal encoding.', additionalProperties: true },
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
    SorobanExecutorBinding: {
      type: 'object',
      required: ['address', 'source'],
      properties: {
        address: accountId,
        source: { type: 'string', enum: ['intent', 'service_default', 'contract_policy', 'service_prepare', 'multisigtools_managed'] },
      },
      additionalProperties: false,
    },
    ExecutionPolicy: {
      type: 'object',
      required: ['mode'],
      properties: {
        mode: { type: 'string', enum: ['multisigtools', 'external'] },
        executor: schema('SorobanExecutorBinding'),
        fallback: { type: 'string', const: 'multisigtools_managed' },
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
        transactionSourceAccount: { ...accountId, description: 'Present when transaction-source execution is separated from the business Treasury source.' },
        transactionSourceSequence: { type: 'string', description: 'Current sequence used to prepare the separate transaction-source account.' },
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
        { required: ['payment'], description: 'Semantic Classic payment creation is available to Integration Service callers. For MST-managed semantic execution, runtime capabilities.classicManagedExecution must be true for the selected network. Otherwise prepare an unsigned payment with integration.classic.payment.prepare and create a Request using its xdr, or explicitly configure external execution.' },
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
        { type: 'object', description: 'Requires valid signer authorization; Agent callers require Sign access.', required: ['signedXdr'], properties: { signedXdr: xdr }, additionalProperties: false, 'x-multisig-access': 'principal:sign' },
        { type: 'object', description: 'Requires a Human signer session or an Agent credential with Write access.', required: ['decision'], properties: { decision: { type: 'string', const: 'decline' } }, additionalProperties: false, 'x-multisig-access': 'principal:write' },
        { type: 'object', description: 'Human only: verified current signer session (bearer or cookie), while the Proposal is active. Agent and Integration credentials cannot retain Activity.', required: ['retainActivity'], properties: { retainActivity: { type: 'boolean', const: true } }, additionalProperties: false, 'x-multisig-access': 'human' },
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
    SignerInboxResult: {
      type: 'object',
      required: ['address', 'network', 'actor', 'pending_count', 'action_count', 'requests'],
      properties: {
        address: accountId,
        network: stellarNetwork,
        actor: { type: 'string', enum: ['agent', 'human'] },
        pending_count: { type: 'integer', minimum: 0 },
        action_count: { type: 'integer', minimum: 0, description: 'For Agent callers, the number of tasks with at least one nextAction whose available flag is true.' },
        signature_required_count: { type: 'integer', minimum: 0, description: 'For Agent callers, the number of returned tasks with signatureRequired=true, regardless of scope.' },
        requests: { type: 'array', items: { type: 'object', additionalProperties: true } },
        intents: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Pending Soroban Intents visible to the authenticated signer.' },
        tasks: { type: 'array', items: schema('AgentTask'), description: 'Present for Agent callers. A classic_transaction task refers to a Request; a soroban_contract task refers to an Intent. Both counts include both kinds.' },
      },
      additionalProperties: true,
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
        task: schema('AgentTask'),
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
      description: 'Composable Stellar coordination operations for Human, signer Agent, bot, script, wallet, plugin, MCP, CLI, and scoped external-service consumers. Building or preparing XDR never grants signer authority. Signer Agent credentials cannot directly submit. Integration-owned Requests may be automatically submitted at quorum, retried by their Integration, or designated for external execution.',
    },
    servers: [{ url: origin }],
    paths: openApiPaths(),
    components,
    externalDocs: {
      description: 'MultiSig Tools developer integration and authority guide',
      url: 'https://docs.multisig.tools/stellar/developers',
    },
  };
}
