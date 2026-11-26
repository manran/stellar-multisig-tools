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
  if (path === '/inbox') {
    values.push(
      parameter('limit', 'query', false, { type: 'integer', minimum: 1, maximum: 100, default: 50 }, 'Maximum combined Request and Intent tasks on this page.'),
      parameter('cursor', 'query', false, { type: 'string' }, 'Opaque nextCursor from the previous Inbox page. Each page revalidates live signer access.'),
    );
  }
  if (path === '/activity') {
    values.push(
      parameter('view', 'query', false, { type: 'string', const: 'work' }, 'Use work for unified personal Classic and Soroban Activity. Omit for Classic history.'),
      parameter('account', 'query', false, { type: 'string', pattern: '^G[A-Z2-7]{55}$' }, 'Optional Treasury account. An Audit credential is bound to its own Treasury.'),
      parameter('request', 'query', false, { type: 'string' }, 'Optional Classic Request id for detail.'),
      parameter('cursor', 'query', false, { type: 'string' }, 'Opaque nextCursor from the previous page.'),
    );
  }
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
      parameter('view', 'query', false, { type: 'string', enum: ['history', 'reconciliation'] }, 'Retained signer history, or external Classic execution reconciliation for the owning Integration.'),
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
  if (path === '/agent-access' && method === 'delete') return body(schema('AgentAccessDeleteInput'));
  if (path === '/agent-grants' && method === 'post') return body(schema('AgentGrantActionInput'));
  if (path === '/integration-testnet' && method === 'post') return body(schema('TestnetIntegrationCreateInput'));
  if (path === '/intent' && method === 'post') return body(schema('ContractIntentCreateInput'));
  if (path === '/intent' && method === 'patch') return body(schema('ContractIntentContributionInput'));
  if (path === '/intent' && method === 'put') return body(schema('ContractIntentActionInput'));
  if (path === '/contract-call' && method === 'post') return body(schema('ContractCallBuildInput'));
  if (path === '/contract-prepare' && method === 'post') return body(schema('ContractPrepareInput'));
  if (path === '/contracts' && (method === 'put' || method === 'delete')) return body(schema('ContractWorkspaceInput'));
  if (path === '/payment-prepare' && method === 'post') return body(schema('ClassicPaymentPrepareInput'));
  if (path === '/account-create-prepare' && method === 'post') return body(schema('ClassicCreateAccountPrepareInput'));
  if (path === '/address-book' && method === 'put') return body(schema('ContactSaveInput'));
  if (path === '/address-book' && method === 'delete') return body(schema('ContactDeleteInput'));
  if (path === '/request' && method === 'post') return body(schema('ProposalCreateInput'));
  if (path === '/request' && method === 'patch') return body(schema('ProposalPatchInput'));
  if (path === '/request' && method === 'put') return { ...body(schema('ProposalSubmitInput')), required: false };
  return undefined;
}

function successSchema(path: string, method: string): OpenApiObject {
  if (path === '/auth') return method === 'get' ? { oneOf: [schema('SignerAuthChallenge'), schema('SignerAuthStatus')] } : schema(method === 'delete' ? 'SignerAuthStatus' : 'SignerAuthSession');
  if (path === '/agent-access') return schema('SignerAgentAccessResult');
  if (path === '/runtime-config') return schema('RuntimeConfigResult');
  if (path === '/inbox') return schema('SignerInboxResult');
  if (path === '/activity') return schema('SignerActivityResult');
  if (path === '/treasuries') return schema('SignerTreasuriesResult');
  if (path === '/address-book') return schema(method === 'get' ? 'ContactListResult' : method === 'put' ? 'ContactSaveResult' : 'ContactDeleteResult');
  if (path === '/agent-grants') return schema('AgentGrantResult');
  if (path === '/integration-testnet') return schema('TestnetIntegrationCreateResult');
  if (path === '/integration-execution') return schema('IntegrationExecutionInspectResult');
  if (path === '/contract-interface') return schema('ContractInterfaceResult');
  if (path === '/intent' && method === 'post') return schema('ContractIntentCreateResult');
  if (path === '/intent' && method === 'get') return { oneOf: [schema('ContractIntentInspectResult'), schema('BrowserAuthorizationInspectResult')] };
  if (path === '/intent' && method === 'patch') return { oneOf: [schema('ContractIntentContributionResult'), schema('BrowserAuthorizationContributionResult')] };
  if (path === '/intent' && method === 'put') return { oneOf: [schema('ContractIntentExecutionResult'), schema('ContractIntentExecutionResumeResult'), schema('ContractIntentExecutionReconcileResult'), schema('ContractIntentReplanResult'), schema('ContractIntentCancelResult'), schema('BrowserAuthorizationIssueResult')] };
  if (path === '/contract-call') return schema('ContractCallBuildResult');
  if (path === '/contract-prepare') return { oneOf: [schema('ContractPrepareResult'), schema('ContractEnforceResult')] };
  if (path === '/contracts' && method === 'get') return schema('ContractWorkspaceListResult');
  if (path === '/contracts' && method === 'put') return schema('ContractWorkspaceKeepResult');
  if (path === '/contracts' && method === 'delete') return schema('ContractWorkspaceForgetResult');
  if (path === '/payment-prepare') return schema('ClassicPaymentPrepareResult');
  if (path === '/account-create-prepare') return schema('ClassicCreateAccountPrepareResult');
  if (path === '/request') return method === 'get' ? { oneOf: [schema('ProposalResult'), schema('ClassicExecutionReconcileResult')] } : schema('ProposalResult');
  return { type: 'object', additionalProperties: true };
}

function security(path: string, method: string, access: HeadlessOperationAccess): OpenApiObject[] {
  if (path === '/auth' && (method === 'get' || method === 'delete')) return [{}, { humanBearer: [] }, { humanSession: [] }];
  if (path === '/agent-grants') return [{}, { humanBearer: [] }, { humanSession: [] }]; // Public actions need no session; challenge/approve/deny require Human session.
  if (path === '/agent-access') return [{ humanBearer: [] }, { humanSession: [] }];
  if (access === 'public') return [];
  if (path === '/intent') {
    if (method === 'patch') return [{ agentBearer: [] }, { humanBearer: [] }, { humanSession: [] }, { intentCapability: [] }];
    if (method === 'get') return [{ agentBearer: [] }, { integrationBearer: [] }, { humanBearer: [] }, { humanSession: [] }, { intentCapability: [] }];
    return [{ agentBearer: [] }, { integrationBearer: [] }, { humanBearer: [] }, { humanSession: [] }];
  }
  if (path === '/integration-execution') return [{ integrationBearer: [] }];
  if (path === '/treasuries') return [{ agentBearer: [] }];
  if (path === '/activity') return [{ agentBearer: [] }, { humanBearer: [] }, { humanSession: [] }, { treasuryAuditBearer: [] }];
  if (['/contracts', '/inbox', '/address-book'].includes(path)) return [{ agentBearer: [] }, { humanBearer: [] }, { humanSession: [] }];
  if (path === '/payment-prepare' || path === '/account-create-prepare') return [{ agentBearer: [] }, { integrationBearer: [] }, { humanBearer: [] }, { humanSession: [] }];
  if (path === '/request' && method === 'put') return [{ integrationBearer: [] }, { humanBearer: [] }, { humanSession: [] }, { requestCapability: [] }];
  if (path === '/request' && method === 'post') return [{ agentBearer: [] }, { integrationBearer: [] }, { humanBearer: [] }, { humanSession: [] }];
  if (path === '/request' && method === 'get') return [{ agentBearer: [] }, { integrationBearer: [] }, { humanBearer: [] }, { humanSession: [] }, { requestCapability: [] }];
  return [{ agentBearer: [] }, { humanBearer: [] }, { humanSession: [] }, { requestCapability: [] }];
}

