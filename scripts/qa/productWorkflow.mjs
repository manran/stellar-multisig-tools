#!/usr/bin/env node
// Browser-only product regression checks. Every wallet, API, and Horizon response
// is a local fixture. This script never sends email or broadcasts a transaction.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Account, Asset, Keypair, Memo, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = process.env.MST_QA_OUTPUT || path.join(os.tmpdir(), 'mst-product-workflow-qa');
const { chromium } = await import(process.env.MST_QA_PLAYWRIGHT_MODULE || 'playwright');
const widths = [320, 375, 414, 768, 1280];
const requestId = 'QA00000000000001';
const capability = 'QA'.repeat(13);
// Published deterministic test seeds are used only inside intercepted fixtures.
const keys = Object.fromEntries(['alice', 'bob', 'carol', 'source', 'recipient'].map((name, index) =>
  [name, Keypair.fromRawEd25519Seed(Buffer.alloc(32, index + 1))]));
const addresses = Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, key.publicKey()]));
const now = new Date().toISOString();
const expiry = new Date(Date.now() + 3_600_000).toISOString();
const unsigned = new TransactionBuilder(new Account(addresses.source, '100'), {
  fee: '100', networkPassphrase: Networks.TESTNET,
}).addOperation(Operation.payment({ destination: addresses.recipient, asset: Asset.native(), amount: '10' }))
  .setTimebounds(0, Math.floor(Date.now() / 1000) + 3600).build();

function signedXdr(...signers) {
  const transaction = TransactionBuilder.fromXDR(unsigned.toXDR(), Networks.TESTNET);
  for (const signer of signers) transaction.sign(keys[signer]);
  return transaction.toXDR();
}

function requestFixture(status = 'awaiting_signatures', signers = [], execution) {
  return {
    id: requestId, network: 'testnet', transactionHash: Buffer.from(unsigned.hash()).toString('hex'),
    baseXdr: unsigned.toXDR(), mergedXdr: signedXdr(...signers),
    createdAt: now, expiresAt: expiry, contributionCount: signers.length, signatureCount: signers.length,
    status, statusReason: status === 'awaiting_signatures' ? 'signatures_required'
      : status === 'ready' ? 'authorization_complete' : status === 'expired' ? 'request_expired'
        : status === 'submitted' ? 'ledger_confirmed' : status === 'stale' ? 'sequence_stale' : 'preconditions_failed',
    statusDetail: status === 'expired' ? 'The proposal signing window has closed.' : 'Review the current transaction conditions.',
    template: { id: 'tpl_qa_payroll', version: 1, name: 'November supplier payment' },
    ...(execution ? { execution } : {}),
    ...(status === 'submitted' ? { submission: { transactionHash: Buffer.from(unsigned.hash()).toString('hex'), ledger: 123456, submittedAt: now } } : {}),
  };
}

function inboxFixture(owner = addresses.alice) {
  const event = (eventId, type, subjectAddress, extra = {}) => ({
    eventId, type, occurredAt: now, actorAddress: owner, subjectAddress, ...extra,
  });
  return {
    address: owner, network: 'testnet', pending_count: 1, action_count: 0,
    action_counts: { actionRequired: 0, signatureNeeded: 0, readyToSubmit: 0, needsAttention: 0, waiting: 1, readyForExecutionRouting: 0 },
    intents: [],
    requests: [{
      ...requestFixture('awaiting_signatures', ['alice']), creatorAddress: owner, viewerAction: 'waiting_for_others',
      coordinationEvents: [
        // The creator already signed; real assignment rules forbid asking yourself.
        event('2', 'signer_requested', addresses.bob),
        event('3', 'signer_requested', addresses.carol),
        event('4', 'notification_failed', addresses.carol, { notificationKind: 'signature_requested' }),
        event('5', 'notification_delivered', addresses.bob, { notificationKind: 'signature_requested' }),
        event('6', 'proposal_viewed', addresses.bob, { actorAddress: addresses.bob }),
      ],
    }],
  };
}

function templateFixture(name = 'Monthly suppliers') {
  return {
    id: 'tpl_qa_monthly', network: 'testnet', name, kind: 'payment', currentVersion: 1,
    definition: { version: 1, source: addresses.source, recipients: [{ destination: addresses.recipient, assetKey: 'native' }], signingWindowSeconds: 3600 },
    createdAt: now, updatedAt: now,
  };
}

function agentFixture() {
  return {
    credentialId: 'qa-agent-001',
    label: 'Research assistant',
    prefix: 'mstqa_read_01',
    principal: { type: 'signer', network: 'testnet', address: addresses.alice },
    access: 'read', createdAt: now, createdBy: addresses.alice,
  };
}

const walletModule = `
import React, { createContext, useContext, useState } from 'react';
const Context = createContext(null);
export function StellarWalletProvider({ children }) {
  const [identity, setIdentity] = useState(window.__MST_QA_INITIAL_WALLET__);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const apply = (patch) => setIdentity((old) => ({ ...old, ...patch }));
  window.__MST_QA_SET_WALLET__ = apply;
  const calls = window.__MST_QA_WALLET_CALLS__ ||= [];
  const value = {
    ...identity, busy: false, authBusy: false, error: '', authError: '',
    networkSource: 'wallet', sessionExpiresAt: null, unlockExpiresAt: Date.now() + 3600000,
    accountMenuOpen, setAccountMenuOpen,
    connect: async () => { calls.push('connect'); return identity.address; },
    signIn: async () => {
      calls.push('signIn');
      const address = identity.address || window.__MST_QA_DEFAULT_ADDRESS__;
      apply({ address, sessionAddress: address, network: 'testnet', sessionNetwork: 'testnet', privateUnlocked: true, unlockedAddress: address, unlockedNetwork: 'testnet' });
      return address;
    },
    unlock: async () => {
      calls.push('unlock');
      if (window.__MST_QA_CANCEL_UNLOCK__) throw new Error('The user rejected this request.');
      const address = identity.address || window.__MST_QA_DEFAULT_ADDRESS__;
      apply({ address, sessionAddress: address, network: 'testnet', sessionNetwork: 'testnet', privateUnlocked: true, unlockedAddress: address, unlockedNetwork: 'testnet' });
      return address;
    },
    lock: async () => apply({ privateUnlocked: false, unlockedAddress: '', unlockedNetwork: null }),
    clear: () => apply({ address: '', sessionAddress: '', privateUnlocked: false, unlockedAddress: '', unlockedNetwork: null }),
    sign: async (xdr, network) => { calls.push('sign'); return window.__MST_QA_SIGN__({ xdr, network, address: identity.address }); },
    signAuthEntry: async () => { throw new Error('Soroban wallet signing is not part of this fixture.'); },
    refreshSession: async () => {}, alignNetworkContext: async () => {}, selectNetworkContext: async () => {},
  };
  return React.createElement(Context.Provider, { value }, children);
}
export function useStellarWallet() { return useContext(Context); }
`;

const walletPlugin = {
  name: 'mst-isolated-product-qa-wallet', enforce: 'pre',
  resolveId(source) {
    if (/^(?:\.\/|\.\.\/).*StellarWalletContext(?:\.tsx)?$/.test(source)) return '\0mst-qa-wallet';
  },
  load(id) { if (id === '\0mst-qa-wallet') return walletModule; },
};

await mkdir(output, { recursive: true });
process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = 'testnet';
const server = await createServer({
  root: path.join(root, 'apps/stellar-web'), configFile: path.join(root, 'apps/stellar-web/vite.config.ts'),
  plugins: [walletPlugin], logLevel: 'warn',
  server: { host: '127.0.0.1', port: 4177, strictPort: true, hmr: false },
});
await server.listen();
const origin = 'http://127.0.0.1:4177';
const browser = await chromium.launch({ headless: true });
const results = [];
const unexpectedRequests = [];
const pageErrors = [];

function walletState(address = addresses.alice, unlocked = true) {
  return { address, sessionAddress: address, network: 'testnet', sessionNetwork: 'testnet', privateUnlocked: unlocked,
    unlockedAddress: unlocked ? address : '', unlockedNetwork: unlocked ? 'testnet' : null };
}

