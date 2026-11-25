#!/usr/bin/env node
// Explicit opt-in Testnet smoke: one ephemeral account, one durable Request,
// two independently signed contributions, and one real Stellar transaction.
// No saved keys, email invitations, Mainnet calls, or production credentials.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Account, BASE_FEE, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

const TESTNET_API = 'https://api-testnet.multisig.tools/stellar';
let API = TESTNET_API;
const HORIZON = 'https://horizon-testnet.stellar.org';
const FAUCET = 'https://friendbot.stellar.org';
const LIVE = process.argv.includes('--live');
const AGENT = process.argv.includes('--agent');
const COORDINATION = process.argv.includes('--coordination');
const PROPOSER = process.argv.includes('--proposer');
const INTEGRATION = process.argv.includes('--integration');
const EXTERNAL = process.argv.includes('--external');
const ALLOW_UNDISCOVERED_INBOX = process.argv.includes('--allow-undiscovered-inbox');
const now = () => new Date().toISOString();
const trace = [];
function record(step, extra = {}) {
  trace.push({ step, at: now(), ...extra });
  console.log('PASS ' + step);
}
function check(test, description) { assert.ok(test, description); }
async function readJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; }
  catch { throw new Error('Non-JSON HTTP ' + response.status + ' from ' + new URL(response.url).pathname); }
}
async function call(path, method = 'GET', payload, headers = {}, expect = 200) {
  const response = await fetch(API + path, {
    method,
    headers: {
      Accept: 'application/json',
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(30000),
  });
  const body = await readJson(response);
  if (response.status !== expect) {
    throw new Error(method + ' ' + path + ': HTTP ' + response.status +
      ' [' + (body.code ?? 'no_code') + '] ' + (body.error ?? ''));
  }
  return body;
}
async function horizon(path, init) {
  const response = await fetch(HORIZON + path, { ...init, signal: AbortSignal.timeout(30000) });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error('Horizon ' + path.split('?')[0] + ': HTTP ' + response.status +
      ' ' + (body.title ?? ''));
  }
  return body;
}
async function fund(address) {
  const response = await fetch(FAUCET + '/?addr=' + encodeURIComponent(address),
    { signal: AbortSignal.timeout(30000) });
  const body = await readJson(response);
  if (!response.ok) throw new Error('Testnet Friendbot: HTTP ' + response.status +
    ' ' + (body.detail ?? body.title ?? ''));
}
async function submitXdr(xdr) {
  return horizon('/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ tx: xdr }),
  });
}
async function unlock(signer, authPath = '/auth') {
  const challenge = await call(authPath + '?account=' + encodeURIComponent(signer.publicKey()) + '&network=testnet&unlock_seconds=3600');
  const tx = TransactionBuilder.fromXdr(challenge.transaction, Networks.TESTNET);
  check(tx.source === challenge.signing_key, 'Challenge source is not the server');
  check(tx.operations[0]?.source === signer.publicKey(), 'Challenge signer mismatch');
  tx.sign(signer);
  const session = await call('/auth', 'POST', { transaction: tx.toXdr(), network: 'testnet' });
  check(session.address === signer.publicKey() && session.network === 'testnet', 'Unlock identity mismatch');
  check(typeof session.token === 'string' && session.token.split('.').length === 3, 'Missing session token');
  return session.token; // Never log or persist.
}
function humanHeaders(address, token) {
  return { Authorization: 'Bearer ' + token, 'x-multisig-session-address': address };
}
function cookieHeaders(token) { return { Cookie: 'mst_auth=' + encodeURIComponent(token) }; }
function requestHeaders(id, capability, extra = {}) {
  return { 'x-multisig-request-id': id, ...(capability ? { 'x-multisig-capability': capability } : {}), ...extra };
}

async function pairAgent(bob, label, grantPath = '/agent-grants', authPath = '/auth', access = 'sign') {
    const bobToken = await unlock(bob, authPath);
    const signerHeaders = humanHeaders(bob.publicKey(), bobToken);
    const grant = await call(grantPath, 'POST', {
      action: 'request', label, access, network: 'testnet',
    }, {}, 201);
    check(grant.verificationUri === 'https://stellar-testnet.multisig.tools/agent-access?grant=' + grant.requestId
      && typeof grant.deviceCode === 'string' && grant.deviceCode.startsWith('mgd_'), 'Invalid pairing response');
    const poll = { action: 'poll', deviceCode: grant.deviceCode };
    const pending = await call(grantPath, 'POST', poll);
    check(pending.status === 'authorization_pending' && !pending.apiKey, 'Credential issued before wallet approval');
    record('agent-public-pairing-pending');
    const unsignedApproval = await call(grantPath, 'POST', {
      action: 'approve', requestId: grant.requestId,
    }, signerHeaders, 403);
    check(unsignedApproval.code === 'approval_signature_required', 'Login session bypassed fresh approval');
    record('agent-session-only-approval-denied');
    const challenge = await call(grantPath + '?id=' + grant.requestId + '&challenge=1', 'GET', undefined, signerHeaders);
    check(challenge.signer === bob.publicKey() && challenge.access === access
      && challenge.message.includes(grant.userCode), 'Pairing challenge does not match Agent request');
    const approval = TransactionBuilder.fromXdr(challenge.transaction, Networks.TESTNET);
    check(approval.operations[0]?.source === bob.publicKey(), 'Pairing approval signer mismatch');
    approval.sign(bob);
    const approved = await call(grantPath, 'POST', {
      action: 'approve', requestId: grant.requestId, mode: 'transaction', transaction: approval.toXDR(),
    }, signerHeaders);
    check(approved.status === 'approved' && !approved.apiKey, 'Human approval exposed Agent credential');
    record('agent-fresh-wallet-approval');
    const agent = await call(grantPath, 'POST', poll);
    check(agent.status === 'approved' && typeof agent.apiKey === 'string'
      && agent.apiKey.startsWith('msa_') && agent.credential?.access === access,
      'Agent credential was not issued');
    const replay = await call(grantPath, 'POST', poll, {}, 409);
    check(replay.code === 'already_exchanged' && !replay.apiKey
      && replay.details?.credentialId === agent.credential.credentialId
      && replay.details?.recoveryOperations?.includes('agent.access.revoke'), 'Device code recovery was ambiguous or reusable');
    record('agent-single-use-credential-exchange');
    return { agent, bobToken };
}