function transportOperationId(path: string, method: string, operations: readonly HeadlessOperationDescriptor[]): string {
  if (operations.length === 1) return operations[0].id;
  return 'transport.' + path.slice(1).replaceAll('/', '.') + '.' + method;
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
        '502': response('Upstream service returned an invalid or unavailable response.', schema('ApiError')),
        '503': response('Dependency unavailable.', schema('ApiError')),
        '504': response('Upstream outcome may be unknown.', schema('ApiError')),
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

function grantPreviewSchema(extra: OpenApiObject = {}, required: string[] = []): OpenApiObject {
  return {
    type: 'object',
    required: ['requestId', 'userCode', 'label', 'access', 'network', 'expiresAt', 'status', ...required],
    properties: {
      requestId: { type: 'string', pattern: '^[a-f0-9]{32}$' }, userCode: { type: 'string' }, label: { type: 'string' },
      access: { enum: ['read', 'write', 'sign'] }, network: { const: 'testnet' },
      expiresAt: timestamp, status: { enum: ['pending', 'approved', 'denied'] }, ...extra,
    },
    additionalProperties: false,
  };
}

// Terminal outcomes require their matching evidence and forbid contradictory evidence.
function executionOutcomeBranches(): OpenApiObject[] {
  return [
    { properties: { outcome: { const: 'unknown' }, observed: { const: false } },
      not: { anyOf: [{ required: ['observation'] }, { required: ['nonInclusionProof'] }] } },
    { required: ['nonInclusionProof'], properties: { outcome: { const: 'not_included' }, observed: { const: false } },
      not: { required: ['observation'] } },
    ...(['successful', 'failed'] as const).map((outcome) => ({
      required: ['observation'],
      properties: { outcome: { const: outcome }, observed: { const: true },
        observation: { properties: { successful: { const: outcome === 'successful' } } } },
      not: { required: ['nonInclusionProof'] },
    })),
  ];
}

/** Compact task/job completion must never contradict its receipt. */
function completedExecutionProjection(task: boolean): OpenApiObject {
  return {
    if: { properties: { state: { const: 'completed' } } },
    then: { required: ['result'], properties: {
      result: { properties: { successful: { const: true } } }, nextActions: { maxItems: 0 }, unresolvedTransactionHashes: { maxItems: 0 },
      ...(task ? { signatureRequired: { const: false } } : { actionCalls: { maxProperties: 0 } }),
    } },
    else: { not: { required: ['result'], properties: { result: { properties: { successful: { const: true } } } } } },
  };
}

const submissionProperties = {
  transactionHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  ledger: { type: 'integer', minimum: 1 },
  submittedAt: timestamp,
  ledgerTransactionHash: { type: 'string', pattern: '^[0-9a-f]{64}$', description: 'Actual ledger envelope hash if a fee bump wrapped the Request transaction.' },
};
const classicExecutionEvidenceProperties = {
  outcome: { type: 'string', enum: ['unknown', 'not_included', 'failed', 'successful'] },
  observed: { type: 'boolean' },
  nonInclusionProof: schema('ClassicExecutionNonInclusionProof'),
  observation: schema('ClassicExecutionObservation'),
};

const components: OpenApiObject = {
  securitySchemes: {
    agentBearer: { type: 'http', scheme: 'bearer', description: 'Signer Agent credential (msa_...). Human SEP-10 bearer sessions are also accepted where documented.' },
    integrationBearer: { type: 'http', scheme: 'bearer', description: 'Non-signer external service credential (msi_...). Deployment scope restricts networks, Classic source accounts, Soroban contracts/methods, and Soroban execution source accounts.' },
    treasuryAuditBearer: { type: 'http', scheme: 'bearer', description: 'Treasury Audit credential (mta_...), read-only Activity for its one bound Treasury; no personal signer workspace access.' },
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
    AgentAccessDeleteInput: { type: 'object', required: ['credentialId'], properties: { credentialId: { type: 'string', minLength: 1 } }, additionalProperties: false },
    SignerAgentAccessResult: {
      type: 'object', required: ['principal'],
      properties: { principal: { type: 'object', additionalProperties: true }, credentials: { type: 'array', items: { type: 'object', additionalProperties: true } }, credential: { type: 'object', additionalProperties: true } },
      additionalProperties: false,
    },
    AgentGrantActionInput: {
      oneOf: ['AgentGrantRequestInput', 'AgentGrantPollInput', 'AgentGrantApproveInput', 'AgentGrantDenyInput'].map(schema),
    },
    AgentGrantRequestInput: {
      type: 'object', required: ['action', 'label', 'access', 'network'],
      properties: { action: { const: 'request' }, label: { type: 'string', minLength: 1, maxLength: 80 }, access: { type: 'string', enum: ['read', 'write', 'sign'] }, network: { const: 'testnet' } },
      additionalProperties: false,
    },
    AgentGrantPollInput: {
      type: 'object', required: ['action', 'deviceCode'],
      properties: { action: { const: 'poll' }, deviceCode: { type: 'string', pattern: '^mgd_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$' } },
      additionalProperties: false,
    },
    AgentGrantApproveInput: {
      type: 'object', required: ['action', 'requestId', 'mode'],
      properties: { action: { const: 'approve' }, requestId: { type: 'string', pattern: '^[a-f0-9]{32}$' },
        mode: { type: 'string', enum: ['sep53', 'transaction'] }, signature: { type: 'string', minLength: 1 }, transaction: xdr },
      oneOf: [
        { required: ['signature'], properties: { mode: { const: 'sep53' } }, not: { required: ['transaction'] } },
        { required: ['transaction'], properties: { mode: { const: 'transaction' } }, not: { required: ['signature'] } },
      ],
      additionalProperties: false,
    },
    AgentGrantDenyInput: {
      type: 'object', required: ['action', 'requestId'],
      properties: { action: { const: 'deny' }, requestId: { type: 'string', pattern: '^[a-f0-9]{32}$' } },
      additionalProperties: false,
    },
    AgentGrantPreview: grantPreviewSchema(),
    AgentGrantRequestResult: grantPreviewSchema({
      status: { const: 'pending' },
      deviceCode: { type: 'string', pattern: '^mgd_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$' },
      verificationUri: { type: 'string', format: 'uri' },
      intervalSeconds: { type: 'integer', minimum: 1 },
    }, ['deviceCode', 'verificationUri', 'intervalSeconds']),
    AgentGrantChallengeResult: grantPreviewSchema({
      status: { const: 'pending' },
      message: { type: 'string', minLength: 1 }, transaction: xdr, signer: accountId,
    }, ['message', 'transaction', 'signer']),
    AgentGrantPollResult: {
      oneOf: [
        { type: 'object', required: ['status'], properties: { status: { enum: ['authorization_pending', 'access_denied'] } }, additionalProperties: false },
        { type: 'object', required: ['status', 'apiKey', 'credential'],
          properties: { status: { const: 'approved' }, apiKey: { type: 'string', pattern: '^msa_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$' }, credential: { type: 'object', required: ['credentialId', 'principal', 'access'], additionalProperties: true } }, additionalProperties: false },
      ],
    },
    AgentGrantDecisionResult: {
      type: 'object', required: ['status'], properties: { status: { enum: ['approved', 'denied'] } }, additionalProperties: false,
    },
    AgentGrantResult: {
      description: 'Transport union. Use the per-operation contract to distinguish Human consent from successful credential delivery.',
      oneOf: ['AgentGrantPreview', 'AgentGrantRequestResult', 'AgentGrantChallengeResult', 'AgentGrantPollResult', 'AgentGrantDecisionResult'].map(schema),
    },
    AgentGrantRecoveryError: {
      type: 'object', required: ['error', 'code', 'details'],
      properties: {
        error: { type: 'string' }, code: { enum: ['already_exchanged', 'exchange_outcome_unknown', 'grant_expired', 'agent_credential_limit_reached', 'agent_credential_conflict', 'agent_pairing_rate_limited'] },
        details: { type: 'object', required: ['requestId', 'recoveryOperations'], properties: {
          requestId: { type: 'string', pattern: '^[a-f0-9]{32}$' },
          credentialId: { type: 'string', pattern: '^[A-Za-z0-9_-]{12}$' },
          recoveryOperations: { type: 'array', items: { type: 'string' } },
        }, additionalProperties: false },
      }, additionalProperties: false,
    },
    TestnetIntegrationExistsError: {
      type: 'object', required: ['error', 'code', 'details'],
      properties: {
        error: { type: 'string' }, code: { const: 'integration_service_exists' },
        details: { type: 'object', required: ['serviceId', 'recovery'],
          properties: { serviceId: { type: 'string' }, recovery: { const: 'new_service_id_or_authorized_operator_rotation' } }, additionalProperties: false },
      }, additionalProperties: false,
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
        status: { type: 'string', enum: ['awaiting_authorization', 'authorization_ready', 'expired', 'blocked', 'cancelled', 'completed'] },
        statusDetail: { type: 'string' },
        authorizationEntriesXdr: { type: 'array', items: { type: 'string' } },
        contributionCount: { type: 'integer', minimum: 0 },
        authorizers: { type: 'array', items: { type: 'object', additionalProperties: true } },
      },
      additionalProperties: false,
    },
    IntegrationSorobanJob: {
      type: 'object',
      required: ['version', 'id', 'kind', 'network', 'state', 'nextActions', 'actionCalls', 'reviewUrl'],
      properties: {
        version: operationVersion,
        id: { type: 'string', minLength: 1 },
        kind: { type: 'string', const: 'soroban_contract' },
        network: stellarNetwork,
        state: { type: 'string', enum: ['waiting_for_authorization', 'ready', 'executing', 'execution_unknown', 'completed', 'expired', 'failed', 'cancelled'] },
        nextActions: {
          type: 'array',
          uniqueItems: true,
          items: { type: 'string', enum: ['prepare_execution', 'submit_execution', 'reconcile_execution', 'refresh_execution', 'resume_execution', 'replan', 'cancel'] },
        },
        actionCalls: { type: 'object', description: 'Resolve each offered action by operationId and bodyDefaults. External submission is not an MST API call; use the exact prepared and authorized XDR matching transactionHash.', additionalProperties: { oneOf: [
          { type: 'object', required: ['operationId', 'bodyDefaults'], properties: { operationId: { type: 'string' }, bodyDefaults: { type: 'object', required: ['action'], properties: { action: { type: 'string' }, transactionHash: { type: 'string', pattern: '^[0-9a-f]{64}$' } }, additionalProperties: false }, reviewRequired: { const: true, description: 'Review the resolved prior attempt and current authorization before continuing this same Intent. This is a caller decision, not a new grant of signing authority.' } }, additionalProperties: false },
          { type: 'object', required: ['transport', 'transactionHash'], properties: { transport: { const: 'external_stellar_submission' }, transactionHash: { type: 'string', pattern: '^[0-9a-f]{64}$' } }, additionalProperties: false },
        ] } },
        reviewUrl: { type: 'string', format: 'uri' },
        waitingFor: { type: 'array', uniqueItems: true, items: { oneOf: [accountId, contractId] } },
        expiresAtLedger: { type: 'integer', minimum: 1 },
        externalReference: { type: 'string' },
        reason: { type: 'string', enum: ['authorization_blocked', 'execution_failed', 'execution_unavailable', 'execution_outcome_unknown'] },
        unresolvedTransactionHashes: { type: 'array', uniqueItems: true, items: { type: 'string', pattern: '^[0-9a-f]{64}$' }, description: 'Reconcile every unresolved prepared hash before preparing or replanning.' },
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
      allOf: [completedExecutionProjection(false)],
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
        state: { type: 'string', enum: ['action_required', 'waiting', 'completed', 'execution_unknown', 'expired', 'failed', 'cancelled'], description: 'action_required means a required task action is available to the current credential; read-only pending work is waiting. execution_unknown means the external Classic payment outcome is unresolved despite a closed or blocked signing task.' },
        signatureRequired: { type: 'boolean', description: 'This signer still has a pending signature or authorization decision, independently of the credential scope. A Read Agent can use this signal to notify the signer.' },
        nextActions: {
          type: 'array',
          items: {
            type: 'object',
            required: ['code', 'operationId', 'requiredAccess', 'available'],
            properties: {
              operationId: { type: 'string', description: 'Resolve this exact call in x-multisig-operations. Use the task id in the required resource header.' },
              bodyDefaults: { type: 'object', additionalProperties: { type: 'string' } },
              requiredInputs: { type: 'array', items: { type: 'string' }, description: 'Additional fields the caller must choose explicitly before invoking this action.' },
              code: { type: 'string', enum: ['contribute_signature', 'contribute_authorization', 'decline', 'prepare_execution', 'refresh_execution', 'resume_execution', 'reconcile_execution', 'replan', 'cancel'] },
              requiredAccess: { type: 'string', enum: ['write', 'sign'] },
              available: { type: 'boolean' },
              reviewRequired: { const: true, description: 'Review the resolved prior attempt before continuing this same Intent; availability alone does not authorize a retry.' },
            },
            additionalProperties: false,
          },
        },
        waitingFor: { type: 'array', uniqueItems: true, items: { oneOf: [accountId, contractId] } },
        expiresAt: timestamp,
        expiresAtLedger: { type: 'integer', minimum: 1 },
        executionOutcome: schema('ClassicExecutionEvidence'),
        unresolvedTransactionHashes: { type: 'array', uniqueItems: true, items: { type: 'string', pattern: '^[0-9a-f]{64}$' } },
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
      allOf: [completedExecutionProjection(true),
        { if: { properties: { state: { const: 'execution_unknown' } } }, then: { required: ['executionOutcome'], properties: { kind: { const: 'classic_transaction' }, executionOutcome: { properties: { outcome: { const: 'unknown' } } }, signatureRequired: { const: false }, nextActions: { maxItems: 0 } }, not: { required: ['result'] } } },
        { if: { required: ['executionOutcome'] }, then: { properties: { kind: { const: 'classic_transaction' } } } },
        { if: { required: ['executionOutcome'], properties: { executionOutcome: { properties: { outcome: { const: 'unknown' } } } } }, then: { properties: { state: { enum: ['action_required', 'waiting', 'execution_unknown'] } }, not: { required: ['result'] } } },
        { if: { required: ['executionOutcome'], properties: { executionOutcome: { properties: { outcome: { const: 'failed' } } } } }, then: { required: ['result'], properties: { state: { const: 'failed' }, result: { properties: { successful: { const: false } } } } } },
        { if: { required: ['executionOutcome'], properties: { executionOutcome: { properties: { outcome: { const: 'successful' } } } } }, then: { properties: { state: { const: 'completed' } } } },
        { if: { required: ['executionOutcome'], properties: { executionOutcome: { properties: { outcome: { const: 'not_included' } } } } }, then: { properties: { state: { const: 'expired' } }, not: { required: ['result'] } } },
      ],
      additionalProperties: false,
    },
    SorobanExecutionNonInclusionProof: {
      type: 'object', required: ['oldestLedger', 'latestLedger', 'latestLedgerClosedAt', 'checkedAt'],
      properties: { oldestLedger: { type: 'integer', minimum: 1 }, latestLedger: { type: 'integer', minimum: 1 }, latestLedgerClosedAt: timestamp, checkedAt: timestamp },
      additionalProperties: false,
    },
    SorobanIntentEvidenceEvent: {
      type: 'object',
      required: ['version', 'eventId', 'type', 'occurredAt', 'authorizationPlanDigest', 'authorizationPlanRevision'],
      properties: {
        version: operationVersion,
        eventId: { type: 'string', minLength: 1 },
        type: { type: 'string', enum: ['intent_created', 'intent_cancelled', 'authorization_added', 'authorization_plan_revised', 'execution_prepared', 'execution_not_included', 'execution_confirmed', 'execution_failed'] },
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
        resumable: { const: true },
        validUntil: { oneOf: [timestamp, { type: 'null' }] },
        latestLedger: { type: 'integer', minimum: 1 },
        nonInclusionProof: schema('SorobanExecutionNonInclusionProof'),
        ledger: { type: 'integer', minimum: 1 },
        successful: { type: 'boolean' },
        observedAt: timestamp,
      },
      allOf: [
        { if: { properties: { type: { const: 'execution_not_included' } } }, then: { required: ['transactionHash', 'nonInclusionProof'], not: { anyOf: [{ required: ['ledger'] }, { required: ['successful'] }] } }, else: { not: { required: ['nonInclusionProof'] } } },
        ...(['execution_confirmed', 'execution_failed'] as const).map((type) => ({ if: { properties: { type: { const: type } } }, then: { required: ['transactionHash', 'ledger', 'successful', 'observedAt'], properties: { successful: { const: type === 'execution_confirmed' } } } })),
      ],
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
        callSummary: { type: 'object', required: ['contractAddress', 'functionName', 'argumentPreviews'],
          properties: {
            contractAddress: contractId, functionName: { type: 'string' },
            argumentPreviews: { type: 'array', items: { type: 'string' } },
            nativeXlmTransfer: { type: 'object', required: ['from', 'to', 'amount'],
              properties: { from: { type: 'string' }, to: { type: 'string' }, amount: { type: 'string' } },
              additionalProperties: false },
          }, additionalProperties: false, description: 'Review summary decoded from the stored HostFunction XDR. XLM amount is in XLM, not stroops. Generic arguments are previews, not authoritative signing input.' },
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
        signatureBase64: { type: 'string', minLength: 1, description: 'Base64 Ed25519 signature of SHA-256(HashIdPreimage XDR bytes), constructed for this entryIndex, network and plan expirationLedger. Do not sign the Base64 text.' },
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
        status: { type: 'string', enum: ['awaiting_authorization', 'authorization_ready', 'expired', 'blocked', 'cancelled', 'completed'] },
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
    ContractIntentActionInput: { oneOf: ['ContractIntentExecutionInput', 'ContractIntentExecutionResumeInput', 'ContractIntentExecutionReconcileInput', 'ContractIntentReplanInput', 'ContractIntentCancelInput', 'BrowserAuthorizationIssueInput'].map(schema) },
    ContractIntentExecutionInput: {
      type: 'object',
      anyOf: [
        { required: ['executor'] },
        { required: ['executionSource'] },
        { required: ['action'] },
      ],
      properties: {
        action: { type: 'string', enum: ['prepare_execution', 'refresh_execution'], description: 'Prepare an execution package. Refresh is allowed only after every previous hash has a verified failed receipt or proven non-inclusion. A lost response, timeout, or local expiry is not proof.' },
        executor: { ...accountId, description: 'Preferred executor field. Integration callers may omit it when the Intent already snapshotted an executor. If unresolved, providing it binds the executor for this Intent.' },
        executionSource: { ...accountId, deprecated: true, description: 'Legacy alias for executor.' },
        acceptedEffectsDigest: { type: 'string', pattern: '^[0-9a-f]{64}$', description: 'Explicit acceptance of the exact current effects digest after reviewing a critical numeric-only diff. Structural changes cannot be accepted here and require a fresh authorization-plan revision. Integration Services cannot use this field.' },
      },
      additionalProperties: false,
    },
    ContractIntentExecutionResumeInput: {
      type: 'object', required: ['action', 'transactionHash'],
      properties: { action: { const: 'resume_execution' }, transactionHash: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' } },
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
    ContractIntentExecutionResumeResult: {
      type: 'object', required: ['operation', 'version', 'execution'],
      properties: { operation: { const: 'contract.intent.execution.resume' }, version: operationVersion,
        execution: schema('SorobanIntentExecutionPreparation'), job: schema('IntegrationSorobanJob'), task: schema('AgentTask') },
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
      required: ['operation', 'version', 'transactionHash', 'observed', 'replayed', 'outcome'],
      properties: {
        operation: { type: 'string', const: 'contract.intent.execution.reconcile' },
        version: operationVersion,
        transactionHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        observed: { type: 'boolean' },
        replayed: { type: 'boolean' },
        outcome: { type: 'string', enum: ['unknown', 'not_included', 'failed', 'successful'] },
        nonInclusionProof: schema('SorobanExecutionNonInclusionProof'),
        observation: schema('SorobanIntentExecutionObservation'),
        projectionNotRefreshed: { const: true, description: 'Reconciliation evidence is authoritative; the current Job or Task was not refreshed. Inspect the Intent again before further actions.' },
        job: schema('IntegrationSorobanJob'),
        task: schema('AgentTask'),
      },
      oneOf: executionOutcomeBranches(),
      allOf: [{ if: { required: ['projectionNotRefreshed'] }, then: { not: { anyOf: [{ required: ['job'] }, { required: ['task'] }] } } }],
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
    ProposalTemplateReferenceInput: {
      type: 'object', required: ['id', 'version'],
      properties: { id: { type: 'string' }, version: { type: 'integer', minimum: 1 }, name: { type: 'string' }, kind: { type: 'string' } },
      additionalProperties: false,
    },
    ProposalTemplatePaymentInput: {
      type: 'object', required: ['template', 'amount'],
      properties: { template: schema('ProposalTemplateReferenceInput'), amount: { type: 'string' }, memo: { type: 'string' } },
      additionalProperties: false,
    },
    ProposalSubmitInput: {
      type: 'object', properties: { acceptedEffectsDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' } }, additionalProperties: false,
    },
    ProposalCreateInput: {
      type: 'object',
      required: ['network'],
      oneOf: [
        { required: ['xdr'] },
        { required: ['templatePayment'] },
        { required: ['payment'], description: 'Semantic Classic payment creation is available to Integration Service callers. For MST-managed semantic execution, runtime capabilities.classicManagedExecution must be true for the selected network. Otherwise prepare an unsigned payment with integration.classic.payment.prepare and create a Request using its xdr, or explicitly configure external execution.' },
      ],
      properties: {
        network: stellarNetwork,
        xdr,
        payment: schema('ClassicPaymentInstructionInput'),
        template: schema('ProposalTemplateReferenceInput'),
        templatePayment: schema('ProposalTemplatePaymentInput'),
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
        { type: 'object', required: ['assignSigner'], properties: { assignSigner: accountId }, additionalProperties: false, 'x-multisig-access': 'human' },
        { type: 'object', required: ['remindSigner'], properties: { remindSigner: accountId }, additionalProperties: false, 'x-multisig-access': 'human' },
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
    SigningRequestSubmission: {
      type: 'object', required: ['transactionHash', 'ledger', 'submittedAt'],
      properties: submissionProperties, additionalProperties: false,
    },
    ClassicExecutionObservation: {
      type: 'object', required: ['transactionHash', 'ledger', 'submittedAt', 'successful'],
      properties: { ...submissionProperties, successful: { type: 'boolean' } }, additionalProperties: false,
    },
    ClassicExecutionNonInclusionProof: {
      type: 'object', required: ['oldestLedger', 'latestLedger', 'oldestLedgerClosedAt', 'latestLedgerClosedAt', 'validAfter', 'validUntil', 'checkedAt'],
      properties: {
        oldestLedger: { type: 'integer', minimum: 1 }, latestLedger: { type: 'integer', minimum: 1 },
        oldestLedgerClosedAt: timestamp, latestLedgerClosedAt: timestamp, validAfter: timestamp, validUntil: timestamp, checkedAt: timestamp,
      },
      description: 'Healthy RPC history starts strictly before the signed lower time bound and extends strictly beyond the signed upper time bound; the subsequent exact hash lookup returned NOT_FOUND.',
      additionalProperties: false,
    },
    ClassicExecutionEvidence: {
      type: 'object', required: ['outcome', 'observed'], properties: classicExecutionEvidenceProperties,
      oneOf: executionOutcomeBranches(), additionalProperties: false,
    },
    ClassicExecutionReconcileResult: {
      type: 'object', required: ['operation', 'version', 'requestId', 'network', 'transactionHash', 'replayed', 'outcome', 'observed'],
      properties: {
        operation: { const: 'integration.request.execution.reconcile' }, version: operationVersion,
        requestId: { type: 'string' }, network: stellarNetwork, transactionHash: submissionProperties.transactionHash,
        replayed: { type: 'boolean' }, ...classicExecutionEvidenceProperties,
      },
      oneOf: executionOutcomeBranches(), additionalProperties: false,
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
        declines: { type: 'array', items: { type: 'object', required: ['signerAddress', 'decidedAt'], properties: { signerAddress: accountId, decidedAt: timestamp }, additionalProperties: false } },
        statusDetail: { type: 'string' },
        creatorAddress: accountId,
        proposerAddress: accountId,
        template: { type: 'object', additionalProperties: true },
        submission: schema('SigningRequestSubmission'),
        executionOutcome: schema('ClassicExecutionEvidence'),
        execution: schema('RequestExecution'),
        sorobanOrigin: schema('SorobanRequestOrigin'),
      },
      allOf: [
        { if: { properties: { status: { const: 'submitted' } } }, then: { required: ['submission'] }, else: { not: { required: ['submission'] } } },
        { if: { required: ['execution'], properties: { execution: { properties: { mode: { const: 'external' } } } } }, then: { required: ['executionOutcome'] } },
        { if: { required: ['executionOutcome'], properties: { executionOutcome: { properties: { outcome: { const: 'successful' } } } } }, then: { properties: { status: { const: 'submitted' } } } },
        { if: { required: ['executionOutcome'], properties: { executionOutcome: { properties: { outcome: { const: 'failed' } } } } }, then: { properties: { status: { const: 'blocked' } } } },
        { if: { required: ['executionOutcome'], properties: { executionOutcome: { properties: { outcome: { const: 'not_included' } } } } }, then: { properties: { status: { const: 'expired' } } } },
        { if: { required: ['executionOutcome'], properties: { status: { const: 'submitted' } } }, then: { properties: { executionOutcome: { properties: { outcome: { const: 'successful' } } } } } },
      ],
      additionalProperties: false,
    },
    ContactDeleteInput: {
      type: 'object', required: ['address', 'subject_type'],
      properties: { address: accountId, subject_type: { type: 'string', enum: ['account', 'signer'] } },
      additionalProperties: false,
    },
    ContactSaveInput: {
      type: 'object', required: ['address', 'subject_type', 'label'],
      properties: {
        address: accountId, subject_type: { type: 'string', enum: ['account', 'signer'] },
        label: { type: 'string', minLength: 1, maxLength: 64 },
        notification_email: { type: ['string', 'null'], maxLength: 254, description: 'Optional private contact metadata. Null or empty clears the email; omit to leave it unchanged.' },
      },
      additionalProperties: false,
    },
    Contact: {
      type: 'object', required: ['address', 'subject_type', 'label', 'created_at', 'updated_at'],
      properties: {
        address: accountId, subject_type: { type: 'string', enum: ['account', 'signer'] },
        label: { type: 'string' }, notification_email: { type: 'string' }, created_at: timestamp, updated_at: timestamp,
      }, additionalProperties: false,
    },
    ContactListResult: { type: 'object', required: ['address', 'entries'], properties: { address: accountId, entries: { type: 'array', items: schema('Contact') } }, additionalProperties: false },
    ContactSaveResult: { type: 'object', required: ['entry'], properties: { entry: schema('Contact') }, additionalProperties: false },
    ContactDeleteResult: { type: 'object', required: ['deleted'], properties: { deleted: { type: 'boolean', const: true } }, additionalProperties: false },
    SignerTreasuriesResult: {
      type: 'object', required: ['principal', 'treasuries'],
      properties: {
        principal: schema('Principal'),
        treasuries: { type: 'array', items: {
          type: 'object', required: ['accountId', 'thresholds', 'signers'],
          properties: {
            accountId, name: { type: 'string' },
            thresholds: { type: 'object', required: ['low', 'medium', 'high'], properties: { low: { type: 'integer' }, medium: { type: 'integer' }, high: { type: 'integer' } } },
            signers: { type: 'array', items: { type: 'object', required: ['key', 'type', 'weight'], properties: { key: { type: 'string' }, type: { type: 'string' }, weight: { type: 'integer' } } } },
          },
        } },
      },
      additionalProperties: false,
    },
    SignerActivityResult: {
      type: 'object', required: ['network', 'actor'],
      properties: {
        address: accountId, network: stellarNetwork, actor: { type: 'string', enum: ['human', 'agent', 'treasury_audit'] }, accountId,
        items: { type: 'array', items: { type: 'object', additionalProperties: true } },
        item: { type: 'object', additionalProperties: true },
        workItems: { type: 'array', items: { type: 'object', additionalProperties: true } },
        nextCursor: { type: 'string' },
      },
      anyOf: [{ required: ['items'] }, { required: ['workItems'] }],
      additionalProperties: false,
    },
    SignerInboxResult: {
      type: 'object',
      required: ['address', 'network', 'actor', 'complete', 'pending_count', 'action_count', 'requests'],
      properties: {
        address: accountId,
        network: stellarNetwork,
        actor: { type: 'string', enum: ['agent', 'human'] },
        complete: { type: 'boolean', description: 'True on the last page of this live enumeration; not a point-in-time ledger snapshot.' },
        nextCursor: { type: 'string', description: 'Present when complete is false. Continue before treating absent tasks as cleared.' },
        pending_count: { type: 'integer', minimum: 0, description: 'Number of returned work items on this page.' },
        action_count: { type: 'integer', minimum: 0, description: 'For Agent callers, the number of tasks on this page with at least one nextAction whose available flag is true.' },
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
        coordination: { type: 'object', additionalProperties: true },
        addedSignatureCount: { type: 'integer', minimum: 0 },
        duplicateSignatureCount: { type: 'integer', minimum: 0 },
        decision: { type: 'string', enum: ['declined'] },
        task: schema('AgentTask'),
      },
      additionalProperties: false,
    },
  },
};

/** Retry policy is deliberately conservative. A transport failure is not
 * evidence that a mutation did not commit. A 409 is not universally retryable. */
function logicalOperationRetry(operation: HeadlessOperationDescriptor): OpenApiObject {
  const { id, effect, path } = operation;
  const replay = ['proposal.create', 'integration.request.create', 'contract.intent.create', 'integration.intent.create'].includes(id);
  const inspectId = operation.access.startsWith('browser:') ? 'integration.intent.browser.inspect'
    : path === '/intent' ? (id.startsWith('integration.') ? 'integration.intent.inspect' : 'contract.intent.inspect')
    : path === '/request' ? (id.startsWith('integration.') ? 'integration.request.inspect' : 'proposal.inspect') : undefined;
  const reconcileId = id.startsWith('integration.') ? 'integration.intent.execution.reconcile' : 'contract.intent.execution.reconcile';
  const rule = (strategy: string, nextOperationIds: string[] = [], condition?: string) =>
    ({ strategy, nextOperationIds, ...(condition ? { condition } : {}) });
  const onError: OpenApiObject = {};
  let transportFailure = effect === 'none' ? rule('retry_same_request')
    : inspectId && operation.access !== 'human' ? rule('inspect_then_decide', [inspectId]) : rule('human_review');
  let idempotencyKey = replay ? 'required' : 'not_used';
  if (replay) {
    transportFailure = rule('retry_same_request', [], 'Same credential, Idempotency-Key and accepted input; never create a replacement to resolve uncertainty.');
    onError.idempotency_conflict = rule('stop', [], 'Do not change the payload or key merely to bypass a conflict.');
  }
  if (id === 'agent.grant.request') {
    transportFailure = rule('start_new_request', [id], 'If no verification URL was delivered, the unapproved request expires. Send only the new approval link.');
  }
  if (id === 'agent.grant.poll') {
    transportFailure = rule('retry_same_request', [id], 'Poll with the same deviceCode at the returned interval. A consumed claim cannot mint again.');
    const recover = rule('human_recovery', ['agent.access.list', 'agent.access.revoke', 'agent.grant.request'],
      'Use details.credentialId to identify the exact reserved credential; check again if issuance is still uncertain. Revoke any issued credential before a fresh Human-approved pairing. No secret is returned again.');
    for (const code of ['already_exchanged', 'exchange_outcome_unknown', 'grant_expired', 'agent_credential_limit_reached', 'agent_credential_conflict', 'agent_pairing_rate_limited']) {
      onError[code] = { ...recover, responseSchema: schema('AgentGrantRecoveryError') };
    }
  }
  if (id === 'agent.grant.approve' || id === 'agent.grant.deny') {
    transportFailure = rule('inspect_then_decide', ['agent.grant.inspect'], 'Read the pairing status before repeating a decision.');
    onError.grant_already_decided = transportFailure;
    onError.grant_expired = rule('stop');
  }
  if (id === 'integration.testnet.create') {
    idempotencyKey = 'unsupported';
    transportFailure = rule('retry_same_request', [id], 'Keep the original serviceId and payload. Atomic create-only: a retry either creates the previously absent profile or returns a conflict, never replaces a credential.');
    onError.integration_service_exists = { ...rule('human_recovery', [], 'No public recovery of an existing secret. For a disposable Testnet profile, obtain approval to use a new unique serviceId; for the existing profile, an authorized operator must rotate its credential.'), responseSchema: schema('TestnetIntegrationExistsError') };
    onError.idempotency_key_unsupported = rule('correct_input', [], 'Do not send Idempotency-Key for this operation.');
  }
  let onOutcome: OpenApiObject | undefined;
  if (id.endsWith('.execution.reconcile')) {
    transportFailure = rule('retry_same_request', [id], 'Reconcile the same transactionHash; outcome unknown is not proof of non-inclusion.');
    onOutcome = {
      unknown: rule('retry_same_request_with_backoff', [id], 'Do not create or sign a replacement while execution remains unknown. Stop automatic polling and escalate for manual reconciliation if bounded retries do not resolve it, or the signed validity window or historical coverage is unavailable.'),
      successful: rule('complete', [], 'Retain the verified ledger receipt. Do not repeat the business payment.'),
      failed: rule('human_review', [], 'The transaction was included but failed. Review the receipt before a separately authorized replacement.'),
      not_included: rule('human_review', [], 'The original validity window is closed and non-inclusion is verified. Review before a separately authorized replacement.'),
    };
    if (path === '/intent') {
      const review = rule('inspect_then_decide', [inspectId!], 'Review the resolved attempt and current Intent before another attempt. Continue only the SAME Intent if all released hashes are resolved, current AUTH and effects allow it, and the caller explicitly decides to retry. Use replan and fresh AUTH when required. Actions marked reviewRequired are technically available, not automatic permission. Never create another business payment to recover this one.');
      onOutcome.failed = review;
      onOutcome.not_included = review;
    }
  }
  if (id.endsWith('.execution.prepare') || id.endsWith('.replan')) {
    onError.intent_execution_outcome_unknown = rule('reconcile_first', [inspectId!, reconcileId], 'Reconcile every unresolvedTransactionHash before creating another execution package or plan.');
    onError.intent_already_executed = rule('inspect_terminal', [inspectId!]);
    onError.intent_execution_effects_reauthorization_required = rule('review_and_reauthorize', [inspectId!, id.startsWith('integration.') ? 'integration.intent.replan' : 'contract.intent.replan']);
    if (!id.startsWith('integration.')) onError.intent_execution_effects_review_required = rule('human_review', [inspectId!], 'Review the exact effects digest before accepting it.');
  }
  if (id === 'agent.access.revoke') transportFailure = rule('inspect_then_decide', ['agent.access.list']);
  if (id === 'agent.access.list') onError.agent_credential_not_found = rule('stop');
  if (path === '/address-book' && effect !== 'none') transportFailure = rule('inspect_then_decide', ['signer.contacts.list']);
  if (path === '/contracts' && effect !== 'none') transportFailure = rule('inspect_then_decide', ['contract.workspace.list']);
  if (effect === 'network-submit') {
    transportFailure = rule(operation.access === 'human' ? 'human_review' : 'inspect_then_decide', operation.access === 'human' ? [] : [inspectId!], 'Check the existing Request and exact Stellar transaction hash; do not create a second payment.');
  }
  const defaultError = rule('stop_and_inspect', inspectId && operation.access !== 'human' ? [inspectId] : []);
  const retryable = transportFailure.strategy === 'retry_same_request';
  const onHttpStatus = {
    '400': rule('correct_input'), '401': rule('authenticate'), '403': rule('stop'),
    '409': defaultError, '410': rule('stop'), '413': rule('correct_input'), '415': rule('correct_input'),
    ...Object.fromEntries(['429', '500', '502', '503', '504'].map((status) => [status, retryable
      ? { ...transportFailure, strategy: 'retry_same_request_with_backoff' } : transportFailure])),
  };
  return { idempotencyKey, transportFailure, onError, onHttpStatus, defaultError, ...(onOutcome ? { onOutcome } : {}) };
}

/** Canonical logical calls, narrower than their shared HTTP transport. Keep
 * the existing paths for generic OpenAPI clients; resolve this table for Agents. */
function logicalOperationContracts(paths: OpenApiObject): OpenApiObject {
  const definitions = components.schemas as Record<string, OpenApiObject>;
  const objectBody = (name: string, keys: string[], required: string[], extra: OpenApiObject = {}) => body({
    type: 'object', required,
    properties: Object.fromEntries(keys.map((key) => [key, (definitions[name].properties as OpenApiObject)[key]])),
    additionalProperties: false, ...extra,
  });
  return Object.fromEntries(HEADLESS_OPERATION_CATALOG.map((operation) => {
    const { id, path, method, access, effect } = operation;
    const transport = (paths[path] as OpenApiObject)[method.toLowerCase()] as OpenApiObject;
    let parameters = ((transport.parameters ?? []) as OpenApiObject[]).filter((p) =>
      (p.name !== 'x-multisig-session-address' || access === 'human')
      && p.name !== 'x-multisig-capability'
      && (p.name !== 'X-MultiSig-Intent-Capability' || access.startsWith('browser:')));
    parameters = parameters.map((p) => ({
      ...p,
      ...((p.name === 'Idempotency-Key' || p.name === 'x-multisig-session-address'
        || p.name === 'X-MultiSig-Intent-Capability'
        || (id === 'signer.auth.challenge' && ['account', 'network'].includes(String(p.name))))
        ? { required: true } : {}),
    }));
    if (access === 'treasury:audit') parameters = parameters.filter((p) => p.name !== 'view');
    let request = transport.requestBody as OpenApiObject | undefined;
    let result: OpenApiObject | undefined;
    let statuses: string[] | undefined;
    let dispatch: OpenApiObject | undefined;
    const security: OpenApiObject[] = access === 'public' ? []
      : access === 'human' ? [{ humanBearer: [] }, { humanSession: [] }]
      : access.startsWith('principal:') ? [{ agentBearer: [] }]
      : access.startsWith('integration:') ? [{ integrationBearer: [] }]
      : access.startsWith('browser:') ? [{ intentCapability: [] }]
      : [{ treasuryAuditBearer: [] }];
    // Principal operations shared with the verified Human session. Treasuries
    // intentionally remain MSA-only. Integration/browser variants stay scoped.
    if (access.startsWith('principal:') && [
      '/intent', '/request', '/contracts', '/inbox', '/address-book', '/activity',
      '/payment-prepare', '/account-create-prepare',
    ].includes(path)) {
      security.push({ humanBearer: [] }, { humanSession: [] });
    }
    const grant = id.startsWith('agent.grant.');
    if (grant) {
      const action = id.split('.').at(-1)!;
      if (action === 'inspect') {
        parameters = parameters.filter((p) => p.name !== 'challenge');
        result = schema('AgentGrantPreview');
      } else if (action === 'challenge') {
        parameters = parameters.map((p) => p.name === 'challenge' ? { ...p, required: true } : p);
        dispatch = { query: { challenge: '1' } };
        result = schema('AgentGrantChallengeResult');
      } else {
        const suffix = action[0].toUpperCase() + action.slice(1);
        request = body(schema('AgentGrant' + suffix + 'Input'));
        dispatch = { body: { action } };
        result = action === 'approve' || action === 'deny'
          ? { type: 'object', required: ['status'], properties: { status: { const: action === 'approve' ? 'approved' : 'denied' } }, additionalProperties: false }
          : schema(action === 'request' ? 'AgentGrantRequestResult' : 'AgentGrantPollResult');
        statuses = [action === 'request' ? '201' : '200'];
      }
    } else if (id === 'signer.auth.challenge') {
      result = schema('SignerAuthChallenge');
    } else if (id === 'signer.auth.status' || id === 'signer.auth.logout') {
      parameters = [];
      security.push({}, { humanBearer: [] }, { humanSession: [] });
      result = schema('SignerAuthStatus');
    } else if (path === '/intent') {
      const integration = access.startsWith('integration:');
      if (method === 'POST') {
        request = objectBody('ContractIntentCreateInput',
          ['network', 'contractId', 'method', 'arguments', 'externalReference', integration ? 'executor' : 'privateNote'],
          ['network', 'contractId', 'method', 'arguments']);
        result = schema('ContractIntentCreateResult');
      } else if (method === 'GET') {
        result = schema(access === 'browser:read' ? 'BrowserAuthorizationInspectResult' : 'ContractIntentInspectResult');
      } else if (method === 'PATCH') {
        result = schema(access === 'browser:sign' ? 'BrowserAuthorizationContributionResult' : 'ContractIntentContributionResult');
      } else if (method === 'PUT') {
        statuses = [id.endsWith('.browser.issue') ? '201' : '200'];
        if (id.endsWith('.execution.prepare')) {
          request = objectBody('ContractIntentExecutionInput', integration
            ? ['action', 'executor'] : ['action', 'executor', 'acceptedEffectsDigest'],
          integration ? ['action'] : ['action', 'executor']);
          dispatch = { body: { action: 'prepare_execution' }, actionValues: ['prepare_execution', 'refresh_execution'] };
          result = schema('ContractIntentExecutionResult');
        } else {
          const branch = id.endsWith('.execution.resume') ? ['ContractIntentExecutionResume', 'resume_execution']
            : id.endsWith('.execution.reconcile') ? ['ContractIntentExecutionReconcile', 'reconcile_execution']
            : id.endsWith('.replan') ? ['ContractIntentReplan', 'replan']
            : id.endsWith('.cancel') ? ['ContractIntentCancel', 'cancel']
            : ['BrowserAuthorizationIssue', 'issue_browser_authorization'];
          request = body(schema(branch[0] + 'Input'));
          result = schema(branch[0] + 'Result');
          dispatch = { body: { action: branch[1] } };
        }
      }
    } else if (path === '/request' && method === 'GET') {
      if (id === 'integration.request.execution.reconcile') {
        parameters = parameters.filter((p) => p.name !== 'view' && p.name !== 'account');
        parameters.push(parameter('view', 'query', true, { const: 'reconciliation' }, 'Verify the exact stored hash of this external Classic Request.'));
        dispatch = { query: { view: 'reconciliation' } };
        result = schema('ClassicExecutionReconcileResult');
      } else {
        parameters = parameters.filter((p) => access !== 'integration:read' || (p.name !== 'view' && p.name !== 'account'))
          .map((p) => p.name === 'view' ? { ...p, schema: { const: 'history' } } : p);
        result = schema('ProposalResult');
      }
    } else if (path === '/request' && method === 'POST') {
      request = access === 'principal:write'
        ? objectBody('ProposalCreateInput', ['network', 'xdr', 'externalReference', 'privateNote'], ['network', 'xdr'])
        : objectBody('ProposalCreateInput', ['network', 'xdr', 'payment', 'externalReference', 'privateCommitment'], ['network'], {
          oneOf: [
            { required: ['xdr'], not: { required: ['payment'] } },
            { required: ['payment'], not: { anyOf: [{ required: ['xdr'] }, { required: ['privateCommitment'] }] } },
          ],
        });
    } else if (path === '/request' && method === 'PATCH') {
      request = body((definitions.ProposalPatchInput.oneOf as OpenApiObject[]).find((item) => item['x-multisig-access'] === access)!);
      if (id === 'proposal.decline') dispatch = { body: { decision: 'decline' } };
      if (id === 'proposal.activity.retain') dispatch = { body: { retainActivity: true } };
    } else if (path === '/request' && method === 'PUT' && access === 'human') {
      request = { ...body({ type: 'object', properties: { acceptedEffectsDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' } }, additionalProperties: false }), required: false };
    }
    const responses = Object.fromEntries(Object.entries(transport.responses as OpenApiObject)
      .filter(([status]) => !status.startsWith('2') || !statuses || statuses.includes(status))
      .map(([status, value]) => [status, status.startsWith('2') && result ? response(status === '201' ? 'Created.' : 'Successful operation.', result) : value]));
    const retry = logicalOperationRetry(operation);
    return [id, { operationId: id, method, path, access, effect, summary: operation.summary, security, parameters,
      ...(request ? { requestBody: request } : {}), ...(dispatch ? { dispatch } : {}), responses, retry }];
  }));
}

// Check closed input objects against the same schema used in the public contract.
// Other validation (including ABI-dependent values) remains in the route/service.
export function unknownRequestField(value: unknown, schemaName: string): string | undefined {
  const schemas = components.schemas as Record<string, OpenApiObject>;
  function resolve(shape: OpenApiObject): OpenApiObject {
    return typeof shape.$ref === 'string' ? schemas[shape.$ref.split('/').at(-1)!] : shape;
  }
  function visit(input: unknown, rawShape: OpenApiObject, path: string): string | undefined {
    const shape = resolve(rawShape);
    if (Array.isArray(input) && shape.items) {
      for (const [index, entry] of input.entries()) {
        const unknown = visit(entry, shape.items as OpenApiObject, path + '[' + index + ']');
        if (unknown) return unknown;
      }
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return;
    const record = input as Record<string, unknown>;
    if (Array.isArray(shape.oneOf) && !shape.properties) {
      const branches = (shape.oneOf as OpenApiObject[]).map(resolve);
      const eligible = branches.filter(branch =>
        Object.entries((branch.properties ?? {}) as Record<string, OpenApiObject>)
          .every(([key, field]) => !Object.hasOwn(record, key) ||
            (field.const === undefined || record[key] === field.const)
              && (!Array.isArray(field.enum) || field.enum.includes(record[key]))));
      // Preserve the route's specific invalid-action/value error when no branch matches.
      if (!eligible.length) return;
      const complete = eligible.filter(branch => ((branch.required ?? []) as string[]).every(key => Object.hasOwn(record, key)));
      const candidates = complete.length ? complete : eligible;
      const errors = candidates.map(branch => visit(input, branch, path));
      return errors.every(Boolean) ? errors[0] : undefined;
    }
    const properties = (shape.properties ?? {}) as Record<string, OpenApiObject>;
    for (const [key, entry] of Object.entries(record)) {
      const fieldPath = path ? path + '.' + key : key;
      if (!Object.hasOwn(properties, key)) {
        if (shape.additionalProperties === false) return fieldPath;
      } else {
        const unknown = visit(entry, properties[key], fieldPath);
        if (unknown) return unknown;
      }
    }
  }
  return visit(value, schemas[schemaName], '');
}

export function createOpenApiDocument(
  origin = '/',
  deploymentNetwork: 'public' | 'testnet' | 'dual' = 'dual',
): OpenApiObject {
  const paths = openApiPaths();
  return {
    openapi: '3.1.1',
    'x-multisig-operations': logicalOperationContracts(paths),
    'x-multisig-deployment-network': deploymentNetwork,
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: 'MultiSigTools Headless Operations',
      version: '1.0.0',
      description: 'Composable Stellar coordination operations for Human, signer Agent, bot, script, wallet, plugin, MCP, CLI, and scoped external-service consumers. Building or preparing XDR never grants signer authority. Signer Agent credentials cannot directly submit. Integration-owned Requests may be automatically submitted at quorum, retried by their Integration, or designated for external execution.',
    },
    servers: [{ url: origin }],
    paths,
    components,
    externalDocs: {
      description: 'MultiSig Tools developer integration and authority guide',
      url: 'https://docs.multisig.tools/stellar/developers',
    },
  };
}