async function fixturePage(width, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai' });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(({ wallet, defaultAddress }) => {
    window.__MST_QA_INITIAL_WALLET__ = wallet;
    window.__MST_QA_DEFAULT_ADDRESS__ = defaultAddress;
    window.__MST_QA_WALLET_CALLS__ = [];
  }, { wallet: options.wallet ?? walletState(), defaultAddress: addresses.alice });
  await page.exposeFunction('__MST_QA_SIGN__', ({ xdr, network, address }) => {
    assert.equal(network, 'testnet');
    const signer = Object.values(keys).find((key) => key.publicKey() === address);
    assert.ok(signer, 'Only a fixture key may sign');
    const transaction = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
    assert.equal(Buffer.from(transaction.hash()).toString('hex'), Buffer.from(unsigned.hash()).toString('hex'));
    transaction.sign(signer);
    return transaction.toXDR();
  });
  const state = {
    templateStatus: 200, templates: [], templateOwner: addresses.alice, templateDelay: null,
    proposerGrants: [], proposerGrantCount: 0, proposerRequestCount: 0,
    inboxStatus: 200, inbox: inboxFixture(), request: requestFixture(), requestError: null,
    requestGetCount: 0, inboxGetCount: 0, contributionCount: 0, submitCount: 0, retentionCount: 0,
    requestAccess: { shareable: false, activityBound: true }, requestGetResponse: null, horizonAccount: null,
    inviteContacts: false, assignments: [], notifications: [],
    agentCredentials: [agentFixture()], agentRevokeCount: 0, agentCreates: [],
    contactSaveCount: 0, contactSaveStatus: 200, addressEntries: null,
    ...options.state,
  };
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (url.hostname === 'horizon-testnet.stellar.org') {
      if (url.pathname === '/accounts' && url.searchParams.get('signer')) return json({
        _embedded: { records: [{
          account_id: addresses.source, sequence: '100', subentry_count: 3, num_sponsoring: 0, num_sponsored: 0,
          balances: [{ asset_type: 'native', balance: '125.0000000' }],
          thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 2 },
          signers: ['alice', 'bob', 'carol'].map((name) => ({ key: addresses[name], type: 'ed25519_public_key', weight: 1 })),
        }] },
      });
      if (url.pathname.startsWith('/accounts/')) return json(state.horizonAccount ?? {
        account_id: url.pathname.split('/').at(-1), sequence: '100', subentry_count: 3, num_sponsoring: 0, num_sponsored: 0,
        balances: [{ asset_type: 'native', balance: '1000.0000000' }],
        thresholds: { low_threshold: 2, med_threshold: 2, high_threshold: 2 },
        signers: ['alice', 'bob', 'carol'].map((name) => ({ key: addresses[name], type: 'ed25519_public_key', weight: 1 })),
      });
      return json({ error: 'No ledger operations in browser QA.' }, 404);
    }
    if (url.origin !== origin) {
      // External resources cannot contact a live service from this fixture run.
      return route.abort();
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/templates') {
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON();
        assert.equal(request.headers()['x-multisig-session-address'], state.templateOwner);
        assert.equal(body.network, 'testnet');
        assert.ok(['grant', 'revoke'].includes(body.action));
        assert.equal(body.templateId, 'tpl_qa_monthly');
        assert.equal(body.proposerAddress, addresses.carol);
        state.proposerGrantCount++;
        state.proposerGrants = body.action === 'grant'
          ? [...new Set([...state.proposerGrants, body.proposerAddress])]
          : state.proposerGrants.filter((item) => item !== body.proposerAddress);
        return json({ proposerAddresses: state.proposerGrants });
      }
      const response = { address: state.templateOwner, templates: state.templates };
      const status = state.templateStatus;
      if (state.templateDelay) await state.templateDelay;
      return json(status === 200 ? response : { error: 'Fixture template load failure.' }, status);
    }
    if (url.pathname === '/api/inbox') {
      state.inboxGetCount++;
      return json(state.inboxStatus === 200 ? state.inbox : { error: 'Fixture inbox load failure.' }, state.inboxStatus);
    }
    if (url.pathname === '/api/address-book') {
      if (request.method() === 'PUT') {
        const body = request.postDataJSON();
        if (state.contactSaveDelays?.[body.address]) await state.contactSaveDelays[body.address];
        if (state.contactSaveStatus !== 200) return json({ error: 'Contact could not be saved.' }, state.contactSaveStatus);
        state.contactSaveCount++;
        const entry = { address: body.address, subject_type: body.subject_type, label: body.label, ...(body.notification_email ? { notification_email: body.notification_email } : {}), created_at: now, updated_at: now };
        state.addressEntries = [...(state.addressEntries ?? []), entry];
        return json({ entry });
      }
      return json({ entries: state.addressEntries ?? ['alice', 'bob', 'carol'].map((name) => ({
        address: addresses[name], subjectType: 'signer', label: name[0].toUpperCase() + name.slice(1),
        ...(state.inviteContacts && name !== 'alice' ? { notificationEmail: name + '@example.org' } : {}),
      })) });
    }
    if (url.pathname === '/api/agent-access') {
      assert.equal(request.headers()['x-multisig-session-address'], addresses.alice);
      if (request.method() === 'GET') return json({ credentials: state.agentCredentials });
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        assert.ok(['read', 'write', 'sign'].includes(body.access));
        state.agentCreates.push(body);
        const credential = {
          ...agentFixture(), credentialId: 'qa-agent-' + (state.agentCreates.length + 1),
          label: body.label, access: body.access, prefix: 'mstqa_new_01',
        };
        state.agentCredentials = [...state.agentCredentials, credential];
        return json({ credential, apiKey: 'qa_one_time_credential_secret' });
      }
      if (request.method() === 'DELETE') {
        const { credentialId } = request.postDataJSON();
        state.agentRevokeCount++;
        state.agentCredentials = state.agentCredentials.map((credential) =>
          credential.credentialId === credentialId ? { ...credential, revokedAt: now, revokedBy: addresses.alice } : credential);
        return json({ revoked: true });
      }
    }
    if (url.pathname === '/api/contracts') return json({ contracts: [] });
    if (url.pathname === '/api/treasury-box') return json({ metadataByAccount: {} });
    if (url.pathname === '/api/runtime-config') return json({ stellarNetwork: 'testnet', fixedNetwork: 'testnet', capabilities: { classicManagedExecution: { testnet: false, public: false } } });
    if (url.pathname === '/api/request') {
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        assert.equal(request.headers()['x-multisig-session-address'], addresses.carol);
        assert.equal(request.headers()['x-multisig-request-id'], undefined);
        assert.equal(body.network, 'testnet');
        assert.equal(body.xdr, undefined, 'Non-signer never submits arbitrary XDR');
        assert.equal(body.templatePayment?.amount, '12.5');
        assert.equal(body.templatePayment?.memo, 'INV-401');
        assert.deepEqual(body.templatePayment?.template, { id: 'tpl_qa_monthly', version: 1 });
        assert.deepEqual(Object.keys(body.templatePayment).sort(), ['amount', 'memo', 'template']);
        if (!state.proposerGrants.includes(addresses.carol)) {
          return json({ code: 'template_proposer_not_authorized', error: 'This wallet is not authorized for this Template.' }, 403);
        }
        if (state.proposerPostDelay) await state.proposerPostDelay;
        state.proposerRequestCount++;
        const payment = new TransactionBuilder(new Account(addresses.source, '100'), {
          fee: '100', networkPassphrase: Networks.TESTNET,
        }).addOperation(Operation.payment({
          destination: addresses.recipient, asset: Asset.native(), amount: body.templatePayment.amount,
        })).addMemo(Memo.text(body.templatePayment.memo))
          .setTimebounds(0, Math.floor(Date.now() / 1000) + 3600).build();
        state.request = {
          ...requestFixture('awaiting_signatures'), proposerAddress: addresses.carol,
          baseXdr: payment.toXDR(), mergedXdr: payment.toXDR(),
          transactionHash: Buffer.from(payment.hash()).toString('hex'),
          template: { id: 'tpl_qa_monthly', version: 1, name: 'Monthly suppliers', kind: 'payment' },
        };
        state.requestAccess = { shareable: false, activityBound: true };
        state.inbox = {
          ...inboxFixture(addresses.carol), requests: [{
            ...state.request, viewerAction: 'proposer_waiting', coordinationEvents: [],
          }],
        };
        return json({ request: state.request, access: state.requestAccess, context: {} }, 201);
      }
      assert.equal(request.headers()['x-multisig-request-id'], requestId);
      if (request.method() === 'GET') {
        state.requestGetCount++;
        if (state.requestGetResponse) {
          const reply = state.requestGetResponse(request);
          if (reply.delay) await reply.delay;
          try { return await json(reply.body, reply.status ?? 200); }
          finally { reply.onDone?.(); }
        }
        if (state.requestError) return json(state.requestError, 410);
        return json({ request: state.request, access: state.requestAccess, coordination: { assignments: state.assignments, notifications: state.notifications } });
      }
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON();
        if (body.retainActivity === true) {
          assert.equal(request.headers()['x-multisig-session-address'], addresses.alice, 'Retention must use the newly verified wallet');
          state.retentionCount++;
          state.requestAccess = { ...state.requestAccess, activityBound: true };
          return json({ request: state.request, access: state.requestAccess });
        }
        if (body.assignSigner) {
          assert.ok(state.inviteContacts, 'Only the invitation fixture may create assignments');
          assert.equal(request.headers()['x-multisig-session-address'], addresses.alice);
          if (!state.requestAccess.shareable) assert.equal(request.headers()['x-multisig-capability'], undefined, 'Inbox invitation must use the verified signer session');
          const assignment = {
            version: 1, signerAddress: body.assignSigner, assignedByAddress: addresses.alice,
            assignedAt: '2026-11-20T12:00:00Z',
          };
          state.assignments = [...state.assignments, assignment];
          state.notifications = [...state.notifications, {
            channel: 'email', eventType: 'signature_requested', signerAddress: body.assignSigner,
            actorAddress: addresses.alice, state: 'queued', createdAt: assignment.assignedAt,
          }];
          return json({
            request: state.request, assignment, created: true,
            coordination: { assignments: state.assignments, notifications: state.notifications },
            notification: { channel: 'email', status: 'queued' },
          });
        }
        if (body.remindSigner) {
          assert.ok(state.inviteContacts);
          assert.equal(request.headers()['x-multisig-session-address'], addresses.alice);
          state.remindCount = (state.remindCount ?? 0) + 1;
          state.notifications = [...state.notifications, {
            channel: 'email', eventType: 'signature_reminder', signerAddress: body.remindSigner,
            actorAddress: addresses.alice, state: 'queued', createdAt: now,
          }];
          return json({
            request: state.request,
            coordination: { assignments: state.assignments, notifications: state.notifications },
            notification: { channel: 'email', status: 'queued' },
          });
        }
        assert.ok(body.signedXdr, 'QA only accepts an explicit signed XDR contribution');
        const transaction = TransactionBuilder.fromXDR(body.signedXdr, Networks.TESTNET);
        assert.equal(Buffer.from(transaction.hash()).toString('hex'), Buffer.from(unsigned.hash()).toString('hex'));
        assert.ok(transaction.signatures.some((signature) => keys.alice.verify(transaction.hash(), signature.signature)));
        state.contributionCount++;
        state.request = { ...state.request, mergedXdr: body.signedXdr, contributionCount: 1, signatureCount: 1 };
        return json({ request: state.request, addedSignatureCount: 1, duplicateSignatureCount: 0 });
      }
      if (request.method() === 'PUT') {
        state.submitCount++;
        assert.equal(state.request.status, 'ready');
        state.request = { ...requestFixture('submitted', ['alice', 'bob']), execution: state.request.execution };
        return json({ request: state.request });
      }
    }
    unexpectedRequests.push(`${request.method()} ${url.pathname}`);
    return json({ error: 'Unexpected fixture request.' }, 404);
  });
  return { page, context, state, errors };
}