/** Dedicated authorized non-signer G-wallet Testnet lifecycle. New disposable keys
 * only. Never persist sessions/seeds. Uses a funded 2-of-3 account to pay itself. */
async function proposerE2E() {
  const alice = Keypair.random();
  const bob = Keypair.random();
  const carol = Keypair.random();
  const finance = Keypair.random();
  const source = alice.publicKey();
  await fund(source);
  const funded = await horizon('/accounts/' + source);
  const setup = new TransactionBuilder(new Account(source, funded.sequence), {
    fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: bob.publicKey(), weight: 1 } }))
    .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: carol.publicKey(), weight: 1 } }))
    .addOperation(Operation.setOptions({ masterWeight: 1, lowThreshold: 2, medThreshold: 2, highThreshold: 2 }))
    .setTimeout(120).build();
  setup.sign(alice);
  check((await submitXdr(setup.toXdr())).successful, 'Unable to create temporary Testnet Treasury');
  record('proposer-temporary-2-of-3-treasury', { account: source });

  const ownerToken = await unlock(alice);
  const financeToken = await unlock(finance);
  const ownerHeaders = { ...cookieHeaders(ownerToken), 'x-multisig-session-address': source };
  const financeHeaders = { ...cookieHeaders(financeToken), 'x-multisig-session-address': finance.publicKey() };
  record('unfunded-nonsigner-wallet-unlocked');
  // Build an intentionally fixed same-account payment: no third-party value transfer.
  const templateCreated = await call('/templates', 'POST', {
    network: 'testnet', name: 'Testnet delegated QA', kind: 'payment',
    definition: {
      version: 1, source, recipients: [{ destination: source, assetKey: 'native' }],
      signingWindowSeconds: 3600,
    },
  }, ownerHeaders, 201);
  const id = templateCreated.template?.id;
  check(typeof id === 'string' && templateCreated.template.definition.source === source,
    'Treasury signer could not create reusable payment Template');
  record('treasury-signer-template-created');
  const reference = { id, version: 1 };
  const noGrant = await call('/request', 'POST', {
    network: 'testnet', templatePayment: { template: reference, amount: '1', memo: 'MST-TPL-QA' },
  }, financeHeaders, 403);
  check(noGrant.code === 'template_proposer_not_authorized', 'Unapproved non-signer can create Request');
  record('unapproved-proposer-blocked');

  const granted = await call('/templates', 'PATCH', {
    network: 'testnet', templateId: id, proposerAddress: finance.publicKey(), action: 'grant',
  }, ownerHeaders);
  check(granted.proposerAddresses?.includes(finance.publicKey()), 'Template grant not persisted');
  const visible = await call('/templates?network=testnet', 'GET', undefined, financeHeaders);
  check(visible.templates?.some((item) => item.id === id && item.ownerAddress === source
    && !item.proposerAddresses), 'Delegated wallet cannot see its Template or can see unrelated grants');
  record('nonsigner-wallet-received-template-grant');

  const invalid = await call('/request', 'POST', {
    network: 'testnet', templatePayment: {
      template: reference, amount: '1', memo: 'MST-TPL-QA', destination: bob.publicKey(),
    },
  }, financeHeaders, 400);
  check(invalid.code === 'invalid_template_payment', 'Delegated wallet modified fixed destination');
  record('arbitrary-payment-overrides-denied');

  const created = await call('/request', 'POST', {
    network: 'testnet', templatePayment: { template: reference, amount: '1', memo: 'MST-TPL-QA' },
  }, financeHeaders, 201);
  const requestId = created.request?.id;
  check(typeof requestId === 'string' && created.request.proposerAddress === finance.publicKey()
    && !created.request.creatorAddress && !created.capability,
  'Request incorrectly treats non-signer as signer or mints a bearer capability');
  const unsignedXdr = created.request.baseXdr;
  const unsigned = TransactionBuilder.fromXdr(unsignedXdr, Networks.TESTNET);
  check(unsigned.source === source && unsigned.signatures.length === 0
    && unsigned.operations.length === 1 && unsigned.operations[0].type === 'payment'
    && unsigned.operations[0].destination === source,
  'Server changed fixed source, recipient or delegated authorization boundary');
  record('unfunded-proposer-created-immutable-payment-request', { requestId });
  const requestFinanceHeaders = requestHeaders(requestId, '', financeHeaders);
  const own = await call('/request', 'GET', undefined, requestFinanceHeaders);
  check(own.request?.id === requestId && own.request.proposerAddress === finance.publicKey(),
    'Proposer cannot read their own active Request');
  const financeInbox = await call('/inbox', 'GET', undefined, financeHeaders);
  check(financeInbox.requests?.some((item) => item.id === requestId && item.viewerAction === 'proposer_waiting'),
    'Unfunded proposer Request absent from personal Inbox');
  record('proposer-inbox-without-signer-task');
  const unauthorizedSigned = TransactionBuilder.fromXdr(unsignedXdr, Networks.TESTNET);
  unauthorizedSigned.sign(bob);
  const deniedSignature = await call('/request', 'PATCH', {
    signedXdr: unauthorizedSigned.toXdr(),
  }, requestFinanceHeaders, 403);
  check(deniedSignature.code === 'proposer_signature_denied', 'Proposer bypassed signature contribution control');
  const deniedSubmit = await call('/request', 'PUT', {}, requestFinanceHeaders, 403);
  check(deniedSubmit.code === 'proposer_submit_denied', 'Proposer bypassed API submission permission');
  record('proposer-sign-and-submit-denied');

  const asked = await call('/request', 'PATCH', { assignSigner: bob.publicKey() }, requestFinanceHeaders);
  check(asked.assignment?.assignedByAddress === finance.publicKey()
    && asked.notification?.status === 'no_contact_email', 'Proposer Ask did not retain attribution');
  record('proposer-requested-treasury-signature-without-email');

  const revoked = await call('/templates', 'PATCH', {
    network: 'testnet', templateId: id, proposerAddress: finance.publicKey(), action: 'revoke',
  }, ownerHeaders);
  check(!revoked.proposerAddresses?.includes(finance.publicKey()), 'Revocation not retained');
  const revokedCreate = await call('/request', 'POST', {
    network: 'testnet', templatePayment: { template: reference, amount: '1', memo: 'MST-TPL-QA' },
  }, financeHeaders, 403);
  check(revokedCreate.code === 'template_proposer_not_authorized', 'Revoked proposer still creates Request');
  const revokedAsk = await call('/request', 'PATCH', {
    assignSigner: carol.publicKey(),
  }, requestFinanceHeaders, 403);
  check(revokedAsk.code === 'template_proposer_not_authorized', 'Revoked proposer still sends Ask');
  check((await call('/request', 'GET', undefined, requestFinanceHeaders)).request.id === requestId,
    'Revocation erased previously created Request');
  record('revoked-proposer-still-sees-old-request');

  const aliceSigned = TransactionBuilder.fromXdr(unsignedXdr, Networks.TESTNET);
  aliceSigned.sign(alice);
  const ownerContribution = await call('/request', 'PATCH', { signedXdr: aliceSigned.toXdr() },
    requestHeaders(requestId, '', ownerHeaders));
  check(ownerContribution.addedSignatureCount === 1, 'Current Treasury signer contribution rejected');
  const bobToken = await unlock(bob);
  const bobSigned = TransactionBuilder.fromXdr(unsignedXdr, Networks.TESTNET);
  bobSigned.sign(bob);
  const bobContribution = await call('/request', 'PATCH', { signedXdr: bobSigned.toXdr() },
    requestHeaders(requestId, '', { ...cookieHeaders(bobToken), 'x-multisig-session-address': bob.publicKey() }));
  check(bobContribution.request.status === 'ready', 'Both Treasury signatures did not authorize payment');
  const submitted = await call('/request', 'PUT', {}, requestHeaders(requestId, '', ownerHeaders));
  const txHash = submitted.request?.submission?.transactionHash;
  check(submitted.request?.status === 'submitted' && typeof txHash === 'string',
    'A current Treasury signer could not submit the Request');
  const chain = await horizon('/transactions/' + txHash);
  check(chain.successful && chain.hash === txHash, 'No matching successful Testnet ledger transaction');
  record('treasury-signers-confirmed-payment-on-ledger', { ledger: chain.ledger });
  const history = await call('/request?view=history', 'GET', undefined, requestFinanceHeaders);
  check(history.request?.status === 'submitted', 'Proposer lost closed Request history');
  const activity = await call('/activity?request=' + encodeURIComponent(requestId), 'GET', undefined, financeHeaders);
  check(activity.item, 'Proposer cannot view completed Activity');
  record('proposer-retained-transaction-receipt');
  console.log('LIVE TEMPLATE PROPOSER TESTNET E2E PASSED');
  console.log(JSON.stringify({ requestId, ledger: chain.ledger, transactionHash: chain.hash,
    proposerFunded: false, evidence: trace }, null, 2));
}

