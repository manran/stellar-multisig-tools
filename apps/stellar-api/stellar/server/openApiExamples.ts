import { HEADLESS_API_REVISION, HEADLESS_OPERATION_CATALOG } from '../../../../packages/stellar-core/src/headlessOperations.js';
import { STELLAR_TESTNET_API_BASE as api, STELLAR_PUBLIC_DOCS_BASE } from '../../../../packages/stellar-core/src/apiOrigins.js';

type Example = Record<string, unknown>;
const network = 'testnet';
const address = 'GB6M5I2JKWBMJ6H6N3WGFE377VVGL4VOQD6PHFRZRA2VXKHZBT5QOP3P';
const destination = 'GDJXYXYMPGVWATWB7KUC6C5KGB3DDUWP76WBPBAL5V4WN6UUR6JKWWXB';
const contractId = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const intentId = '01EXAMP1E0000001';
const requestId = '01EXAMP1E0000002';
const grantId = 'a'.repeat(32);
const transactionHash = 'a'.repeat(64);
const intentDigest = 'b'.repeat(64);
const planDigest = 'c'.repeat(64);
const createdAt = '2026-01-01T00:00:00Z';
const expiresAt = '2026-01-01T01:00:00Z';
const principal = { type: 'signer', network, address };
const hosted = 'https://stellar-testnet.multisig.tools';
const reviewUrl = hosted + '/a#' + intentId;
const xdr = '<prepared envelope XDR>';
const signedXdr = '<signed envelope XDR>';
const authXdr = '<authorization entry XDR>';
const challenge = { entryIndex: 0, authorizer: address, preimageXdr: '<signer AUTH preimage XDR>', expiresAtLedger: 6000000 };
const grant = { requestId: grantId, userCode: 'ABCD-EFGH', label: 'Finance assistant', access: 'read', network, expiresAt, status: 'pending' };
const service = { serviceId: 'example-finance-01', label: 'Example integration', enabled: true, networks: [network] };
const configuration = { ...service, source: 'durable', classicSourceAccounts: [address], classicExternalExecutionSourceAccounts: [], sorobanContracts: [], sorobanExecutionAccounts: [], profile: { version: 1, authorizationExperience: 'hosted' } };
const effects = { version: 1, digest: 'd'.repeat(64), structureDigest: 'e'.repeat(64), stateChangeCount: 0, eventCount: 0, stateChanges: [], events: [], numericEffects: [], truncated: false };
const authorizationPlan = { version: 1, network, intentDigest, authorizationPlanDigest: planDigest, authorizationEntriesXdr: [authXdr], effects, executionBinding: 'detached' };
const intent = { version: 1, id: intentId, network, intent: { version: 1, network, hostFunctionXdr: '<HostFunction XDR>', intentDigest }, authorizationPlan, authorizationPlanRevision: 1, createdAt, discoverySignerKeys: [address] };
const authorizer = { entryIndex: 0, authorizer: address, credentialType: 'address', expirationLedger: 6000000, threshold: 1, signedWeight: 0, signerEvidence: [], activeSigners: [{ publicKey: address, weight: 1 }], ready: false };
const authorization = { id: intentId, network, intentDigest, authorizationPlanDigest: planDigest, executionBinding: 'detached', status: 'awaiting_authorization', authorizationEntriesXdr: [authXdr], contributionCount: 0, authorizers: [authorizer] };
const readyAuthorization = { ...authorization, status: 'authorization_ready', contributionCount: 1, authorizationEntriesXdr: ['<signed authorization entry XDR>'], authorizers: [{ ...authorizer, signedWeight: 1, signerEvidence: [{ publicKey: address, weight: 1 }], ready: true }] };
const browserAuthorization = { version: 1, intentId, network, intentDigest, authorizationPlanDigest: planDigest, authorizationPlanRevision: 1, signerAddress: address, status: authorization.status, expiresAt, challenges: [challenge], hostedReviewUrl: reviewUrl };
const execution = { version: 1, intentId, network, intentDigest, authorizationPlanDigest: planDigest, authorizationPlanRevision: 1, executionSource: address, transactionSequence: '101', transactionHash, validUntil: expiresAt, latestLedger: 5999900, effectsDiff: { version: 1, kind: 'unchanged', severity: 'none', requiresExplicitReview: false, requiresReauthorization: false, expectedDigest: effects.digest, currentDigest: effects.digest, structureChanged: false, maxChangeBasisPoints: 0, numericChanges: [] }, effects, effectsAccepted: false, preparedAt: createdAt, xdr };
const request = { id: requestId, network, transactionHash, baseXdr: xdr, mergedXdr: xdr, createdAt, expiresAt, contributionCount: 0, signatureCount: 0, status: 'awaiting_signatures', statusReason: 'signatures_required' };
const signedRequest = { ...request, mergedXdr: signedXdr, contributionCount: 1, signatureCount: 1, status: 'ready', statusReason: 'authorization_complete' };
const classicJob = { version: 1, id: requestId, kind: 'classic_transaction', network, state: 'waiting_for_authorization', nextActions: [], actionCalls: {}, reviewUrl: hosted + '/s#' + requestId, statusReason: request.statusReason };
const sorobanJob = { version: 1, id: intentId, kind: 'soroban_contract', network, state: 'waiting_for_authorization', nextActions: [], actionCalls: {}, reviewUrl, waitingFor: [address], expiresAtLedger: 6000000 };
const contact = { address: destination, subject_type: 'signer', label: 'Example signer', created_at: createdAt, updated_at: createdAt };
const workspace = { contractId, network, createdAt, updatedAt: createdAt };
const payment = { network, sourceAccount: address, sourceSequence: '100', feeStroops: '100', validUntil: expiresAt, transactionHash, xdr };
const unknown = { transactionHash, replayed: false, outcome: 'unknown', observed: false };
const envelope = (operation: string, data: Example): Example => ({ operation, version: 1, ...data });

