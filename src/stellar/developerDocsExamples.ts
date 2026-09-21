import { STELLAR_TESTNET_ORIGIN } from './deploymentOrigins';

export const DOCS_SAMPLE_TREASURY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
export const DOCS_SAMPLE_RECIPIENT = 'GDGV7V7UT3XDMQ3COT25VCQNJDW57WYPHSLFSAJEW2LLZDCDREWNAPXO';
export const DOCS_SAMPLE_CONTRACT = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';
export const DOCS_SAMPLE_REQUEST_ID = '0123456789ABCDEF';
export const DOCS_SAMPLE_INTENT_ID = '0123456789ABCDEF';

export const CLASSIC_PAYMENT_EXAMPLE = {
  network: 'testnet' as const,
  payment: {
    sourceAccount: DOCS_SAMPLE_TREASURY,
    payments: [
      {
        destination: DOCS_SAMPLE_RECIPIENT,
        amount: '1',
        asset: { type: 'native' as const },
      },
    ],
    memo: 'Test payment',
  },
  externalReference: 'payroll-test-001',
};

export const SOROBAN_INTENT_EXAMPLE = {
  network: 'testnet' as const,
  contractId: DOCS_SAMPLE_CONTRACT,
  method: 'transfer',
  arguments: {
    from: DOCS_SAMPLE_TREASURY,
    to: DOCS_SAMPLE_RECIPIENT,
    amount: '1',
  },
};

function shellJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .split('\n')
    .map((line) => line.replace(/'/g, "'\\''"))
    .join('\n');
}

export const testnetIntegrationCreateExample = [
  `curl -sS -X POST ${STELLAR_TESTNET_ORIGIN}/api/integration-testnet \\`,
  '  -H "Content-Type: application/json" \\',
  `  -d '${shellJson({
    serviceId: 'my-testnet-app',
    label: 'My Testnet App',
    classicSourceAccounts: [DOCS_SAMPLE_TREASURY],
    classicExternalExecutionSourceAccounts: [],
    sorobanContracts: [],
    sorobanExecutionAccounts: [],
    profile: { authorizationExperience: 'hosted' },
  })}'`,
].join('\n');

export const runtimeConfigExample =
  `curl -sS ${STELLAR_TESTNET_ORIGIN}/api/runtime-config`;

export const classicRequestExample = [
  `curl -sS -X POST ${STELLAR_TESTNET_ORIGIN}/api/request \\`,
  '  -H "Authorization: Bearer $MULTISIG_INTEGRATION_KEY" \\',
  '  -H "Content-Type: application/json" \\',
  '  -H "Idempotency-Key: payroll-test-001" \\',
  `  -d '${shellJson(CLASSIC_PAYMENT_EXAMPLE)}'`,
].join('\n');

export const classicCreateResponseExample = JSON.stringify({
  request: {
    id: DOCS_SAMPLE_REQUEST_ID,
    network: 'testnet',
    status: 'awaiting_signatures',
    execution: { mode: 'multisigtools' },
  },
  replayed: false,
  externalReference: 'payroll-test-001',
}, null, 2);

export const classicHostedReviewExample =
  `${STELLAR_TESTNET_ORIGIN}/s?request=${DOCS_SAMPLE_REQUEST_ID}&network=testnet`;

export const classicStatusExample = [
  `curl -sS ${STELLAR_TESTNET_ORIGIN}/api/request \\`,
  '  -H "Authorization: Bearer $MULTISIG_INTEGRATION_KEY" \\',
  `  -H "X-MultiSig-Request-Id: ${DOCS_SAMPLE_REQUEST_ID}"`,
].join('\n');

export const sorobanIntentExample = [
  `curl -sS -X POST ${STELLAR_TESTNET_ORIGIN}/api/intent \\`,
  '  -H "Authorization: Bearer $MULTISIG_INTEGRATION_KEY" \\',
  '  -H "Content-Type: application/json" \\',
  '  -H "Idempotency-Key: contract-test-001" \\',
  `  -d '${shellJson(SOROBAN_INTENT_EXAMPLE)}'`,
].join('\n');

export const issueBrowserCapabilityExample = [
  `curl -sS -X PUT ${STELLAR_TESTNET_ORIGIN}/api/intent \\`,
  '  -H "Authorization: Bearer $MULTISIG_INTEGRATION_KEY" \\',
  '  -H "Content-Type: application/json" \\',
  `  -H "X-MultiSig-Intent-Id: ${DOCS_SAMPLE_INTENT_ID}" \\`,
  `  -d '{"action":"issue_browser_authorization","signerAddress":"${DOCS_SAMPLE_TREASURY}","origin":"https://app.example"}'`,
].join('\n');

export const browserInspectExample = [
  `curl -sS ${STELLAR_TESTNET_ORIGIN}/api/intent \\`,
  `  -H "X-MultiSig-Intent-Id: ${DOCS_SAMPLE_INTENT_ID}" \\`,
  '  -H "X-MultiSig-Intent-Capability: $MULTISIG_BROWSER_CAPABILITY" \\',
  '  -H "Origin: https://app.example"',
].join('\n');

export const apiDiscoveryExample = [
  `curl -sS ${STELLAR_TESTNET_ORIGIN}/api/operations`,
  `curl -sS ${STELLAR_TESTNET_ORIGIN}/openapi.json`,
].join('\n');

export const agentRequestExample = [
  `curl -sS -X POST ${STELLAR_TESTNET_ORIGIN}/api/request \\`,
  '  -H "Authorization: Bearer $MULTISIG_AGENT_KEY" \\',
  '  -H "Content-Type: application/json" \\',
  '  -H "Idempotency-Key: agent-request-001" \\',
  "  -d '{",
  '    "network": "testnet",',
  '    "xdr": "AAAA...",',
  '    "externalReference": "agent-request-001"',
  "  }'",
].join('\n');

export const agentStatusExample = [
  `curl -sS ${STELLAR_TESTNET_ORIGIN}/api/request \\`,
  '  -H "Authorization: Bearer $MULTISIG_AGENT_KEY" \\',
  `  -H "X-MultiSig-Request-Id: ${DOCS_SAMPLE_REQUEST_ID}"`,
].join('\n');

export const webhookPayloadExample = JSON.stringify({
  schema: 'multisigtools-integration-webhook-v1',
  id: 'evt_example',
  type: 'work.changed',
  createdAt: '2026-09-21T00:00:00.000Z',
  serviceId: 'example-service',
  data: {
    work: {
      kind: 'classic_request',
      id: DOCS_SAMPLE_REQUEST_ID,
      network: 'testnet',
      externalReference: 'payroll-test-001',
    },
    projection: {
      type: 'classic_request',
      request: {
        version: 1,
        id: DOCS_SAMPLE_REQUEST_ID,
        network: 'testnet',
        status: 'awaiting_signatures',
        statusReason: 'threshold_not_met',
      },
    },
  },
}, null, 2);

export const webhookVerifyExample = [
  "import { Webhook } from 'standardwebhooks';",
  '',
  'const rawBody = await request.text();',
  'const headers = {',
  "  'webhook-id': request.headers.get('webhook-id') ?? '',",
  "  'webhook-timestamp': request.headers.get('webhook-timestamp') ?? '',",
  "  'webhook-signature': request.headers.get('webhook-signature') ?? '',",
  '};',
  '',
  'const event = new Webhook(process.env.MULTISIG_WEBHOOK_SECRET!).verify(rawBody, headers);',
  '// Deduplicate event.id, then GET the current Request/Intent before acting.',
].join('\n');

export const apiErrorExample = JSON.stringify({
  error: 'Idempotency-Key header is required for Integration Request creation.',
  code: 'idempotency_key_required',
}, null, 2);

export const COMMON_API_ERRORS = [
  ['400', 'invalid input / missing idempotency key', 'Fix the request; do not blind-retry.'],
  ['401', 'credential missing or invalid', 'Refresh/replace the credential.'],
  ['403', 'credential outside configured scope', 'Change scope or request; retrying unchanged will not help.'],
  ['409', 'idempotency or state/network conflict', 'Read current state, then decide whether to use a new idempotency key.'],
  ['429', 'rate limited', 'Retry with backoff when the deployment has rate limits configured.'],
  ['503', 'dependency or storage unavailable', 'Retry with backoff; inspect current state before recreating work.'],
] as const;