// Discover business operations from the published service contract. A fixed
// Testnet origin is a safety boundary, not a source of operation paths.
async function discoverIntegration() {
  const site = new URL(process.argv.find((arg) => arg.startsWith('https://'))
    || 'https://stellar-testnet.multisig.tools/');
  const htmlResponse = await fetch(site, { signal: AbortSignal.timeout(20000) });
  check(htmlResponse.ok, 'Cannot load public MST website');
  const html = await htmlResponse.text();
  const link = html.match(/<link\s+rel="api-catalog"\s+href="([^"]+)"/);
  check(link, 'Website does not advertise an API catalog');
  const catalogUrl = new URL(link[1], site);
  check(catalogUrl.protocol === 'https:', 'Catalog must use HTTPS');
  const catalogResponse = await fetch(catalogUrl, { signal: AbortSignal.timeout(20000) });
  check(catalogResponse.ok, 'Cannot load API catalog');
  const catalog = await readJson(catalogResponse);
  const entry = catalog.linkset?.find((item) => item.anchor === TESTNET_API);
  check(entry, 'No catalog entry for the isolated Testnet deployment');
  const registryUrl = new URL(entry['service-meta'][0].href);
  const openApiUrl = new URL(entry['service-desc'][0].href);
  for (const url of [registryUrl, openApiUrl]) {
    check(url.href.startsWith(TESTNET_API + '/'), 'Unexpected API documentation origin');
  }
  const [registryResponse, openApiResponse] = await Promise.all([
    fetch(registryUrl, { signal: AbortSignal.timeout(20000) }),
    fetch(openApiUrl, { signal: AbortSignal.timeout(20000) }),
  ]);
  check(registryResponse.ok && openApiResponse.ok, 'Cannot load operation registry or OpenAPI');
  const [registry, openapi] = await Promise.all([readJson(registryResponse), readJson(openApiResponse)]);
  check(registry.base === TESTNET_API && openapi.servers?.[0]?.url === TESTNET_API
    && openapi['x-multisig-deployment-network'] === 'testnet', 'Discovery network mismatch');
  API = registry.base;
  for (const item of registry.operations) {
    const pointer = item.schema?.pointer;
    check(item.schema?.href === openApiUrl && pointer?.startsWith('#/x-multisig-operations/'), 'Missing logical operation pointer: ' + item.id);
    const logical = pointer.slice(2).split('/').reduce((value, key) => value?.[key], openapi);
    check(logical?.operationId === item.id && logical.path === item.path && logical.method === item.method
      && logical.access === item.access && logical.retry?.transportFailure?.strategy, 'Unresolvable logical operation: ' + item.id);
  }
  record('public-logical-operation-contracts-resolve', { count: registry.operations.length });
  const operation = (id, access, effect) => {
    const item = registry.operations.find((candidate) => candidate.id === id);
    check(item && item.access === access && item.effect === effect
      && item.path.startsWith('/') && !item.path.startsWith('//')
      && openapi.paths?.[item.path]?.[item.method.toLowerCase()]?.['x-multisig-operation-ids']?.includes(id),
    'Missing or inconsistent published operation: ' + id);
    return item;
  };
  const runtime = await call(operation('runtime.config.inspect', 'public', 'none').path);
  check(runtime.fixedNetwork === 'testnet', 'Refusing non-Testnet deployment');
  const create = operation('integration.testnet.create', 'public', 'private-state');
  const prepare = operation('integration.classic.payment.prepare', 'integration:write', 'none');
  const request = operation('integration.request.create', 'integration:write', 'coordination-state');
  const inspect = operation('integration.request.inspect', 'integration:read', 'none');
  const submit = operation('integration.request.submit', 'integration:write', 'network-submit');
  const auth = operation('signer.auth.challenge', 'public', 'none');
  const exchange = operation('signer.auth.exchange', 'public', 'private-state');
  check(auth.path === exchange.path, 'Signer auth transport differs');
  const grantChallenge = operation('agent.grant.challenge', 'human', 'none');
  const revoke = operation('agent.access.revoke', 'human', 'private-state');
  const pair = operation('agent.grant.request', 'public', 'private-state');
  const poll = operation('agent.grant.poll', 'public', 'private-state');
  const approve = operation('agent.grant.approve', 'human', 'private-state');
  check(pair.path === poll.path && pair.path === approve.path && pair.path === grantChallenge.path, 'Pairing transport differs');
  const contribute = operation('proposal.contribute', 'principal:sign', 'coordination-state');
  let inbox;
  if (ALLOW_UNDISCOVERED_INBOX && !registry.operations.some((item) => item.id === 'signer.inbox.list')) {
    // Explicit compatibility mode for the already deployed API while the
    // discovery fix is awaiting deployment. Not a successful blind test.
    console.log('GAP signer.inbox.list is missing from deployed discovery; using known Inbox path');
    inbox = { path: '/inbox', method: 'GET' };
  } else {
    inbox = operation('signer.inbox.list', 'principal:read', 'none');
  }
  record('public-msi-msa-operation-discovery', { strict: !ALLOW_UNDISCOVERED_INBOX });
  return { runtime, create, prepare, request, inspect, submit, pair, contribute, inbox, auth, revoke };
}

