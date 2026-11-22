#!/usr/bin/env node
// Explicit opt-in Testnet smoke: one ephemeral account, one durable Request,
// two independently signed contributions, and one real Stellar transaction.
// No saved keys, email invitations, Mainnet calls, or production credentials.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Account, BASE_FEE, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

const API = 'https://api-testnet.multisig.tools/stellar';
const HORIZON = 'https://horizon-testnet.stellar.org';
const FAUCET = 'https://friendbot.stellar.org';
const LIVE = process.argv.includes('--live');
const AGENT = process.argv.includes('--agent');
const COORDINATION = process.argv.includes('--coordination');
const PROPOSER = process.argv.includes('--proposer');
const PASSKEY = process.argv.includes('--passkey');
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
async function unlock(signer) {
  const challenge = await call('/auth?account=' + encodeURIComponent(signer.publicKey()) + '&network=testnet');
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
  if (PASSKEY) {
  // Linked governance lifecycle: Template invitation -> walletless Passkey -> ledger.
  const invite = await call('/identity', 'POST',
    { action: 'create_invitation', network: 'testnet', templateId: id },
    { ...ownerHeaders, Origin: 'https://stellar-testnet.multisig.tools' }, 201);
  check(typeof invite.token === 'string' && invite.token.length === 43,
    'Treasury owner did not issue a Passkey invitation');
  record('passkey-template-invitation-issued');

  const { chromium } = await import(process.env.MST_QA_PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('https://stellar-testnet.multisig.tools/', { waitUntil: 'domcontentloaded' });
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
        hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });
    const post = (action, data = {}) => page.evaluate(async ({ action, data }) => {
      const r = await fetch('/api/identity', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, network: 'testnet', ...data }) });
      return { status: r.status, body: await r.json() };
    }, { action, data });
    const preview = await post('invitation_preview', { token: invite.token });
    check(preview.status === 200 && preview.body.invitation?.templateId === id,
      'Invitation preview failed');
    const registration = await post('registration_options', { token: invite.token });
    check(registration.status === 200, 'Passkey invitation registration options failed');
    const attestation = await page.evaluate(async (o) => {
      const d = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')
        .padEnd(Math.ceil(s.length / 4) * 4, '=')), ch => ch.charCodeAt(0));
      const e = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const c = await navigator.credentials.create({ publicKey: { ...o,
        challenge: d(o.challenge), user: { ...o.user, id: d(o.user.id) },
        excludeCredentials: (o.excludeCredentials ?? []).map(x => ({ ...x, id: d(x.id) })),
      } });
      if (!c) throw Error('No Passkey attestation');
      return { id: c.id, rawId: e(c.rawId), type: c.type,
        response: { clientDataJSON: e(c.response.clientDataJSON),
          attestationObject: e(c.response.attestationObject),
          transports: c.response.getTransports() },
        clientExtensionResults: c.getClientExtensionResults(),
        authenticatorAttachment: c.authenticatorAttachment };
    }, registration.body.options);
    const joined = await post('registration_verify', {
      challengeId: registration.body.challengeId, response: attestation,
    });
    check(joined.status === 200 && typeof joined.body.userId === 'string',
      'Passkey invitation registration failed');
    const passkeyUserId = joined.body.userId;
    check((await post('invitation_preview', { token: invite.token })).status === 404,
      'Invitation was not consumed once');
    record('walletless-passkey-accepted-invitation');

    const payment = { network: 'testnet', templatePayment: {
      template: reference, amount: '1', memo: 'MST-PASSKEY-QA',
    } };
    const browserRequest = (body) => page.evaluate(async (body) => {
      const r = await fetch('/api/request', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json() };
    }, body);
    const made = await browserRequest(payment);
    check(made.status === 201 && made.body.request?.proposerUserId === passkeyUserId,
      'Passkey User ID could not create delegated Request');
    const passkeyRequestId = made.body.request.id;
    const xdr = made.body.request.baseXdr;
    const review = TransactionBuilder.fromXdr(xdr, Networks.TESTNET);
    check(review.source === source && review.operations[0].destination === source
      && review.signatures.length === 0, 'Unapproved Passkey XDR mutation');
    record('walletless-passkey-created-request', { requestId: passkeyRequestId });

    const inbox = await page.evaluate(async () => {
      const r = await fetch('/api/inbox');
      return { status: r.status, body: await r.json() };
    });
    check(inbox.status === 200 && inbox.body.userId === passkeyUserId
      && inbox.body.requests.some(x => x.id === passkeyRequestId),
      'Passkey Request missing from personal Inbox');
    record('walletless-passkey-personal-inbox');

    const aSigned = TransactionBuilder.fromXdr(xdr, Networks.TESTNET);
    aSigned.sign(alice);
    const one = await call('/request', 'PATCH', { signedXdr: aSigned.toXdr() },
      requestHeaders(passkeyRequestId, '', ownerHeaders));
    check(one.addedSignatureCount === 1, 'First signer failed Passkey Request');
    const bSigned = TransactionBuilder.fromXdr(xdr, Networks.TESTNET);
    bSigned.sign(bob);
    const two = await call('/request', 'PATCH', { signedXdr: bSigned.toXdr() },
      requestHeaders(passkeyRequestId, '',
        { ...cookieHeaders(bobToken), 'x-multisig-session-address': bob.publicKey() }));
    check(two.request.status === 'ready', 'Second signer failed Passkey Request');
    const submitted = await call('/request', 'PUT', {}, requestHeaders(passkeyRequestId, '', ownerHeaders));
    const passkeyHash = submitted.request?.submission?.transactionHash;
    check(typeof passkeyHash === 'string' && submitted.request?.status === 'submitted',
      'Passkey Request not submitted');
    const onChain = await horizon('/transactions/' + passkeyHash);
    check(onChain.successful && onChain.hash === passkeyHash,
      'Passkey Request not confirmed on ledger');
    record('passkey-payment-ledger-confirmed', { ledger: onChain.ledger });

    const activity = await page.evaluate(async () => {
      const r = await fetch('/api/identity?network=testnet&view=activity');
      return { status: r.status, body: await r.json() };
    });
    check(activity.status === 200 && activity.body.requests.some(x =>
      x.id === passkeyRequestId && x.status === 'submitted'),
      'Passkey User ID lost completed Activity');
    record('walletless-passkey-personal-ledger-receipt');

    const revoked = await call('/identity', 'POST',
      { action: 'revoke_user_grant', network: 'testnet', templateId: id, userId: passkeyUserId },
      { ...ownerHeaders, Origin: 'https://stellar-testnet.multisig.tools' });
    check(revoked.revoked === true, 'Passkey grant revoke failed');
    const denied = await browserRequest(payment);
    check(denied.status === 403 && denied.body.code === 'template_proposer_not_authorized',
      'Revoked Passkey still creates payments');
    record('walletless-passkey-grant-revoked');
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    await context.close();
  } finally { await browser.close(); }
  }

  console.log('LIVE TEMPLATE PROPOSER TESTNET E2E PASSED');
  console.log(JSON.stringify({ requestId, ledger: chain.ledger, transactionHash: chain.hash,
    proposerFunded: false, evidence: trace }, null, 2));
}

async function main() {
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
    bobToken = await unlock(bob);
    const agent = await call('/agent-access', 'POST',
      { label: 'MST hosted Testnet QA', access: 'sign' }, {
        ...cookieHeaders(bobToken), 'x-multisig-session-address': bob.publicKey(),
      }, 201);
    check(typeof agent.apiKey === 'string' && agent.credential?.access === 'sign',
      'Agent credential was not issued');
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