// Illustrative structures, not usable credentials, signed envelopes or ledger evidence.
export function logicalResponseExample(id: string, status: string): Example | undefined {
  const replayed = status === '200';
  const integration = id.startsWith('integration.');
  switch (id) {
    case 'discovery.operations.list': return { contract: 'multisig-tools.headless-operations', version: 1, apiVersion: HEADLESS_API_REVISION, base: api, openapi: api + '/openapi.json', documentation: STELLAR_PUBLIC_DOCS_BASE + '/developers', operations: HEADLESS_OPERATION_CATALOG.slice(0, 1).map(op => ({ ...op, schema: { href: api + '/openapi.json', path: op.path, method: op.method, pointer: '#/x-multisig-operations/' + op.id } })) };
    case 'discovery.openapi.read': return { openapi: '3.1.1', info: { title: 'MultiSigTools Headless Operations', version: HEADLESS_API_REVISION }, paths: {}, components: {} };
    case 'runtime.config.inspect': return envelope(id, { stellarNetwork: network, fixedNetwork: network, capabilities: { classicManagedExecution: { public: false, testnet: false }, sorobanManagedExecution: { public: false, testnet: false } } });
    case 'signer.auth.challenge': return { message: '<authentication message>', transaction: '<authentication challenge XDR>', network, network_passphrase: 'Test SDF Network ; September 2015', signing_key: address, unlock_seconds: 3600 };
    case 'signer.auth.status':
    case 'signer.auth.logout': return { unlocked: false, authenticated: false };
    case 'signer.auth.exchange': return { token: '<session bearer token>', address, network, expires_at: 1767229200 };
    case 'agent.grant.inspect': return grant;
    case 'agent.grant.challenge': return { ...grant, message: '<consent message>', transaction: '<consent challenge XDR>', signer: address };
    case 'agent.grant.request': return { ...grant, deviceCode: 'mgd_' + grantId + '_' + 'A'.repeat(43), verificationUri: hosted + '/agent-access?grant=' + grantId, intervalSeconds: 5 };
    case 'agent.grant.poll': return { status: 'authorization_pending' };
    case 'agent.grant.approve': return { status: 'approved' };
    case 'agent.grant.deny': return { status: 'denied' };
    case 'agent.access.list': return { principal, credentials: [] };
    case 'agent.access.revoke': return { principal, credential: { credentialId: 'example-credential', revokedAt: createdAt } };
    case 'integration.testnet.create': return envelope(id, { service, apiKey: 'msi_example_not_a_credential' });
    case 'contract.interface.inspect': {
      const inputs = [['from', 'Address', 'address', 'address'], ['to', 'Address', 'address', 'address'], ['amount', 'I128', 'i128', 'integer']].map(([name, typeLabel, type, kind]) => ({
        name, doc: '', typeLabel, abiType: { kind: 'primitive', name: type }, composition: { mode: 'typed_json', guided: true }, kind,
      }));
      const method = { name: 'transfer', doc: 'Transfer amount from one address to another.', inputs, outputs: [], guided: true };
      return envelope(id, { network, contractId, methods: [method], abi: { schema: 'fresnica-soroban-abi-v1', functions: [{ name: method.name, doc: method.doc, inputs: inputs.map(input => ({ name: input.name, doc: input.doc, type: input.abiType, example: null, composition: input.composition })), outputs: [] }], types: [] } });
    }
    case 'contract.intent.create':
    case 'integration.intent.create': return envelope('contract.intent.create', { intent, authorization, replayed, ...(integration ? { job: sorobanJob } : {}) });
    case 'contract.intent.inspect':
    case 'integration.intent.inspect': return envelope('contract.intent.inspect', { intent, authorization, evidence: [], callSummary: { contractAddress: contractId, functionName: 'transfer', argumentPreviews: [address, destination, '15000000'], nativeXlmTransfer: { from: address, to: destination, amount: '1.5' } }, ...(integration ? { job: sorobanJob } : { challenges: [challenge] }) });
    case 'contract.intent.contribute': return envelope(id, { added: true, authorization: readyAuthorization });
    case 'integration.intent.browser.issue': return envelope(id, { capability: 'mic_example_example', origin: 'https://example.com', browserAuthorization });
    case 'integration.intent.browser.inspect': return envelope(id, { browserAuthorization });
    case 'integration.intent.browser.contribute': return envelope(id, { added: true, browserAuthorization: { ...browserAuthorization, status: 'authorization_ready', challenges: [] } });
    case 'contract.intent.execution.prepare':
    case 'integration.intent.execution.prepare': return envelope('contract.intent.execution.prepare', { execution });
    case 'contract.intent.execution.resume':
    case 'integration.intent.execution.resume': return envelope('contract.intent.execution.resume', { execution });
    case 'contract.intent.execution.reconcile':
    case 'integration.intent.execution.reconcile': return envelope('contract.intent.execution.reconcile', unknown);
    case 'contract.intent.replan':
    case 'integration.intent.replan': {
      const newDigest = 'f'.repeat(64);
      return envelope('contract.intent.replan', { intent: { ...intent, authorizationPlan: { ...authorizationPlan, authorizationPlanDigest: newDigest }, authorizationPlanRevision: 2 }, authorization: { ...authorization, authorizationPlanDigest: newDigest }, previousAuthorizationPlanDigest: planDigest, authorizationPlanRevision: 2 });
    }
    case 'contract.intent.cancel':
    case 'integration.intent.cancel': {
      const cancellation = { version: 1, cancelledAt: createdAt, authorizationPlanDigest: planDigest, authorizationPlanRevision: 1 };
      return envelope('contract.intent.cancel', { replayed: false, intent: { ...intent, cancellation }, authorization: { ...authorization, status: 'cancelled', authorizationEntriesXdr: [] }, cancellation });
    }
    case 'contract.call.build': return envelope(id, { network, transactionSource: address, sourceSequence: '100', contractId, method: 'transfer', xdr: '<unsigned invocation envelope XDR>', validUntil: expiresAt });
    case 'contract.call.prepare': return envelope(id, { mode: 'record', simulation: { endpointUrl: 'https://soroban-testnet.stellar.org', network, transactionHash, latestLedger: 5999900, minResourceFee: '5000', transactionDataXdr: '<Soroban transaction data XDR>', returnValuePreview: null, authorizationEntries: [], effects, eventCount: 0, stateChangeCount: 0, restoreRequired: false, cpuInstructions: null, memoryBytes: null, assembledXdr: xdr } });
    case 'contract.workspace.list': return envelope(id, { principal, contracts: [workspace] });
    case 'contract.workspace.keep': return envelope(id, { principal, contract: workspace });
    case 'contract.workspace.forget': return envelope(id, { principal, contractId, removed: true });
    case 'integration.execution.inspect': return envelope(id, { serviceId: service.serviceId, network, configuration, classic: { scopeConfigured: true, managedAvailable: false, managedSourceAccountCount: 0, externalSourceAccountCount: 0, channelCount: 0, channelSoftLimit: 1, channelAccounts: [] }, soroban: { managedAvailable: false, externalExecutorCount: 0 } });
    case 'classic.payment.prepare':
    case 'integration.classic.payment.prepare': return envelope('classic.payment.prepare', { ...payment, paymentCount: 1 });
    case 'classic.account.create.prepare':
    case 'integration.classic.account.create.prepare': return envelope('classic.account.create.prepare', { ...payment, destination, startingBalance: '5' });
    case 'signer.inbox.list': return { address, network, actor: 'agent', complete: true, pending_count: 0, action_count: 0, signature_required_count: 0, requests: [], intents: [], tasks: [] };
    case 'signer.contacts.list': return { address, entries: [contact] };
    case 'signer.contacts.save': return { entry: contact };
    case 'signer.contacts.delete': return { deleted: true };
    case 'signer.treasuries.list': return { principal, treasuries: [] };
    case 'signer.activity.list': return { network, actor: 'agent', address, workItems: [] };
    case 'treasury.audit.activity.list': return { network, actor: 'treasury_audit', accountId: address, items: [] };
    case 'proposal.create':
    case 'integration.request.create': return { request, replayed, ...(integration ? { job: classicJob } : {}) };
    case 'proposal.inspect':
    case 'proposal.activity.retain':
    case 'integration.request.inspect': return { request, ...(integration ? { job: classicJob } : {}) };
    case 'proposal.contribute': return { request: signedRequest, addedSignatureCount: 1, duplicateSignatureCount: 0 };
    case 'proposal.decline': return { request: { ...request, declines: [{ signerAddress: address, decidedAt: createdAt }] }, decision: 'declined' };
    case 'proposal.submit':
    case 'integration.request.submit': return { request: { ...signedRequest, status: 'submitted', statusReason: 'ledger_confirmed', submission: { transactionHash, ledger: 5999900, submittedAt: createdAt } } };
    case 'integration.request.execution.reconcile': return envelope(id, { requestId, network, ...unknown });
    default: return undefined;
  }
}

export function logicalParameterExample(parameter: Example): unknown {
  const schema = parameter.schema as Example;
  if (schema?.const !== undefined) return schema.const;
  switch (parameter.name) {
    case 'account':
    case 'x-multisig-session-address': return address;
    case 'network': return network;
    case 'Origin': return 'https://example.com';
    case 'contract': return contractId;
    case 'id': return grantId;
    case 'request':
    case 'x-multisig-request-id': return requestId;
    case 'X-MultiSig-Intent-Id': return intentId;
    case 'X-MultiSig-Intent-Capability': return 'mic_example_example';
    case 'x-multisig-capability': return '<Request capability>';
    case 'Idempotency-Key': return 'example-transfer-01';
    case 'limit': return 20;
    case 'unlock_seconds': return 3600;
    case 'cursor': return '<previous nextCursor>';
    default: return undefined;
  }
}