async function integrationE2E() {
  const ops = await discoverIntegration();
  if (!LIVE) {
    console.log('READ-ONLY integration discovery passed');
    return;
  }
  const alice = Keypair.random();
  const bob = Keypair.random();
  const carol = Keypair.random();
  const source = alice.publicKey();
  await fund(source);
  const account = await horizon('/accounts/' + source);
  const setup = new TransactionBuilder(new Account(source, account.sequence), {
    fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: bob.publicKey(), weight: 1 } }))
    .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: carol.publicKey(), weight: 1 } }))
    .addOperation(Operation.setOptions({ masterWeight: 1, lowThreshold: 2, medThreshold: 2, highThreshold: 2 }))
    .setTimeout(120).build();
  setup.sign(alice);
  check((await submitXdr(setup.toXDR())).successful, 'Disposable Treasury setup failed');
  record('integration-disposable-testnet-treasury', { account: source });

  const serviceId = 'agent-qa-' + randomBytes(6).toString('hex');
  const profileInput = {
    serviceId, label: 'Agent collaboration QA', classicSourceAccounts: [source],
    ...(EXTERNAL ? { classicExternalExecutionSourceAccounts: [source] } : {}),
    profile: { authorizationExperience: 'hosted' },
  };
  const integration = await call(ops.create.path, ops.create.method, profileInput, {}, 201);
  const duplicate = await call(ops.create.path, ops.create.method, profileInput, {}, 409);
  check(duplicate.code === 'integration_service_exists' && !duplicate.apiKey
    && duplicate.details?.serviceId === serviceId
    && duplicate.details?.recovery === 'new_service_id_or_authorized_operator_rotation', 'Profile retry did not fail closed');
  record('msi-self-service-retry-create-only');
  const unsupportedIdempotency = await call(ops.create.path, ops.create.method, profileInput, { 'Idempotency-Key': 'unsupported' }, 400);
  check(unsupportedIdempotency.code === 'idempotency_key_unsupported', 'Profile incorrectly accepted a generic idempotency key');
  record('msi-profile-idempotency-boundary');
  check(integration.apiKey?.startsWith('msi_') && integration.service?.serviceId === serviceId
    && integration.service.networks?.length === 1 && integration.service.networks[0] === 'testnet',
  'Testnet Integration credential not issued');
  const serviceHeaders = { Authorization: 'Bearer ' + integration.apiKey };
  record('msi-self-service-issued', { serviceId });

  const payment = { sourceAccount: source, payments: [{
    destination: source, amount: '1', asset: { type: 'native' },
  }], memo: 'Agent collaboration QA', lifetimeSeconds: 3600 };
  const scopeDenied = await call(ops.prepare.path, ops.prepare.method, {
    ...payment, network: 'testnet', sourceAccount: bob.publicKey(),
  }, serviceHeaders, 403);
  check(scopeDenied.code === 'integration_classic_source_account_not_allowed', 'MSI escaped source scope');
  record('msi-out-of-scope-payment-denied');

  let input;
  if (!EXTERNAL && ops.runtime.capabilities?.classicManagedExecution?.testnet === true) {
    input = { network: 'testnet', payment };
    record('semantic-managed-payment-selected');
  } else {
    const prepared = await call(ops.prepare.path, ops.prepare.method, {
      ...payment, network: 'testnet',
    }, serviceHeaders);
    check(prepared.xdr && prepared.network === 'testnet', 'Prepared payment missing');
    input = { network: 'testnet', xdr: prepared.xdr };
    record('prepared-xdr-fallback-selected');
  }
  const idempotencyHeaders = { ...serviceHeaders, 'Idempotency-Key': serviceId + '-payment' };
  const created = await call(ops.request.path, ops.request.method, input, idempotencyHeaders, 201);
  const requestId = created.request?.id;
  check(requestId && created.request.status === 'awaiting_signatures', 'MSI could not create payment Request');
  const replay = await call(ops.request.path, ops.request.method, input, idempotencyHeaders);
  check(replay.request?.id === requestId && replay.replayed === true, 'MSI replay created another Request');
  record('msi-idempotent-payment-created', { requestId });

  const paired = [];
  try {
    const signerAgents = [
      { signer: bob, label: 'QA signer Bob' },
      { signer: carol, label: 'QA signer Carol' },
    ];
    for (const item of signerAgents) {
      const pair = await pairAgent(item.signer, item.label, ops.pair.path, ops.auth.path);
      paired.push({ ...item, ...pair });
    }
    // A separate, least-privilege personal Agent represents Bob, but may only notify him.
    const monitor = await pairAgent(bob, 'QA personal Inbox monitor', ops.pair.path, ops.auth.path, 'read');
    paired.push({ signer: bob, ...monitor });
    const monitorHeaders = { Authorization: 'Bearer ' + monitor.agent.apiKey };
    const monitorInbox = await call(ops.inbox.path, ops.inbox.method, undefined, monitorHeaders);
    const pendingSignature = monitorInbox.tasks?.find((task) => task.signatureRequired);
    check(monitorInbox.address === bob.publicKey() && monitorInbox.signature_required_count === 1 && monitorInbox.action_count === 0
      && pendingSignature?.id === requestId && pendingSignature.state === 'waiting'
      && pendingSignature.nextActions.every((action) => !action.available), 'Read Agent cannot distinguish pending signature from executable actions');
    const monitorRequest = await call(ops.inspect.path, ops.inspect.method, undefined, requestHeaders(pendingSignature.id, '', monitorHeaders));
    check(monitorRequest.task?.signatureRequired === true && monitorRequest.task.state === 'waiting', 'Read Agent Request projection disagrees with Inbox');
    record('msa-read-monitor-discovers-signature-without-action');
    const inboxDenied = await call(ops.inbox.path, ops.inbox.method, undefined, serviceHeaders, 401);
    check(inboxDenied.code === 'invalid_agent_credential', 'MSI acquired signer Inbox access');
    record('msi-signer-inbox-denied');

    let final;
    for (const [index, item] of paired.filter((item) => item.agent.credential.access === 'sign').entries()) {
      const agentHeaders = { Authorization: 'Bearer ' + item.agent.apiKey };
      const inbox = await call(ops.inbox.path, ops.inbox.method, undefined, agentHeaders);
      const discovered = inbox.tasks?.find((task) => task.id === requestId);
      check(inbox.address === item.signer.publicKey() && inbox.actor === 'agent'
        && inbox.signature_required_count === 1 && inbox.action_count === 1
        && discovered?.state === 'action_required' && discovered.signatureRequired === true
        && discovered.nextActions?.some((action) => action.code === 'contribute_signature' && action.operationId === 'proposal.contribute' && action.available),
      'Signer Agent did not independently discover payment task');
      record('msa-inbox-task-discovered', { signer: index + 1 });
      const headers = requestHeaders(discovered.id, '', agentHeaders);
      const current = await call(ops.inspect.path, ops.inspect.method, undefined, headers);
      const tx = TransactionBuilder.fromXdr(current.request.baseXdr, Networks.TESTNET);
      const op = tx.operations[0];
      check(tx.operations.length === 1 && op.type === 'payment' && (op.source || tx.source) === source
        && op.destination === source && Number(op.amount) === 1 && op.asset.isNative(),
      'Wallet review does not match authorized disposable payment');
      check(Buffer.from(tx.hash()).toString('hex') === created.request.transactionHash, 'Request transaction changed');
      if (index === 0) {
        const deniedSubmit = await call(ops.submit.path, ops.submit.method, {}, headers, EXTERNAL ? 409 : 403);
        check(deniedSubmit.code === (EXTERNAL ? 'external_executor_required' : 'agent_submit_denied'), 'MSA escaped submission boundary');
        record('msa-direct-submit-denied');
      }
      tx.sign(item.signer);
      if (index === 0) {
        const monitorDenied = await call(ops.contribute.path, ops.contribute.method, { signedXdr: tx.toXDR() }, requestHeaders(requestId, '', monitorHeaders), 403);
        check(monitorDenied.code === 'agent_access_denied', 'Read Agent acquired signature contribution authority');
        record('msa-read-monitor-signature-contribution-denied');
        const deniedContribution = await call(ops.contribute.path, ops.contribute.method,
          { signedXdr: tx.toXDR() }, requestHeaders(requestId, '', serviceHeaders), 403);
        check(deniedContribution.code === 'integration_request_write_denied', 'MSI acquired signer contribution authority');
        record('msi-signature-contribution-denied');
      }
      final = await call(ops.contribute.path, ops.contribute.method, { signedXdr: tx.toXDR() }, headers);
      check(final.addedSignatureCount === 1, 'Verified signer contribution rejected');
      if (index === 0) {
        check(final.request.status === 'awaiting_signatures', 'Payment executed before quorum');
        const refreshed = await call(ops.inbox.path, ops.inbox.method, undefined, monitorHeaders);
        const signedTask = refreshed.tasks?.find((task) => task.id === requestId);
        check(refreshed.signature_required_count === 0 && refreshed.action_count === 0 && signedTask?.signatureRequired === false
          && signedTask.state === 'waiting', 'Read Agent still sees pending signature after its human signed');
        record('msa-read-monitor-clears-reminder-after-signature');
      }
      record('msa-wallet-signature-contributed', { signer: index + 1 });
    }
    if (EXTERNAL) {
      check(final.request.status === 'ready', 'External Request did not stay ready at quorum');
      const refused = await call(ops.submit.path, ops.submit.method, {}, requestHeaders(requestId, '', serviceHeaders), 409);
      check(refused.code === 'external_executor_required', 'MST attempted to submit externally owned Request');
      const externalReceipt = await submitXdr(final.request.mergedXdr);
      check(externalReceipt.successful && externalReceipt.hash === created.request.transactionHash, 'External submission did not match Request');
      record('external-executor-submitted-exact-xdr', { ledger: externalReceipt.ledger });
    } else if (final.request.status === 'ready') {
      final = await call(ops.submit.path, ops.submit.method, {}, requestHeaders(requestId, '', serviceHeaders));
      record('msi-authorized-submission-retry');
    } else {
      check(final.request.status === 'submitted', 'Quorum did not produce ready or submitted state');
      record('mst-auto-submitted-at-quorum');
    }
    let canonical = await call(ops.inspect.path, ops.inspect.method, undefined, requestHeaders(requestId, '', serviceHeaders));
    for (let retry = 0; EXTERNAL && canonical.request.status !== 'submitted' && retry < 5; retry++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      canonical = await call(ops.inspect.path, ops.inspect.method, undefined, requestHeaders(requestId, '', serviceHeaders));
    }
    const receipt = canonical.request?.submission;
    check(canonical.request.status === 'submitted' && receipt?.transactionHash === created.request.transactionHash,
      'MSI did not receive canonical submission result');
    const chain = await horizon('/transactions/' + receipt.transactionHash);
    check(chain.successful && chain.hash === receipt.transactionHash && chain.ledger === receipt.ledger,
      'Canonical status does not match Stellar ledger');
    record('msi-canonical-ledger-confirmation', { requestId, ledger: chain.ledger, transactionHash: chain.hash });
  } finally {
    for (const item of paired) {
      const revoked = await call(ops.revoke.path, ops.revoke.method, {
        credentialId: item.agent.credential.credentialId,
      }, humanHeaders(item.signer.publicKey(), item.bobToken));
      check(revoked.credential?.revokedAt, 'MSA cleanup failed');
      const denied = await call(ops.inbox.path, ops.inbox.method, undefined, { Authorization: 'Bearer ' + item.agent.apiKey }, 401);
      check(denied.code === 'agent_credential_revoked', 'Revoked Agent can still access Inbox');
      record('msa-revocation-enforced');
    }
    // MSI has no self-revoke endpoint. This random Testnet-only service is
    // scoped to the disposable Treasury; its secret and all test keys die
    // with this process. Do not persist or print them.
  }
  console.log('LIVE MSI + MSA TESTNET E2E PASSED');
  console.log(JSON.stringify({ evidence: trace }, null, 2));
}