async function visible(page, text, role) {
  const locator = role ? page.getByRole(role, { name: text, exact: true }) : page.getByText(text, { exact: true });
  await locator.first().waitFor({ state: 'visible' });
}

async function snapshot(page, name, width) {
  const overflow = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(overflow.document <= overflow.width + 1 && overflow.body <= overflow.width + 1, `${name}: horizontal overflow ${JSON.stringify(overflow)}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true });
}

async function run(name, width, options, check) {
  const fixture = await fixturePage(width, options);
  try {
    await check(fixture);
    assert.deepEqual(fixture.errors, [], 'No uncaught browser errors');
    results.push({ name, width, passed: true });
    console.log(`PASS ${name} ${width}px`);
  } catch (error) {
    results.push({ name, width, passed: false, error: error.message });
    await fixture.page.screenshot({ path: path.join(output, `FAILED-${name}-${width}.png`), fullPage: true }).catch(() => {});
    console.error(`FAIL ${name} ${width}px: ${error.message}`);
  } finally {
    pageErrors.push(...fixture.errors.map((message) => ({ name, width, message })));
    await fixture.context.close();
  }
}

try {
  for (const width of widths) {
    await run('templates-locked-and-cancel', width, { wallet: walletState('', false) }, async ({ page }) => {
      await page.goto(`${origin}/new`);
      await visible(page, 'Your templates', 'heading');
      assert.deepEqual(await page.evaluate(() => window.__MST_QA_WALLET_CALLS__), []);
      await snapshot(page, 'new-locked', width);
      await page.evaluate(() => { window.__MST_QA_CANCEL_UNLOCK__ = true; });
      await page.getByRole('button', { name: 'Show my templates', exact: true }).click();
      await visible(page, 'Show my templates', 'button');
      assert.equal(await page.getByRole('alert').count(), 0);
      await page.evaluate(() => { window.__MST_QA_CANCEL_UNLOCK__ = false; });
      await page.getByRole('button', { name: 'Show my templates', exact: true }).click();
      await visible(page, 'No saved templates on Testnet yet.');
    });

    if (width === 375 || width === 1280) {
      await run('wallet-connect-entry', width, { wallet: walletState('', false) }, async ({ page }) => {
        await page.goto(origin + '/');
        await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
        assert.ok((await page.evaluate(() => window.__MST_QA_WALLET_CALLS__)).includes('signIn'));
        assert.equal(await page.getByRole('button', { name: 'Connect wallet', exact: true }).count(), 0,
          'Connected account replaces the entry button');
      });

      await run('overview-workbench', width, {}, async ({ page }) => {
        await page.goto(origin + '/');
        await visible(page, 'Overview', 'heading');
        await visible(page, 'Needs your attention');
        await snapshot(page, 'overview', width);
        if (width === 375) {
          const more = page.getByRole('button', { name: 'More workspace tools' });
          await more.click();
          await visible(page, 'Activity', 'menuitem');
          await visible(page, 'Templates', 'menuitem');
          await visible(page, 'Contracts', 'menuitem');
          await visible(page, 'Treasuries', 'menuitem');
          await visible(page, 'Contacts', 'menuitem');
          await visible(page, 'Agent access', 'menuitem');
          await page.keyboard.press('Escape');
          assert.equal(await more.getAttribute('aria-expanded'), 'false');
        }
      });
    }

    if (width === 375 || width === 1280) {
      await run('overview-failed-email-is-actionable', width, {
        state: { request: { ...requestFixture('awaiting_signatures', ['alice']), creatorAddress: addresses.alice } },
      }, async ({ page }) => {
        await page.goto(origin + '/');
        await visible(page, '1 signer email needs follow-up');
        await visible(page, 'November supplier payment');
        await visible(page, 'Follow-up needed');
        const proposal = page.locator('.mst-work-list .mst-work-row').filter({ hasText: 'November supplier payment' });
        await proposal.getByText('Follow up', { exact: true }).waitFor({ state: 'visible' });
        await snapshot(page, 'overview-email-followup', width);
        await proposal.click();
        await visible(page, 'Your signature is recorded', 'heading');
        await page.waitForFunction(() => document.activeElement?.id === 'proposal-signatures');
      });
    }

    if (width === 375) {
      await run('overview-wallet-change-keeps-private-inbox-scoped', width, {}, async ({ page, state }) => {
        await page.goto(origin + '/');
        await visible(page, 'November supplier payment');
        state.inbox = {
          ...inboxFixture(addresses.bob), pending_count: 0, action_count: 0,
          action_counts: {
            actionRequired: 0, signatureNeeded: 0, readyToSubmit: 0,
            needsAttention: 0, waiting: 0, readyForExecutionRouting: 0,
          },
          requests: [], intents: [],
        };
        const bobLoad = page.waitForResponse((response) => response.url().endsWith('/api/inbox') && response.status() === 200);
        await page.evaluate((wallet) => window.__MST_QA_SET_WALLET__(wallet), walletState(addresses.bob));
        assert.equal(await page.getByText('November supplier payment', { exact: true }).count(), 0,
          'Previous wallet private proposal must disappear on wallet change');
        await bobLoad;
        await visible(page, "You're all caught up.");
        assert.equal(await page.getByText('1 signer email needs follow-up').count(), 0);
        await snapshot(page, 'overview-wallet-change', width);
      });
    }

    if (width === 375 || width === 1280) {
      await run('treasury-proposal-shortcut', width, {}, async ({ page }) => {
        await page.goto(origin + '/treasury');
        await page.getByRole('button', { name: 'Add to Treasuries' }).waitFor({ state: 'visible' });
        await page.getByRole('button', { name: 'Add to Treasuries' }).click();
        await page.getByRole('heading', { name: /My treasuries/ }).waitFor({ state: 'visible' });
        await page.getByRole('link', { name: 'View account' }).click();
        if (width <= 414) {
          const overlapping = await page.locator('.mst-treasury-detail__header > div').evaluateAll((nodes) => {
            const [heading, balance] = nodes.map((node) => node.getBoundingClientRect());
            return balance.top < heading.bottom - 1;
          });
          assert.equal(overlapping, false, 'Treasury account identity and balance must not overlap');
        }
        const nav = page.getByRole('navigation', { name: 'Treasury actions' });
        const proposal = nav.getByRole('link', { name: 'New proposal' });
        await proposal.waitFor({ state: 'visible' });
        const href = new URL(await proposal.getAttribute('href'), origin);
        assert.equal(href.searchParams.get('account'), addresses.source);
        assert.equal(href.searchParams.get('network'), 'testnet');
        await snapshot(page, 'treasury-workbench', width);
      });

      if (width === 375) {
        await run('contacts-wallet-scope', width, {}, async ({ page }) => {
          await page.goto(origin + '/address-book');
          await visible(page, 'Contacts', 'heading');
          await page.evaluate((wallet) => window.__MST_QA_SET_WALLET__(wallet),
            { ...walletState(addresses.bob), unlockedAddress: addresses.alice });
          await visible(page, 'Saved contact details are private');
          assert.equal(await page.getByRole('button', { name: 'Add contact' }).count(), 0);
        });
      }

      await run('contacts-search-and-save', width, {}, async ({ page, state }) => {
        await page.goto(origin + '/address-book');
        await visible(page, 'Contacts', 'heading');
        const search = page.getByRole('searchbox', { name: 'Find a contact' });
        await search.fill('Bob');
        await visible(page, 'Bob');
        await search.fill('no-matches-999');
        await visible(page, 'No matching contacts. Try another name or address.');
        await search.fill('');
        await page.getByRole('button', { name: 'Add contact' }).click();
        await page.getByRole('textbox', { name: 'Contact address' }).fill(addresses.recipient);
        const name = page.getByRole('textbox', { name: 'Name', exact: true });
        await name.fill('Vendor Example');
        state.contactSaveStatus = 500;
        await page.getByRole('button', { name: 'Save contact' }).click();
        await visible(page, 'Contact could not be saved.');
        assert.equal(state.contactSaveCount, 0);
        assert.equal(await name.inputValue(), 'Vendor Example');
        state.contactSaveStatus = 200;
        await page.getByRole('button', { name: 'Save contact' }).click();
        await visible(page, 'Vendor Example');
        assert.equal(state.contactSaveCount, 1);
        await snapshot(page, 'contacts-workbench', width);
      });

      if (width === 375) {
        await run('contacts-concurrent-saves-keep-both-signers', width, {}, async ({ page, state }) => {
          let releaseBob;
          state.contactSaveDelays = {
            [addresses.bob]: new Promise((resolve) => { releaseBob = resolve; }),
          };
          await page.goto(origin + '/address-book');
          await visible(page, 'Contacts', 'heading');
          const bob = page.locator('.mst-address-row').filter({ hasText: addresses.bob });
          const carol = page.locator('.mst-address-row').filter({ hasText: addresses.carol });
          await bob.getByRole('button', { name: 'Edit contact Bob' }).click();
          await bob.getByPlaceholder('e.g. Bob').fill('Bob operations');
          await bob.getByRole('textbox', { name: 'Notification email' }).fill('bob.ops@example.org');
          const bobSaved = page.waitForResponse((response) => response.url().endsWith('/api/address-book')
            && response.request().method() === 'PUT' && response.request().postDataJSON().address === addresses.bob);
          await bob.getByRole('button', { name: 'Save contact' }).click();

          await carol.getByRole('button', { name: 'Edit contact Carol' }).click();
          await carol.getByPlaceholder('e.g. Bob').fill('Carol operations');
          await carol.getByRole('textbox', { name: 'Notification email' }).fill('carol.ops@example.org');
          await carol.getByRole('button', { name: 'Save contact' }).click();
          await carol.getByRole('button', { name: 'Edit contact Carol operations' }).waitFor({ state: 'visible' });
          releaseBob();
          await bobSaved;
          await bob.getByRole('button', { name: 'Edit contact Bob operations' }).waitFor({ state: 'visible' });
          await carol.getByRole('button', { name: 'Edit contact Carol operations' }).waitFor({ state: 'visible' });
          assert.equal(state.contactSaveCount, 2);
          await bob.getByRole('button', { name: 'Edit contact Bob operations' }).click();
          assert.equal(await bob.getByRole('textbox', { name: 'Notification email' }).inputValue(), 'bob.ops@example.org');
          await bob.getByRole('button', { name: 'Cancel contact editing' }).click();
          await carol.getByRole('button', { name: 'Edit contact Carol operations' }).click();
          assert.equal(await carol.getByRole('textbox', { name: 'Notification email' }).inputValue(), 'carol.ops@example.org');
          await carol.getByRole('button', { name: 'Cancel contact editing' }).click();
          await snapshot(page, 'contacts-concurrent-saves', width);
        });

        await run('contacts-inflight-save-does-not-leak-across-wallets', width, {}, async ({ page, state }) => {
          let releaseAlice;
          state.contactSaveDelays = {
            [addresses.carol]: new Promise((resolve) => { releaseAlice = resolve; }),
          };
          await page.goto(origin + '/address-book');
          await visible(page, 'Contacts', 'heading');
          const carol = page.locator('.mst-address-row').filter({ hasText: addresses.carol });
          await carol.getByRole('button', { name: 'Edit contact Carol' }).click();
          await carol.getByPlaceholder('e.g. Bob').fill('Alice private draft');
          await carol.getByRole('textbox', { name: 'Notification email' }).fill('alice-only@example.org');
          const aliceSaved = page.waitForResponse((response) => response.url().endsWith('/api/address-book')
            && response.request().method() === 'PUT' && response.request().postDataJSON().address === addresses.carol);
          await carol.getByRole('button', { name: 'Save contact' }).click();

          // Bob's contact store is empty. Alice's pending response must stay in Alice's scope.
          state.addressEntries = [];
          const bobLoaded = page.waitForResponse((response) => response.url().endsWith('/api/address-book')
            && response.request().method() === 'GET');
          await page.evaluate((wallet) => window.__MST_QA_SET_WALLET__(wallet), walletState(addresses.bob));
          await bobLoaded;
          assert.equal(await page.getByText('Alice private draft', { exact: true }).count(), 0,
            'Old wallet contacts must be hidden immediately after switching');
          releaseAlice();
          await aliceSaved;
          await page.waitForTimeout(100);
          assert.equal(await page.getByText('Alice private draft', { exact: true }).count(), 0,
            'Late save from another wallet must not overwrite private contacts');
          assert.equal(await page.locator('input[value="alice-only@example.org"]').count(), 0,
            'Old wallet email draft must not survive a wallet change');
          await snapshot(page, 'contacts-wallet-boundary', width);
        });
      }

      await run('agent-access-confirmed-revoke', width, {}, async ({ page, state }) => {
        await page.goto(origin + '/agent-access');
        await page.getByRole('heading', { name: /Current agents/ }).waitFor({ state: 'visible' });
        await page.getByRole('button', { name: 'Revoke', exact: true }).click();
        assert.equal(state.agentRevokeCount, 0);
        await visible(page, 'Confirm revoke', 'button');
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert.equal(state.agentRevokeCount, 0);
        await page.getByRole('button', { name: 'Revoke', exact: true }).click();
        await page.getByRole('button', { name: 'Confirm revoke' }).click();
        await visible(page, 'No active agents. Create a credential below to connect one.');
        assert.equal(state.agentRevokeCount, 1);
        await page.getByRole('button', { name: 'Show revoked (1)' }).click();
        await visible(page, 'Research assistant');
        await snapshot(page, 'agents-workbench', width);
        await page.getByRole('button', { name: /^Write\b/ }).click();
        await page.getByRole('textbox', { name: 'Agent name' }).fill('Operations bot');
        await page.getByRole('button', { name: 'Create credential' }).click();
        await visible(page, 'Copy this credential now');
        await visible(page, 'qa_one_time_credential_secret');
        assert.deepEqual(state.agentCreates, [{ label: 'Operations bot', access: 'write' }]);
        await page.getByRole('button', { name: 'Done', exact: true }).click();
        assert.equal(await page.getByText('qa_one_time_credential_secret').count(), 0);
      });
    }

    await run('templates-recovery', width, { state: { templateStatus: 500 } }, async ({ page, state }) => {
      await page.goto(`${origin}/new?account=${addresses.recipient}`);
      await visible(page, 'Retry templates', 'button');
      state.templateStatus = 200;
      state.templates = [templateFixture()];
      await page.getByRole('button', { name: 'Retry templates', exact: true }).click();
      await visible(page, 'Monthly suppliers', 'heading');
      await visible(page, 'This template uses a different source account.');
      await snapshot(page, 'new-templates', width);
      const link = page.getByRole('link', { name: 'Use template', exact: true });
      const href = new URL(await link.getAttribute('href'), origin);
      assert.equal(href.searchParams.get('template'), 'tpl_qa_monthly');
      assert.equal(href.searchParams.get('network'), 'testnet');
    });

    if (width === 375 || width === 1280) {
      await run('template-owner-grants-and-revokes-nonsigner-wallet', width, {
        state: { templates: [{ ...templateFixture(), ownerAddress: addresses.alice, proposerAddresses: [] }] },
      }, async ({ page, state }) => {
        await page.goto(`${origin}/new`);
        await visible(page, 'Monthly suppliers', 'heading');
        assert.equal(await page.getByText('Allow another wallet to request payments').count(), 0, 'Creating a proposal must not expose permission management');
        await page.getByRole('link', { name: 'Manage templates' }).click();
        await visible(page, 'Templates', 'heading');
        const grant = page.getByText('Allow another wallet to request payments');
        await grant.click();
        const address = page.getByRole('textbox', { name: 'Proposer G address' });
        await address.fill(addresses.carol);
        await page.getByRole('button', { name: 'Allow', exact: true }).click();
        await page.getByRole('button', { name: 'Revoke', exact: true }).waitFor({ state: 'visible' });
        assert.equal(state.proposerGrantCount, 1);
        assert.deepEqual(state.proposerGrants, [addresses.carol]);
        await snapshot(page, 'template-proposer-grant', width);
        await page.getByRole('button', { name: 'Revoke', exact: true }).click();
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert.equal(state.proposerGrantCount, 1, 'Cancel must not revoke access');
        await page.getByRole('button', { name: 'Revoke', exact: true }).click();
        await page.getByRole('button', { name: 'Confirm revoke', exact: true }).click();
        await page.getByRole('button', { name: 'Confirm revoke', exact: true }).waitFor({ state: 'hidden' });
        assert.equal(state.proposerGrantCount, 2);
        assert.deepEqual(state.proposerGrants, []);
      });

      await run('templates-wallet-change-hides-previous-owner', width, {
        state: { templates: [{ ...templateFixture(), ownerAddress: addresses.alice }] },
      }, async ({ page, state }) => {
        await page.goto(`${origin}/templates`);
        await visible(page, 'Monthly suppliers', 'heading');
        state.templateOwner = addresses.bob;
        state.templates = [];
        await page.evaluate((wallet) => window.__MST_QA_SET_WALLET__(wallet), walletState(addresses.bob));
        await visible(page, 'No saved templates yet', 'heading');
        assert.equal(await page.getByRole('heading', { name: 'Monthly suppliers' }).count(), 0,
          'Template from the previous wallet must disappear after account switch');
        await snapshot(page, 'templates-owner-switched', width);
      });

      await run('templates-delegated-wallet-cannot-manage-grants', width, {
        wallet: walletState(addresses.carol),
        state: { templateOwner: addresses.carol, templates: [{ ...templateFixture(), ownerAddress: addresses.alice }] },
      }, async ({ page }) => {
        await page.goto(`${origin}/templates`);
        await visible(page, 'Monthly suppliers', 'heading');
        await page.getByText(/Shared with this wallet/).waitFor({ state: 'visible' });
        assert.equal(await page.getByText('Allow another wallet to request payments').count(), 0);
        const link = page.getByRole('link', { name: 'Request payment', exact: true });
        assert.equal(new URL(await link.getAttribute('href'), origin).pathname, '/new/proposer');
      });

      await run('delegated-wallet-creates-payment-without-signing', width, {
        wallet: walletState(addresses.carol),
        state: {
          templateOwner: addresses.carol,
          templates: [{ ...templateFixture(), ownerAddress: addresses.alice }],
          proposerGrants: [addresses.carol],
          horizonAccount: {
            account_id: addresses.source, sequence: '100', subentry_count: 2, num_sponsoring: 0, num_sponsored: 0,
            balances: [{ asset_type: 'native', balance: '1000.0000000' }],
            thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 2 },
            signers: ['alice', 'bob'].map((name) => ({ key: addresses[name], type: 'ed25519_public_key', weight: 1 })),
          },
        },
      }, async ({ page, state }) => {
        await page.goto(`${origin}/new`);
        await visible(page, 'Monthly suppliers', 'heading');
        await visible(page, 'You are authorized to initiate payments from this Template.');
        assert.equal(await page.getByText('Allow another wallet to request payments').count(), 0, 'Delegated users cannot administer templates');
        const link = page.getByRole('link', { name: 'Request payment', exact: true });
        await link.click();
        await visible(page, 'Request a payment', 'heading');
        assert.equal(await page.getByRole('textbox', { name: 'Recipient' }).count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Sign', exact: true }).count(), 0);
        await page.getByRole('textbox', { name: 'Payment amount' }).fill('12.5');
        await page.getByRole('textbox', { name: 'On-chain memo (optional)' }).fill('INV-401');
        await page.getByRole('button', { name: 'Review request' }).click();
        await visible(page, '12.5 XLM');
        const reviewText = await page.locator('form').innerText();
        assert.ok(reviewText.indexOf('Payment amount') >= 0
          && reviewText.indexOf('Payment amount') < reviewText.indexOf('From Treasury'),
          'The payment amount must lead the review before technical Treasury identity');
        await snapshot(page, 'delegated-payment-review', width);
        await page.getByRole('button', { name: 'Create signing request' }).click();
        await visible(page, 'Share with signers');
        await visible(page, 'Waiting for Treasury signatures', 'heading');
        await visible(page, 'Treasury signatures needed', 'heading');
        assert.equal(await page.getByRole('heading', { name: 'Your signature is needed' }).count(), 0);
        assert.equal(await page.getByText('YOU CAN SIGN').count(), 0, 'Proposer must not be classified as a Stellar signer');
        assert.equal(await page.getByRole('heading', { name: 'Review this transaction' }).count(), 0,
          'Reviewed proposer payment should continue straight to signer coordination');
        await page.getByText('12.5000000 XLM').first().waitFor({ state: 'visible' });
        assert.equal(state.proposerRequestCount, 1);
        assert.equal(await page.getByRole('button', { name: 'Sign', exact: true }).count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Submit transaction' }).count(), 0);
        await visible(page, 'Copy link for authorized signers');
        await snapshot(page, 'delegated-payment-created', width);
        await page.goto(`${origin}/inbox`);
        await visible(page, 'Waiting for signatures');
        await visible(page, 'Signer follow-up');
        await snapshot(page, 'delegated-payment-inbox', width);
      });

      if (width === 375) {
        await run('delegated-wallet-switch-clears-draft-and-ignores-old-request', width, {
          wallet: walletState(addresses.carol),
          state: {
            templateOwner: addresses.carol,
            templates: [{ ...templateFixture(), ownerAddress: addresses.alice }],
            proposerGrants: [addresses.carol, addresses.bob],
          },
        }, async ({ page, state }) => {
          let releaseOldRequest;
          state.proposerPostDelay = new Promise((resolve) => { releaseOldRequest = resolve; });
          await page.goto(`${origin}/new/proposer?template=tpl_qa_monthly&network=testnet`);
          await visible(page, 'Request a payment', 'heading');
          await page.getByRole('textbox', { name: 'Payment amount' }).fill('12.5');
          await page.getByRole('textbox', { name: 'On-chain memo (optional)' }).fill('INV-401');
          await page.getByRole('button', { name: 'Review request' }).click();
          const oldPost = page.waitForRequest((request) => request.url().endsWith('/api/request')
            && request.method() === 'POST');
          await page.getByRole('button', { name: 'Create signing request' }).click();
          await oldPost;
          state.templateOwner = addresses.bob;
          await page.evaluate((wallet) => window.__MST_QA_SET_WALLET__(wallet), walletState(addresses.bob));
          const amount = page.getByRole('textbox', { name: 'Payment amount' });
          await amount.waitFor({ state: 'visible' });
          assert.equal(await amount.inputValue(), '', 'An old wallet amount must not carry to a new wallet');
          assert.equal(await page.getByRole('textbox', { name: 'On-chain memo (optional)' }).inputValue(), '',
            'An old wallet memo must not carry to a new wallet');
          releaseOldRequest();
          await page.waitForTimeout(150);
          assert.equal(new URL(page.url()).pathname, '/new/proposer',
            'A late Request created by the old wallet must not hijack new wallet navigation');
          assert.equal(state.proposerRequestCount, 1);
          await snapshot(page, 'proposer-wallet-change-isolation', width);
        });
      }

      await run('delegated-wallet-revoked-cannot-create-payment', width, {
        wallet: walletState(addresses.carol),
        state: {
          templateOwner: addresses.carol,
          templates: [{ ...templateFixture(), ownerAddress: addresses.alice }],
          proposerGrants: [],
        },
      }, async ({ page, state }) => {
        await page.goto(`${origin}/new/proposer?template=tpl_qa_monthly&network=testnet`);
        await visible(page, 'Request a payment', 'heading');
        await page.getByRole('textbox', { name: 'Payment amount' }).fill('12.5');
        await page.getByRole('textbox', { name: 'On-chain memo (optional)' }).fill('INV-401');
        await page.getByRole('button', { name: 'Review request' }).click();
        await page.getByRole('button', { name: 'Create signing request' }).click();
        await visible(page, 'This wallet is not authorized for this Template.');
        assert.equal(state.proposerRequestCount, 0);
      });
    }

    await run('inbox-progress', width, {}, async ({ page }) => {
      await page.goto(`${origin}/inbox`);
      await visible(page, 'November supplier payment');
      const card = page.locator('.mst-inbox-list .mst-inbox-item').first();
      await card.getByText('Signer follow-up', { exact: true }).waitFor({ state: 'visible' });
      await card.getByText('Awaiting signature').waitFor({ state: 'visible' });
      await card.getByText('Email needs attention').waitFor({ state: 'visible' });
      await card.getByText('Follow up', { exact: true }).waitFor({ state: 'visible' });
      if (width >= 1280) {
        await visible(page, 'Signer follow-up', 'heading');
        await visible(page, 'Follow up with signers', 'button');
        await visible(page, 'Email failed');
      }
      await snapshot(page, 'inbox-progress', width);
    });

    if (width === 375) {
      await run('inbox-failed-email-needs-action', width, {}, async ({ page }) => {
        await page.goto(origin + '/inbox');
        await visible(page, 'November supplier payment');
        await visible(page, 'Follow-up needed');
        await page.getByRole('button', { name: 'Needs me 1' }).click();
        await visible(page, 'November supplier payment');
        await page.getByRole('button', { name: 'Waiting 0' }).click();
        await visible(page, 'Nothing is waiting.');
        await page.getByRole('button', { name: 'All 1' }).click();
        await visible(page, 'Follow-up needed');
        await snapshot(page, 'inbox-email-failure-needs-action', width);
      });

      await run('inbox-resolved-email-stays-waiting', width, {
        state: { inbox: (() => {
          const inbox = inboxFixture();
          inbox.requests[0].coordinationEvents.push({
            eventId: '99', type: 'notification_delivered', actorAddress: addresses.alice,
            subjectAddress: addresses.carol, occurredAt: now,
            notificationKind: 'signature_reminder',
          });
          return inbox;
        })() },
      }, async ({ page }) => {
        await page.goto(origin + '/inbox');
        await visible(page, 'November supplier payment');
        assert.equal(await page.getByText('Follow-up needed', { exact: true }).count(), 0);
        await page.getByRole('button', { name: 'Needs me 0' }).click();
        await visible(page, 'Nothing needs your action.');
        await page.getByRole('button', { name: 'Waiting 1' }).click();
        await visible(page, 'November supplier payment');
      });

      await run('inbox-requester-failed-email-needs-action', width, {
        wallet: walletState(addresses.bob),
        state: {
          inbox: {
            ...inboxFixture(addresses.bob),
            requests: [{
              ...requestFixture('awaiting_signatures', ['bob']), creatorAddress: addresses.alice,
              viewerAction: 'waiting_for_others',
              coordinationEvents: [
                { eventId: '1', type: 'signer_requested', actorAddress: addresses.bob, subjectAddress: addresses.carol, occurredAt: now },
                { eventId: '2', type: 'notification_failed', actorAddress: addresses.bob, subjectAddress: addresses.carol, occurredAt: now, notificationKind: 'signature_requested' },
              ],
            }],
          },
        },
      }, async ({ page }) => {
        await page.goto(origin + '/inbox');
        await visible(page, 'Follow-up needed');
        await page.getByRole('button', { name: 'Needs me 1' }).click();
        await visible(page, 'Signer follow-up');
        assert.equal(await page.getByText('View status', { exact: true }).count(), 0);
        await snapshot(page, 'inbox-requester-email-failure', width);
      });
    }

    if (width === 375 || width === 1280) {
      await run('inbox-follow-up-focus', width, {
        state: { request: { ...requestFixture('awaiting_signatures', ['alice']), creatorAddress: addresses.alice } },
      }, async ({ page }) => {
        await page.goto(origin + '/inbox');
        if (width >= 1280) await page.getByRole('button', { name: 'Follow up with signers' }).click();
        else await page.locator('.mst-inbox-list .mst-inbox-item').first().click();
        await visible(page, 'Your signature is recorded', 'heading');
        await page.locator('#proposal-signatures').waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.activeElement?.id === 'proposal-signatures');
        await snapshot(page, 'inbox-follow-up-focus', width);
      });
    }

    if (width === 375) {
      await run('inbox-recipient-has-no-creator-follow-up', width, {
        wallet: walletState(addresses.bob),
        state: {
          inbox: {
            ...inboxFixture(addresses.bob),
            requests: [{ ...requestFixture('awaiting_signatures', ['bob']), creatorAddress: addresses.alice, viewerAction: 'waiting_for_others', coordinationEvents: [] }],
          },
        },
      }, async ({ page }) => {
        await page.goto(origin + '/inbox');
        await visible(page, 'November supplier payment');
        assert.equal(await page.getByText('Signer follow-up', { exact: true }).count(), 0);
        await visible(page, 'View status');
        await snapshot(page, 'inbox-recipient-waiting', width);
      });

      await run('inbox-creator-can-invite-without-bearer-link', width, {
        state: {
          request: { ...requestFixture('awaiting_signatures', ['alice']), creatorAddress: addresses.alice },
          requestAccess: { shareable: false, activityBound: true },
          inviteContacts: true,
        },
      }, async ({ page, state }) => {
        await page.goto(origin + '/inbox');
        await page.locator('.mst-inbox-list .mst-inbox-item').first().click();
        await visible(page, 'Your signature is recorded', 'heading');
        await visible(page, 'Invite or remind signers', 'button');
        await page.getByRole('button', { name: 'Invite or remind signers' }).click();
        await visible(page, 'Invite signers', 'heading');
        await page.getByRole('checkbox', { name: 'Invite Bob' }).check();
        await page.getByRole('button', { name: 'Send 1 invitation' }).click();
        await visible(page, '1 signer invited. Follow their progress below.');
        assert.equal(state.assignments.length, 1);
        assert.equal(state.assignments[0].signerAddress, addresses.bob);
        assert.equal(state.submitCount, 0);
        await snapshot(page, 'inbox-creator-session-invite', width);
      });
    }

    await run('proposal-review-sign', width, {}, async ({ page, state }) => {
      await page.goto(`${origin}/s#${requestId}`);
      await visible(page, 'November supplier payment', 'heading');
      await page.getByRole('button', { name: 'Review transaction', exact: true }).click();
      assert.equal(new URL(page.url()).hash, `#${requestId}`);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'proposal-review');
      await snapshot(page, 'proposal-review', width);
      await page.getByRole('button', { name: 'Continue to signatures', exact: true }).click();
      await page.getByRole('button', { name: 'Sign', exact: true }).click();
      await visible(page, 'Your signature is recorded', 'heading');
      assert.equal(await page.getByRole('button', { name: 'Signed', exact: true }).count(), 0, 'Completed signature is status, not a disabled action');
      assert.equal(state.contributionCount, 1);
      assert.equal(state.submitCount, 0);
      await page.getByRole('button', { name: 'View signing progress', exact: true }).click();
      assert.equal(new URL(page.url()).hash, `#${requestId}`);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'proposal-signatures');
      await snapshot(page, 'proposal-signed', width);
    });

    await run('proposal-weighted-approval', width, {
      wallet: walletState(addresses.bob),
      state: {
        request: requestFixture('awaiting_signatures', ['alice']),
        horizonAccount: {
          account_id: addresses.source, sequence: '100', subentry_count: 2,
          num_sponsoring: 0, num_sponsored: 0,
          balances: [{ asset_type: 'native', balance: '1000.0000000' }],
          thresholds: { low_threshold: 1, med_threshold: 3, high_threshold: 3 },
          signers: [
            { key: addresses.alice, type: 'ed25519_public_key', weight: 2 },
            { key: addresses.bob, type: 'ed25519_public_key', weight: 1 },
            { key: addresses.carol, type: 'ed25519_public_key', weight: 1 },
          ],
        },
      },
    }, async ({ page }) => {
      await page.goto(origin + '/s#' + requestId);
      await visible(page, 'November supplier payment', 'heading');
      await page.getByRole('button', { name: 'Review transaction', exact: true }).click();
      await page.getByRole('button', { name: 'Continue to signatures', exact: true }).click();
      await visible(page, 'Your signature is needed', 'heading');
      await visible(page, 'Go to signing', 'button');
      await visible(page, 'Approval power required');
      await visible(page, '2 / 3');
      await visible(page, 'Needs 1 more approval power');
      const signBounds = await page.getByRole('button', { name: 'Sign', exact: true }).boundingBox();
      const ledgerBounds = await page.locator('.mst-signing-requirements').boundingBox();
      assert.ok(signBounds && ledgerBounds && signBounds.y < ledgerBounds.y, 'Primary Sign is before signer ledger');
      assert.ok((await page.locator('.mst-proposal-task__actions button').getAttribute('class') || '').includes('bg-[var(--color-paper)]'), 'Signing step jump is secondary, not a second primary button');
      await snapshot(page, 'proposal-weighted', width);
    });

    if (width === 375 || width === 1280) {
      await run('proposal-bulk-invites', width, {
        state: { inviteContacts: true, requestAccess: { shareable: true, activityBound: true } },
      }, async ({ page, state }) => {
        await page.goto(origin + '/s#' + requestId);
        await visible(page, 'November supplier payment', 'heading');
        await page.getByRole('button', { name: 'Review transaction', exact: true }).click();
        await page.getByRole('button', { name: 'Continue to signatures', exact: true }).click();
        await visible(page, 'Invite signers', 'heading');
        const signBounds = await page.getByRole('button', { name: 'Sign', exact: true }).boundingBox();
        const inviteBounds = await page.getByRole('region', { name: 'Invite and follow up with signers' }).boundingBox();
        assert.ok(signBounds && inviteBounds && signBounds.y < inviteBounds.y, 'Current signer action precedes invitation controls');
        const button = page.getByRole('button', { name: 'Select signers above' });
        assert.equal(await button.isDisabled(), true, 'No signer is preselected');
        await page.getByRole('checkbox', { name: 'Invite Bob' }).check();
        if (width === 1280) await page.getByRole('checkbox', { name: 'Invite Carol' }).check();
        const expected = width === 1280 ? 2 : 1;
        const sendLabel = 'Send ' + expected + ' invitation' + (expected === 1 ? '' : 's');
        await visible(page, sendLabel, 'button');
        await snapshot(page, 'proposal-invite-selection', width);
        await page.getByRole('button', { name: sendLabel }).click();
        try {
          await visible(page, expected + ' signer' + (expected === 1 ? '' : 's') + ' invited. Follow their progress below.');
        } catch {
          throw Error('Bulk invite result: ' + JSON.stringify({
            assignments: state.assignments.map((item) => item.signerAddress),
            feedback: await page.getByRole('status').allTextContents(),
            error: await page.getByRole('alert').allTextContents(),
          }));
        }
        assert.equal(state.assignments.length, expected);
        assert.equal(state.notifications.length, expected);
        await snapshot(page, 'proposal-invite-sent', width);
      });
    }

    if (width === 375 || width === 1280) {
      await run('proposal-creator-followup-no-email', width, {
        state: {
          request: { ...requestFixture('awaiting_signatures', ['alice']), creatorAddress: addresses.alice },
          requestAccess: { shareable: true, activityBound: true },
        },
      }, async ({ page, state }) => {
        await page.goto(origin + '/s#' + requestId);
        await visible(page, 'November supplier payment', 'heading');
        // An already-signed proposal opens at the signature status by default.
        await visible(page, 'Your signature is recorded', 'heading');
        await visible(page, 'Invite or remind signers', 'button');
        await page.getByRole('button', { name: 'Invite or remind signers' }).click();
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'proposal-signatures');
        await visible(page, 'Waiting for other signatures', 'heading');
        await visible(page, '1 more signer needs to sign. 2 eligible unsigned signers are listed below.');
        await visible(page, 'Follow up with signers', 'heading');
        await visible(page, 'Add a contact email to an eligible signer below, or share the private link.');
        assert.equal(state.assignments.length, 0, 'No automatic invitations without saved email and selection');
        await snapshot(page, 'proposal-owner-followup', width);
        if (width === 375) {
          await page.getByRole('button', { name: 'Edit contact Bob' }).click();
          const name = page.getByPlaceholder('e.g. Bob');
          const email = page.getByRole('textbox', { name: 'Notification email' });
          await name.fill('Bob');
          await email.fill('bob@example.org');
          state.contactSaveStatus = 503;
          await page.getByRole('button', { name: 'Save contact' }).click();
          await visible(page, 'Contact could not be saved.');
          assert.equal(await name.inputValue(), 'Bob', 'Contact name remains editable after a failed save');
          assert.equal(await email.inputValue(), 'bob@example.org', 'Contact email remains editable after a failed save');
          state.contactSaveStatus = 200;
          await page.getByRole('button', { name: 'Save contact' }).click();
          await visible(page, 'Invite signers', 'heading');
          await visible(page, 'Invite Bob', 'checkbox');
          assert.equal(state.contactSaveCount, 1);
          await page.getByRole('button', { name: 'Edit contact Bob' }).click();
          assert.equal(await page.getByRole('textbox', { name: 'Notification email' }).inputValue(), 'bob@example.org', 'Saved signer email remains editable');
          await page.getByRole('button', { name: 'Cancel contact editing' }).click();
          await snapshot(page, 'proposal-contact-recovery', width);
        }
      });
      await run('proposal-creator-reminder', width, {
        state: {
          request: { ...requestFixture('awaiting_signatures', ['alice']), creatorAddress: addresses.alice },
          requestAccess: { shareable: true, activityBound: true },
          inviteContacts: true,
          assignments: [{
            version: 1, signerAddress: addresses.bob, assignedByAddress: addresses.alice,
            assignedAt: now,
          }],
          notifications: [{
            channel: 'email', eventType: 'signature_requested', signerAddress: addresses.bob,
            actorAddress: addresses.alice, state: 'delivered', createdAt: now,
          }],
        },
      }, async ({ page, state }) => {
        await page.goto(origin + '/s#' + requestId);
        await visible(page, 'November supplier payment', 'heading');
        // An already-signed proposal opens at the signature status by default.
        await page.getByRole('button', { name: 'Invite or remind signers' }).click();
        await visible(page, 'Email delivered');
        assert.equal(await page.getByRole('button', { name: 'Ask Carol to sign' }).count(), 0, 'Invitation is offered only once, in the invitation chooser');
        const remind = page.getByRole('button', { name: 'Remind', exact: true });
        await remind.click();
        await visible(page, 'Reminder queued');
        assert.equal(state.remindCount, 1);
        assert.equal(state.assignments.length, 1);
        await snapshot(page, 'proposal-owner-reminder', width);
      });
      await run('proposal-creator-can-send-first-email-for-another-requester', width, {
        state: {
          request: { ...requestFixture('awaiting_signatures', ['alice']), creatorAddress: addresses.alice },
          requestAccess: { shareable: false, activityBound: true },
          inviteContacts: true,
          assignments: [{ version: 1, signerAddress: addresses.carol, assignedByAddress: addresses.bob, assignedAt: now }],
          notifications: [],
        },
      }, async ({ page, state }) => {
        await page.goto(origin + '/s#' + requestId);
        await visible(page, 'November supplier payment', 'heading');
        await page.getByRole('button', { name: 'Invite or remind signers' }).click();
        const notify = page.getByRole('button', { name: 'Send email', exact: true });
        await notify.waitFor({ state: 'visible' });
        await notify.click();
        await visible(page, 'Reminder queued');
        assert.equal(state.remindCount, 1, 'Creator can notify an eligible signer originally asked by someone else');
        assert.equal(state.assignments.length, 1);
        await snapshot(page, 'proposal-cross-requester-email', width);
      });
      await run('proposal-recipient-signed-waiting', width, {
        wallet: walletState(addresses.bob),
        state: {
          request: { ...requestFixture('awaiting_signatures', ['bob']), creatorAddress: addresses.alice },
          requestAccess: { shareable: true, activityBound: true },
        },
      }, async ({ page }) => {
        await page.goto(origin + '/s#' + requestId);
        await visible(page, 'November supplier payment', 'heading');
        // An already-signed proposal opens at the signature status by default.
        await visible(page, 'Your signature is recorded', 'heading');
        await visible(page, 'Your part is done for now. Other authorized signers must approve before this transaction can be submitted.');
        await visible(page, 'View signing progress', 'button');
        assert.equal(await page.getByRole('button', { name: 'Invite or remind signers' }).count(), 0);
        await visible(page, 'Back to Inbox', 'link');
        await snapshot(page, 'proposal-recipient-signed', width);
      });
    }

    await run('proposal-managed-submit', width, { state: { request: requestFixture('ready', ['alice', 'bob'], { mode: 'multisigtools' }) } }, async ({ page, state }) => {
      await page.goto(`${origin}/s#${requestId}`);
      await visible(page, 'Submit transaction', 'button');
      await visible(page, 'Submit this transaction to Stellar Testnet?');
      assert.equal(await page.getByRole('heading', { name: 'All required signatures are present' }).count(), 0, 'Ready Proposal must not repeat the authorization heading');
      assert.equal(await page.getByText('Authorization complete', { exact: true }).count(), 1, 'Ready Proposal must show authorization status only once');
      await page.getByRole('button', { name: 'Review details', exact: true }).click();
      await visible(page, 'Back to submission', 'button');
      await page.getByRole('button', { name: 'Back to submission', exact: true }).click();
      await visible(page, 'Submit transaction', 'button');
      await snapshot(page, 'proposal-ready', width);
      await page.getByRole('button', { name: 'Submit transaction', exact: true }).click();
      await visible(page, 'Confirmed on Stellar', 'heading');
      assert.equal(state.submitCount, 1, 'Final Submit issues exactly one PUT');
      await snapshot(page, 'proposal-confirmed', width);
    });
  }

  await run('templates-loading-and-owner-switch', 375, {}, async ({ page, state }) => {
    let release;
    state.templateDelay = new Promise((resolve) => { release = resolve; });
    state.templates = [templateFixture('Alice private template')];
    await page.goto(`${origin}/new`);
    await visible(page, 'Loading templates…');
    state.templateDelay = null;
    state.templates = [templateFixture('Bob private template')];
    state.templateOwner = addresses.bob;
    await page.evaluate((wallet) => window.__MST_QA_SET_WALLET__(wallet), walletState(addresses.bob));
    await visible(page, 'Bob private template', 'heading');
    release();
    assert.equal(await page.getByText('Alice private template', { exact: true }).count(), 0);
    await snapshot(page, 'templates-owner-switch', 375);
  });

  for (const status of [401, 403, 'wrong-owner']) {
    await run(`templates-${status}`, 375, { state: status === 'wrong-owner' ? { templateOwner: addresses.bob, templates: [templateFixture('Wrong owner secret')] } : { templateStatus: status } }, async ({ page, state }) => {
      await page.goto(`${origin}/new`);
      await visible(page, 'Confirm wallet', 'button');
      assert.equal(await page.getByText('Wrong owner secret', { exact: true }).count(), 0);
      state.templateStatus = 200;
      state.templateOwner = addresses.alice;
      state.templates = [];
      await page.getByRole('button', { name: 'Confirm wallet', exact: true }).click();
      await visible(page, 'No saved templates on Testnet yet.');
    });
  }

  for (const status of [500, 401, 403, 'wrong-owner', 'wrong-network']) {
    await run(`inbox-refresh-${status}`, 375, {}, async ({ page, state }) => {
      await page.goto(`${origin}/inbox`);
      await visible(page, 'November supplier payment');
      if (status === 'wrong-owner') state.inbox = { ...state.inbox, address: addresses.bob };
      else if (status === 'wrong-network') state.inbox = { ...state.inbox, network: 'public' };
      else state.inboxStatus = status;
      await page.getByRole('button', { name: 'Refresh inbox', exact: true }).click();
      await page.getByRole('alert').waitFor({ state: 'visible' });
      if (status === 500) {
        await visible(page, 'November supplier payment');
        await visible(page, 'Showing the last loaded proposals. Refresh to check their current status.');
      } else {
        assert.equal(await page.getByText('November supplier payment', { exact: true }).count(), 0);
        await visible(page, 'Confirm wallet', 'button');
        const requestsBeforeCancellation = state.inboxGetCount;
        await page.evaluate(() => { window.__MST_QA_CANCEL_UNLOCK__ = true; });
        await page.getByRole('button', { name: 'Confirm wallet', exact: true }).click();
        assert.equal(state.inboxGetCount, requestsBeforeCancellation, 'Cancelling wallet proof must not retry private data');
        await page.evaluate(() => { window.__MST_QA_CANCEL_UNLOCK__ = false; });
        state.inboxStatus = 200;
        state.inbox = inboxFixture();
        await page.getByRole('button', { name: 'Confirm wallet', exact: true }).click();
        await visible(page, 'November supplier payment');
      }
      assert.equal(await page.getByText("You're all caught up.", { exact: true }).count(), 0);
    });
  }

  await run('inbox-empty-filters', 375, { state: { inbox: { ...inboxFixture(), pending_count: 0, requests: [],
    action_counts: { actionRequired: 0, signatureNeeded: 0, readyToSubmit: 0, needsAttention: 0, waiting: 0, readyForExecutionRouting: 0 } } } }, async ({ page }) => {
    await page.goto(`${origin}/inbox?view=needs`);
    await visible(page, 'Nothing needs your action.', 'heading');
    await page.getByRole('button', { name: /^Waiting\s*0$/ }).click();
    await visible(page, 'Nothing is waiting.', 'heading');
    await page.getByRole('button', { name: /^All\s*0$/ }).click();
    await visible(page, "You're all caught up.", 'heading');
    await snapshot(page, 'inbox-empty', 375);
  });

  await run('proposal-private-entry', 375, { wallet: walletState('', false) }, async ({ page, state }) => {
    await page.goto(`${origin}/s#${requestId}`);
    await visible(page, 'Open your proposal', 'heading');
    await visible(page, 'Proposal QA00-0000-0000-0001');
    assert.deepEqual(await page.evaluate(() => window.__MST_QA_WALLET_CALLS__), []);
    assert.equal(state.requestGetCount, 0);
    assert.equal(new URL(page.url()).hash, `#${requestId}`);
    await snapshot(page, 'proposal-private-entry', 375);
    await page.getByRole('button', { name: 'Open proposal', exact: true }).click();
    await visible(page, 'November supplier payment', 'heading');
  });

  await run('proposal-choose-submission', 375, { state: { request: requestFixture('ready', ['alice', 'bob']) } }, async ({ page, state }) => {
    await page.goto(`${origin}/s#${requestId}`);
    await visible(page, 'Choose how to submit', 'heading');
    assert.equal(await page.getByRole('button', { name: 'Submit transaction', exact: true }).count(), 0);
    await page.getByRole('button', { name: /MultiSigTools submits/ }).click();
    await visible(page, 'Submit transaction', 'button');
    assert.equal(state.submitCount, 0);
    await page.getByRole('button', { name: 'Submit transaction', exact: true }).click();
    await visible(page, 'Confirmed on Stellar', 'heading');
    assert.equal(state.submitCount, 1);
  });

  await run('proposal-external-submission', 375, { state: { request: requestFixture('ready', ['alice', 'bob'], { mode: 'external', executor: { id: 'fixture-service', label: 'Fixture service' } }) } }, async ({ page, state }) => {
    await page.goto(`${origin}/s#${requestId}`);
    await visible(page, 'Waiting for the originating service', 'heading');
    await visible(page, 'Fixture service will re-check its business state and submit when its execution conditions are satisfied. MultiSigTools will not broadcast this transaction.');
    assert.equal(await page.getByRole('button', { name: 'Submit transaction', exact: true }).count(), 0);
    assert.equal(state.submitCount, 0);
    await snapshot(page, 'proposal-external', 375);
  });

  for (const status of ['expired', 'blocked', 'stale']) {
    await run(`proposal-${status}`, 375, { state: { request: requestFixture(status) } }, async ({ page, state }) => {
      await page.goto(`${origin}/s#${requestId}`);
      await visible(page, 'This proposal cannot continue in MultiSigTools.');
      await page.getByRole('button', { name: 'Review the issue', exact: true }).click();
      assert.equal(new URL(page.url()).hash, `#${requestId}`);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'proposal-issue');
      await page.getByText('Advanced', { exact: true }).click();
      assert.equal(await page.getByText('Sign proposal', { exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Add signed XDR', exact: true }).count(), 0);
      assert.equal(state.contributionCount + state.submitCount, 0);
      await snapshot(page, `proposal-${status}`, 375);
    });
  }

  await run('proposal-closed-without-ledger-result', 375, { state: { requestError: { error: 'The capability is closed.', code: 'request_capability_closed', network: 'testnet' } } }, async ({ page }) => {
    await page.goto(`${origin}/s#${requestId}${capability}`);
    await visible(page, 'This private link is closed', 'heading');
    assert.equal(await page.getByText('Transaction confirmed', { exact: true }).count(), 0);
    await snapshot(page, 'proposal-closed-unknown', 375);
  });

  await run('proposal-retain-after-proof', 375, { wallet: walletState('', false), state: { requestAccess: { shareable: true, activityBound: false } } }, async ({ page, state }) => {
    await page.goto(`${origin}/s#${requestId}${capability}`);
    await visible(page, 'Keep this transaction in Activity');
    assert.deepEqual(await page.evaluate(() => window.__MST_QA_WALLET_CALLS__), []);
    const saved = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/request'
      && response.request().method() === 'PATCH' && response.request().postDataJSON()?.retainActivity === true);
    await page.getByRole('button', { name: 'Save to Activity', exact: true }).click();
    await saved;
    await page.getByRole('button', { name: 'Save to Activity', exact: true }).waitFor({ state: 'detached' });
    await visible(page, 'November supplier payment', 'heading');
    assert.equal(state.retentionCount, 1, 'One explicit proof saves Activity once');
    assert.equal(state.requestAccess.activityBound, true);
    assert.equal(await page.getByText(/Not saved to Activity/).count(), 0);
    assert.equal(state.contributionCount + state.submitCount, 0);
    await snapshot(page, 'proposal-retained', 375);
  });

  for (const status of [403, 500]) {
    await run(`proposal-history-preview-${status}`, 375, { wallet: walletState(addresses.bob) }, async ({ page, state }) => {
      const delayed = Promise.withResolvers();
      const preview = { ...requestFixture(), template: { id: 'tpl_qa_private', version: 1, name: 'Alice private history proposal' } };
      state.requestGetResponse = () => ({ status, delay: delayed.promise, body: { error: 'Fixture access failed.', code: status === 403 ? 'request_access_denied' : 'request_failed' } });
      await page.goto(`${origin}/new`);
      await visible(page, 'New proposal', 'heading');
      await page.evaluate(() => {
        window.__MST_QA_PRIVATE_LEAKS__ = [];
        new MutationObserver(() => {
          if (document.body.textContent.includes('Alice private history proposal')) window.__MST_QA_PRIVATE_LEAKS__.push('preview');
        }).observe(document.body, { childList: true, characterData: true, subtree: true });
      });
      const requested = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/request');
      await page.evaluate(async ({ preview, reviewedBy }) => {
        const { navigateWorkspace } = await import('/src/workspaceNavigation.ts');
        navigateWorkspace('/s', { hash: preview.id, state: { requestPreview: preview, requestJustCreated: true, requestReviewedByAddress: reviewedBy } });
      }, { preview, reviewedBy: addresses.alice });
      await requested;
      assert.equal(await page.getByText('Alice private history proposal', { exact: true }).count(), 0);
      delayed.resolve();
      if (status === 403) await visible(page, 'This wallet cannot open this proposal', 'heading');
      else await page.getByRole('alert').waitFor({ state: 'visible' });
      assert.deepEqual(await page.evaluate(() => window.__MST_QA_PRIVATE_LEAKS__), []);
      assert.equal(await page.getByText('Alice private history proposal', { exact: true }).count(), 0);
      await snapshot(page, `proposal-preview-denied-${status}`, 375);
    });
  }

  await run('proposal-late-other-wallet-response', 375, {}, async ({ page, state }) => {
    const delayed = Promise.withResolvers();
    const completed = Promise.withResolvers();
    const privateRequest = { ...requestFixture(), template: { id: 'tpl_qa_private', version: 1, name: 'Alice delayed private proposal' } };
    state.requestGetResponse = (request) => request.headers()['x-multisig-session-address'] === addresses.alice
      ? { delay: delayed.promise, onDone: completed.resolve, body: { request: privateRequest, access: state.requestAccess } }
      : { status: 403, body: { error: 'Fixture signer denied.', code: 'request_access_denied' } };
    const requested = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/request');
    await page.goto(`${origin}/s#${requestId}`);
    await requested;
    await page.evaluate((wallet) => window.__MST_QA_SET_WALLET__(wallet), walletState(addresses.bob));
    await visible(page, 'This wallet cannot open this proposal', 'heading');
    delayed.resolve();
    // A cancelled request may never call route.fulfill(), so onDone is not
    // guaranteed. A bounded settle still lets the UI reject stale data.
    await Promise.race([
      completed.promise,
      new Promise((resolve) => setTimeout(resolve, 750)),
    ]);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.getByText('Alice delayed private proposal', { exact: true }).count(), 0);
    await visible(page, 'This wallet cannot open this proposal', 'heading');
    await snapshot(page, 'proposal-late-other-wallet', 375);
  });

  await run('proposal-denial-invalidates-same-wallet-poll', 375, {}, async ({ page, state }) => {
    const delayed = Promise.withResolvers();
    const completed = Promise.withResolvers();
    const pollSelected = Promise.withResolvers();
    let phase = 'initial';
    state.requestGetResponse = () => {
      if (phase === 'poll') {
        pollSelected.resolve();
        return { delay: delayed.promise, onDone: completed.resolve, body: { request: state.request, access: state.requestAccess } };
      }
      if (phase === 'denied') return { status: 403, body: { error: 'Fixture signer revoked.', code: 'request_access_denied' } };
      return { body: { request: state.request, access: state.requestAccess } };
    };
    await page.clock.install();
    await page.goto(`${origin}/s#${requestId}`);
    await visible(page, 'November supplier payment', 'heading');
    phase = 'poll';
    const poll = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/request');
    await page.clock.fastForward(30_100);
    await poll;
    // A request event can precede its route handler. Wait until the old poll's
    // response is actually captured before making the explicit refresh fail.
    await pollSelected.promise;
    phase = 'denied';
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await visible(page, 'This wallet cannot open this proposal', 'heading');
    delayed.resolve();
    await completed.promise;
    await page.clock.runFor(50);
    assert.equal(await page.getByText('November supplier payment', { exact: true }).count(), 0);
    await visible(page, 'This wallet cannot open this proposal', 'heading');
    await snapshot(page, 'proposal-same-wallet-denied', 375);
  });

  await run('proposal-creator-review-handoff', 375, {}, async ({ page, state }) => {
    await page.goto(`${origin}/new`);
    await visible(page, 'New proposal', 'heading');
    await page.evaluate(async ({ preview, reviewedBy }) => {
      const { navigateWorkspace } = await import('/src/workspaceNavigation.ts');
      navigateWorkspace('/s', { hash: preview.id, state: { requestPreview: preview, requestJustCreated: true, requestReviewedByAddress: reviewedBy } });
    }, { preview: state.request, reviewedBy: addresses.alice });
    await visible(page, 'Your signature is needed', 'heading');
    await visible(page, 'Sign', 'button');
    assert.ok(state.requestGetCount > 0, 'Creator handoff still checks current private access');
    assert.equal(await page.getByRole('button', { name: 'Continue to signatures', exact: true }).count(), 0);
  });
} finally {
  await browser.close();
  await server.close();
  let commit = process.env.MST_QA_COMMIT;
  if (!commit) {
    try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { commit = 'unavailable; set MST_QA_COMMIT for a mounted worktree'; }
  }
  const report = { commit,
    generatedAt: new Date().toISOString(), method: 'Actual React UI in Chromium; fixture wallet, API, and Horizon; no broadcast or email.', widths,
    passed: results.filter((item) => item.passed).length, failed: results.filter((item) => !item.passed).length, unexpectedRequests, pageErrors, results };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, failed: report.failed, unexpectedRequests, pageErrors, output }));
  if (report.failed || unexpectedRequests.length) process.exitCode = 1;
}