async function main() {
  if (INTEGRATION) return integrationE2E();
  const runtime = await call('/runtime-config');
  check(runtime.fixedNetwork === 'testnet', 'Refusing non-Testnet API deployment');
  record('isolated-testnet-runtime');

  if (!LIVE) {
    console.log('READ-ONLY PASS. Re-run with --live for one explicit Testnet-only transaction.');
    return;
  }
  if (PROPOSER) return proposerE2E();

  // New keys only. Never use a supplied wallet or retain seeds on disk.
  const alice = Keypair.random();
  const bob = Keypair.random();
  const carol = Keypair.random();
  const source = alice.publicKey();
  await fund(source);
  const funded = await horizon('/accounts/' + source);
  check(funded.account_id === source, 'Faucet-funded account not found');
  record('ephemeral-friendbot-account', { account: source });

  // The initial account key authorizes one setup. The resulting policy needs
  // any two of Alice, Bob and Carol for every operation.
  const setup = new TransactionBuilder(new Account(source, funded.sequence), {
    fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: bob.publicKey(), weight: 1 } }))
    .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: carol.publicKey(), weight: 1 } }))
    .addOperation(Operation.setOptions({
      masterWeight: 1, lowThreshold: 2, medThreshold: 2, highThreshold: 2,
    }))
    .setTimeout(120).build();
  setup.sign(alice);
  const setupReceipt = await submitXdr(setup.toXdr());
  check(setupReceipt.successful === true, '2-of-3 setup not accepted on ledger');
  const configured = await horizon('/accounts/' + source);
  check(configured.thresholds.low_threshold === 2 &&
    configured.thresholds.med_threshold === 2 &&
    configured.thresholds.high_threshold === 2, 'Signing thresholds not set to 2');
  for (const signer of [alice, bob, carol]) {
    check(configured.signers.some((x) => x.key === signer.publicKey() && x.weight === 1),
      'Signer missing from on-chain policy');
  }
  record('live-2-of-3-ledger-policy', { setupHash: setupReceipt.hash });

  const token = await unlock(alice);
  record('live-wallet-signed-unlock');

  const dataKey = 'mst_e2e_' + Date.now().toString(36) + '_' + randomBytes(3).toString('hex');
  const dataValue = 'hosted-testnet-proof';
  const transaction = new TransactionBuilder(new Account(source, configured.sequence), {
    fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({ name: dataKey, value: dataValue }))
    .setTimeout(480).build();
  const unsignedXdr = transaction.toXdr();

  const denied = await call('/request', 'POST', { network: 'testnet', xdr: unsignedXdr }, {}, 401);
  check(denied.code === 'request_creator_identity_required', 'Unauthenticated creator was not rejected');
  record('unauthenticated-proposal-rejected');

  const created = await call('/request', 'POST', { network: 'testnet', xdr: unsignedXdr },
    humanHeaders(source, token), 201);
  const requestId = created.request?.id;
  const capability = created.capability;
  check(typeof requestId === 'string' && typeof capability === 'string', 'Missing private proposal locator');
  check(created.request.network === 'testnet' && created.request.signatureCount === 0 &&
    created.request.status === 'awaiting_signatures', 'Proposal creation status is incorrect');
  record('hosted-postgres-proposal-created', { requestId });

  const before = await call('/request', 'GET', undefined, requestHeaders(requestId, capability));
  check(before.request?.signatureCount === 0, 'Stored proposal signature count changed');
  record('hosted-proposal-readback');

  if (COORDINATION) {
    // Exercise the real API from ID-only links. Fresh ephemeral wallet address
    // books have no email contacts; this cannot deliver unwanted mail.
    const aliceSessionHeaders = requestHeaders(requestId, '', {
      ...cookieHeaders(token), 'x-multisig-session-address': source,
    });
    const creatorRead = await call('/request', 'GET', undefined, aliceSessionHeaders);
    check(creatorRead.request?.id === requestId && creatorRead.coordination,
      'Creator cannot open ID-only proposal with their verified session');
    record('session-only-proposal-read');

    const selfInvite = await call('/request', 'PATCH', { assignSigner: source }, aliceSessionHeaders, 400);
    check(selfInvite.code === 'request_assignment_self', 'Self-invitation must be rejected');
    record('self-invite-rejected');

    const asked = await call('/request', 'PATCH', { assignSigner: bob.publicKey() }, aliceSessionHeaders);
    check(asked.created === true && asked.assignment?.signerAddress === bob.publicKey()
      && asked.notification?.status === 'no_contact_email',
      'ID-only session invitation must persist without dispatching an email');
    record('session-only-invite-without-email');

    const askedAgain = await call('/request', 'PATCH', { assignSigner: bob.publicKey() }, aliceSessionHeaders);
    check(askedAgain.created === false && askedAgain.notification?.status === 'no_contact_email',
      'Repeated invitation should not duplicate assignment');
    record('session-only-invite-idempotent');

    const reminder = await call('/request', 'PATCH', { remindSigner: bob.publicKey() }, aliceSessionHeaders);
    check(reminder.notification?.status === 'no_contact_email',
      'Reminder without an address-book email should not be queued');
    record('session-only-reminder-without-email');

    const bobVerifiedToken = await unlock(bob);
    const bobSessionHeaders = requestHeaders(requestId, '', {
      ...cookieHeaders(bobVerifiedToken), 'x-multisig-session-address': bob.publicKey(),
    });
    const anotherAsk = await call('/request', 'PATCH', { assignSigner: carol.publicKey() }, bobSessionHeaders);
    check(anotherAsk.created === true && anotherAsk.notification?.status === 'no_contact_email',
      'A current signer must be able to ask another eligible signer from ID-only access');
    const creatorReminder = await call('/request', 'PATCH', { remindSigner: carol.publicKey() }, aliceSessionHeaders);
    check(creatorReminder.notification?.status === 'no_contact_email',
      'Creator should be able to remind a signer originally asked by another authorized signer');
    record('creator-can-remind-other-requester');

    const after = await call('/request', 'GET', undefined, aliceSessionHeaders);
    check(after.coordination?.assignments?.length === 2 && after.coordination?.notifications?.length === 0,
      'Assignment facts must persist without creating phantom email notifications');
    record('real-coordination-readback');
  }

  // With --agent, the principal signs exact XDR locally while a scoped API
  // credential names the Agent actor. The API never holds the private key.
  let agentApiKey = '';
  let agentCredentialId = '';
  let bobToken = '';
  if (AGENT) {
    const paired = await pairAgent(bob, 'MST hosted Testnet QA');
    const agent = paired.agent;
    bobToken = paired.bobToken;
    agentApiKey = agent.apiKey;
    agentCredentialId = agent.credential.credentialId;
    record('agent-credential-created-for-signer');
    const task = await call('/request', 'GET', undefined,
      requestHeaders(requestId, '', { Authorization: 'Bearer ' + agentApiKey }));
    check(task.request?.id === requestId && task.task, 'Agent cannot read its current signer task');
    record('agent-task-read');
  }

  const signedB = TransactionBuilder.fromXdr(unsignedXdr, Networks.TESTNET);
  signedB.sign(bob);
  const firstHeaders = AGENT
    ? requestHeaders(requestId, '', { Authorization: 'Bearer ' + agentApiKey })
    : requestHeaders(requestId, capability);
  const first = await call('/request', 'PATCH', { signedXdr: signedB.toXdr() }, firstHeaders);
  check(first.addedSignatureCount === 1 && first.request?.signatureCount === 1 &&
    first.request.status === 'awaiting_signatures', 'First signer contribution was not retained');
  record('first-independent-signature');

  const duplicate = await call('/request', 'PATCH', { signedXdr: signedB.toXdr() }, firstHeaders);
  check(duplicate.addedSignatureCount === 0 && duplicate.request?.signatureCount === 1,
    'Duplicate signature changed authorization');
  record('duplicate-contribution-idempotent');

  // A private capability is not a replacement for signer identity in Activity.
  const inbox = await call('/inbox', 'GET', undefined, cookieHeaders(token));
  check(inbox.network === 'testnet' && inbox.address === source, 'Inbox wallet scope mismatch');
  check(inbox.requests?.some((item) => item.id === requestId), 'Created proposal is missing from signer Inbox');
  record('live-signer-inbox');

  const signedC = TransactionBuilder.fromXdr(unsignedXdr, Networks.TESTNET);
  signedC.sign(carol);
  const second = await call('/request', 'PATCH', { signedXdr: signedC.toXdr() },
    requestHeaders(requestId, capability));
  check(second.addedSignatureCount === 1 && second.request?.signatureCount === 2 &&
    second.request.status === 'ready', 'Second signer contribution did not reach quorum');
  record('second-independent-signature-quorum');

  if (AGENT) {
    const deniedSubmit = await call('/request', 'PUT', {}, firstHeaders, 403);
    check(deniedSubmit.code === 'agent_submit_denied', 'Agent escaped submit permission boundary');
    record('agent-submit-denied');
  }
  const submitted = await call('/request', 'PUT', {}, requestHeaders(requestId, capability));
  check(submitted.request?.status === 'submitted' &&
    submitted.request?.submission?.transactionHash === Buffer.from(transaction.hash()).toString('hex'),
    'Hosted API did not retain final transaction hash');
  const ledger = submitted.request.submission.ledger;
  check(Number.isInteger(ledger) && ledger > 0, 'Missing confirmed Stellar ledger');
  record('hosted-api-final-submission', { ledger });

  const chain = await horizon('/transactions/' + submitted.request.submission.transactionHash);
  check(chain.successful === true && chain.ledger === ledger, 'Ledger confirmation disagrees with Request');
  const data = await horizon('/accounts/' + source + '/data/' + encodeURIComponent(dataKey));
  check(Buffer.from(data.value, 'base64').toString('utf8') === dataValue, 'On-chain data proof missing');
  record('stellar-ledger-state-verified', { transactionHash: chain.hash });

  const closed = await call('/request', 'GET', undefined, requestHeaders(requestId, capability), 410);
  check(closed.code === 'request_capability_closed', 'Closed private link still exposes proposal');
  record('finished-capability-restricted');

  const history = await call('/request?view=history', 'GET', undefined,
    requestHeaders(requestId, '', {
      ...cookieHeaders(token),
      'x-multisig-session-address': source,
    }));
  check(history.request?.status === 'submitted' && history.history?.activity,
    'Verified signer cannot view completed proposal');
  record('post-submit-signer-history');

  const activity = await call('/activity?request=' + encodeURIComponent(requestId), 'GET',
    undefined, cookieHeaders(token));
  check(activity.network === 'testnet' && activity.item, 'Retained Activity missing');
  record('post-submit-retained-activity');

  if (AGENT) {
    const agentApproval = activity.item.events?.find((event) =>
      event.type === 'approval_added' && event.actor?.type === 'agent' &&
      event.actor.id === agentCredentialId &&
      event.actor.principalAddress === bob.publicKey());
    check(agentApproval, 'Retained approval lost the real Agent actor provenance');
    record('agent-approval-audit-provenance');
  }

  if (AGENT) {
    const revoked = await call('/agent-access', 'DELETE', { credentialId: agentCredentialId }, {
      ...cookieHeaders(bobToken), 'x-multisig-session-address': bob.publicKey(),
    });
    check(typeof revoked.credential?.revokedAt === 'string', 'Agent revocation not persisted');
    const denied = await call('/request', 'GET', undefined, firstHeaders, 401);
    check(denied.code === 'agent_credential_revoked', 'Revoked Agent still reads signer work');
    record('agent-revocation-enforced');
  }

  console.log('LIVE HOSTED TESTNET E2E PASSED');
  console.log(JSON.stringify({
    api: API,
    network: 'testnet',
    account: source,
    signerCount: 3,
    requiredSignatures: 2,
    agentMode: AGENT,
    requestId,
    transactionHash: chain.hash,
    ledger,
    evidence: trace,
    // No session tokens, private capabilities or signing keys.
  }, null, 2));
}

await main().catch((cause) => {
  console.error('LIVE HOSTED TESTNET E2E FAILED: ' + (cause instanceof Error ? cause.message : String(cause)));
  process.exitCode = 1;
});
