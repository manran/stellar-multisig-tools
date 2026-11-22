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
const userForAddress = (address) => {
  const n = Object.values(addresses).indexOf(address);
  return `00000000-0000-4000-8000-${String(n < 0 ? 99 : n + 1).padStart(12, '0')}`;
};
const passkeyUserId = '00000000-0000-4000-8000-000000000042';
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
    passkeyLoggedIn: false, passkeyUserId, invitationCreated: 0, invitationsRevoked: 0,
    inviteToken: 'A'.repeat(43), inviteAvailable: true,
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
    if (url.pathname === '/api/identity') {
      const selected = request.headers()['x-multisig-session-address'];
      if (request.method() === 'DELETE') {
        state.passkeyLoggedIn = false;
        return json({ authenticated: false });
      }
      if (request.method() === 'GET') {
        if (url.searchParams.get('view') === 'activity') {
          return json({ userId: state.passkeyUserId, network: 'testnet', requests: state.identityHistory ?? [] });
        }
        if (state.passkeyLoggedIn) {
          const linkedWallet = Boolean(selected && state.walletLinkCount > 0);
          return json({ authenticated: true,
            identity: { network: 'testnet', method: 'passkey', userId: state.passkeyUserId,
              ...(linkedWallet ? { address: selected } : {}) },
            credentials: [{ kind: 'passkey', id: 'passkey-qa' },
              ...(linkedWallet ? [{ kind: 'stellar_wallet', address: selected }] : [])],
          });
        }
        if (selected) {
          return json({ authenticated: true,
            identity: { network: 'testnet', method: 'stellar_wallet', userId: userForAddress(selected), address: selected },
            credentials: [{ kind: 'stellar_wallet', address: selected }],
          });
        }
        return json({ authenticated: false });
      }
      const body = request.postDataJSON();
      assert.equal(body.network, 'testnet');
      if (body.action === 'invitation_preview') {
        assert.equal(body.token, state.inviteToken);
        return state.inviteAvailable
          ? json({ invitation: { network: 'testnet', templateId: 'tpl_qa_monthly', templateName: 'Monthly suppliers' } })
          : json({ error: 'Invitation expired' }, 404);
      }
      if (body.action === 'create_invitation') {
        assert.equal(selected, addresses.alice);
        state.invitationCreated += 1;
        return json({ token: state.inviteToken, expiresInSeconds: 86400 }, 201);
      }
      if (body.action === 'invitation_accept') {
        assert.equal(body.token, state.inviteToken);
        state.inviteAvailable = false;
        return json({ accepted: true, userId: state.passkeyUserId });
      }
      if (body.action === 'revoke_user_grant') return json({ revoked: true });
      if (body.action === 'revoke_invitation') {
        state.inviteAvailable = false;
        state.invitationsRevoked += 1;
        return json({ revoked: true });
      }
      if (body.action === 'link_wallet') {
        assert.equal(selected, addresses.alice, 'Wallet must be verified and selected before binding');
        assert.equal(state.passkeyLoggedIn, true);
        if (state.walletLinkConflict) {
          return json({ code: 'wallet_already_linked',
            error: 'This wallet is already linked to a different MST user.' }, 409);
        }
        state.walletLinkCount = (state.walletLinkCount ?? 0) + 1;
        return json({ linked: true, walletAddress: selected, userId: state.passkeyUserId });
      }
      return json({ error: 'Unsupported identity fixture' }, 400);
    }
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
      const selected = request.headers()['x-multisig-session-address'];
      const passkeyOnly = state.passkeyLoggedIn && (!selected || !(state.walletLinkCount > 0));
      const response = { address: passkeyOnly ? null : state.templateOwner,
        userId: state.passkeyLoggedIn ? state.passkeyUserId : userForAddress(selected),
        templates: state.templates };
      const status = state.templateStatus;
      if (state.templateDelay) await state.templateDelay;
      return json(status === 200 ? response : { error: 'Fixture template load failure.' }, status);
    }
    if (url.pathname === '/api/inbox') {
      state.inboxGetCount++;
      const selected = request.headers()['x-multisig-session-address'];
      const inbox = state.passkeyLoggedIn
        ? { ...state.inbox, address: selected && state.walletLinkCount > 0 ? selected : null, userId: state.passkeyUserId }
        : { ...state.inbox, userId: userForAddress(selected) };
      return json(state.inboxStatus === 200 ? inbox : { error: 'Fixture inbox load failure.' }, state.inboxStatus);
    }
    if (url.pathname === '/api/address-book') {
      if (request.method() === 'DELETE') {
        const body = request.postDataJSON();
        state.addressEntries = (state.addressEntries ?? []).filter((entry) =>
          entry.address !== body.address || (entry.subject_type ?? entry.subjectType) !== body.subject_type);
        return json({ deleted: true });
      }
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
    if (url.pathname === '/api/contract-interface') return json({
      contractId: url.searchParams.get('contract'), network: 'testnet', methods: [],
      abi: { schema: 'fresnica-soroban-abi-v1' },
    });
    if (url.pathname === '/api/contracts') {
      if (request.method() === 'PUT') {
        const body = request.postDataJSON();
        assert.equal(body.network, 'testnet');
        const contract = { contractId: body.contractId, network: 'testnet', createdAt: now, updatedAt: now };
        state.savedContracts = [...(state.savedContracts ?? []), contract];
        return json({ contract });
      }
      if (request.method() === 'DELETE') {
        const body = request.postDataJSON();
        state.savedContracts = (state.savedContracts ?? []).filter(c => c.contractId !== body.contractId);
        return json({ deleted: true });
      }
      return json({ contracts: state.savedContracts ?? [] });
    }
    if (url.pathname === '/api/treasury-box') return json({ metadataByAccount: {} });
    if (url.pathname === '/api/runtime-config') return json({ stellarNetwork: 'testnet', fixedNetwork: 'testnet', capabilities: { classicManagedExecution: { testnet: false, public: false } } });
    if (url.pathname === '/api/request') {
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        assert.equal(request.headers()['x-multisig-session-address'], state.passkeyLoggedIn ? undefined : addresses.carol);
        assert.equal(request.headers()['x-multisig-request-id'], undefined);
        assert.equal(body.network, 'testnet');
        assert.equal(body.xdr, undefined, 'Non-signer never submits arbitrary XDR');
        assert.equal(body.templatePayment?.amount, '12.5');
        assert.equal(body.templatePayment?.memo, 'INV-401');
        assert.deepEqual(body.templatePayment?.template, { id: 'tpl_qa_monthly', version: 1 });
        assert.deepEqual(Object.keys(body.templatePayment).sort(), ['amount', 'memo', 'template']);
        if (!state.proposerGrants.includes(addresses.carol) && !state.passkeyLoggedIn) {
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
          ...requestFixture('awaiting_signatures'),
          ...(state.passkeyLoggedIn ? { proposerUserId: state.passkeyUserId } : { proposerAddress: addresses.carol }),
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
  await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true, timeout: 30_000, animations: 'disabled' });
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
    for (const [tool, route] of [
      ['contracts', '/contracts'],
      ['treasuries', '/treasury'],
      ['contacts', '/address-book'],
      ['agent-access', '/agent-access'],
    ]) {
      await run('tool-login-entry-' + tool, width, {
        wallet: walletState('', false), state: { passkeyLoggedIn: false },
      }, async ({ page }) => {
        await page.goto(origin + route);
        await visible(page, 'Sign in to continue', 'heading');
        const link = page.getByRole('link', { name: 'Sign in / Sign up', exact: true });
        const href = new URL(await link.getAttribute('href'), origin);
        assert.equal(href.pathname, '/identity');
        assert.equal(href.searchParams.get('next'), route);
        assert.equal(await page.getByRole('button', { name: 'Connect Stellar wallet' }).count(), 0);
        await snapshot(page, 'tool-access-' + tool, width);
        await link.click();
        await visible(page, 'Sign in or sign up', 'heading');
        assert.equal(new URL(page.url()).searchParams.get('next'), route);
        assert.deepEqual(await page.evaluate(() => window.__MST_QA_WALLET_CALLS__), []);
        await snapshot(page, 'tool-sign-in-' + tool, width);
      });
    }

    if (width === 375) {
      for (const [tool, route] of [
        ['contracts', '/contracts'],
        ['treasuries', '/treasury'],
        ['contacts', '/address-book'],
        ['agent-access', '/agent-access'],
      ]) {
        await run('tool-passkey-needs-wallet-' + tool, width, {
          wallet: walletState('', false), state: { passkeyLoggedIn: true },
        }, async ({ page }) => {
          await page.goto(origin + route);
          if (tool === 'contracts') {
            await visible(page, 'No saved contracts yet', 'heading');
            assert.equal(await page.getByRole('button', { name: 'Connect Stellar wallet' }).count(), 0);
          } else if (tool === 'contacts') {
            await visible(page, 'Add contact', 'button');
            assert.equal(await page.getByRole('button', { name: 'Connect Stellar wallet' }).count(), 0);
          } else {
            await visible(page, 'Connect Stellar wallet', 'heading');
            await visible(page, 'Connect Stellar wallet', 'button');
          }
          assert.equal(await page.getByRole('link', { name: 'Sign in / Sign up' }).count(), 0);
          await snapshot(page, 'tool-needs-wallet-' + tool, width);
        });
      }
      await run('passkey-only-contact-create-edit-delete', width, {
        wallet: walletState('', false), state: { passkeyLoggedIn: true, addressEntries: [] },
      }, async ({ page, state }) => {
        await page.goto(origin + '/address-book');
        await page.getByRole('button', { name: 'Add contact' }).click();
        await page.getByRole('textbox', { name: 'Contact address' }).fill(addresses.recipient);
        await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Passkey Vendor');
        await page.getByRole('button', { name: 'Save contact' }).click();
        await page.getByRole('button', { name: 'Rename Passkey Vendor' }).waitFor();
        assert.equal(state.contactSaveCount, 1);
        assert.equal(state.addressEntries?.[0]?.label, 'Passkey Vendor');
        const row = page.locator('.mst-address-row').filter({ hasText: addresses.recipient });
        await row.getByRole('button', { name: 'Rename Passkey Vendor' }).click();
        await row.getByRole('button', { name: 'Remove name' }).click();
        await row.getByRole('button', { name: 'Rename Passkey Vendor' }).waitFor({ state: 'detached' });
        assert.equal(state.addressEntries?.length, 0);
        assert.deepEqual(await page.evaluate(() => window.__MST_QA_WALLET_CALLS__), []);
        await snapshot(page, 'passkey-only-contacts', width);
      });
      await run('passkey-only-contract-save-and-forget', width, {
        wallet: walletState('', false), state: { passkeyLoggedIn: true, savedContracts: [] },
      }, async ({ page, state }) => {
        const contract = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
        await page.goto(origin + '/contract?contract=' + contract + '&network=testnet');
        await page.getByRole('button', { name: 'Save contract' }).click();
        await page.getByRole('button', { name: 'Forget contract' }).waitFor();
        assert.equal(state.savedContracts?.length, 1);
        await page.getByRole('button', { name: 'Forget contract' }).click();
        await page.waitForURL(url => url.pathname === '/contracts');
        await visible(page, 'No saved contracts yet', 'heading');
        assert.equal(state.savedContracts?.length, 0);
        assert.deepEqual(await page.evaluate(() => window.__MST_QA_WALLET_CALLS__), []);
        await snapshot(page, 'passkey-only-contracts', width);
      });
      await run('tool-passkey-can-verify-wallet', width, {
        wallet: walletState('', false), state: { passkeyLoggedIn: true },
      }, async ({ page }) => {
        await page.goto(origin + '/treasury');
        await page.getByRole('button', { name: 'Connect Stellar wallet' }).click();
        await visible(page, 'Treasuries', 'heading');
        assert.deepEqual(await page.evaluate(() => window.__MST_QA_WALLET_CALLS__), ['unlock']);
      });
      await run('tool-login-returns-to-selected-tool', width, {
        wallet: walletState('', false), state: { passkeyLoggedIn: false },
      }, async ({ page }) => {
        await page.goto(origin + '/contracts');
        await page.getByRole('link', { name: 'Sign in / Sign up', exact: true }).click();
        await page.getByRole('button', { name: 'Sign in with Stellar wallet' }).click();
        await page.waitForURL((url) => url.pathname === '/contracts', { timeout: 15_000 });
        await visible(page, 'No saved contracts yet', 'heading');
      });
    }

    await run('unified-header-account-entry', width, {
      wallet: walletState('', false),
      state: { passkeyLoggedIn: false },
    }, async ({ page }) => {
      await page.goto(`${origin}/`);
      const entry = page.getByRole('link', { name: 'Sign in or sign up' });
      await entry.waitFor();
      assert.equal((await entry.innerText()).trim(), 'Sign in / Sign up');
      await entry.click();
      await visible(page, 'Sign in or sign up', 'heading');
      await visible(page, 'Create Passkey account', 'button');
      assert.deepEqual(await page.evaluate(() => window.__MST_QA_WALLET_CALLS__), [], 'Account entry must not open a wallet');
      await snapshot(page, 'header-account-entry', width);
    });

    await run('walletless-account-offers-both-login-methods', width, {
      wallet: walletState('', false),
      state: { passkeyLoggedIn: false },
    }, async ({ page }) => {
      await page.goto(`${origin}/identity`);
      await visible(page, 'Sign in or sign up', 'heading');
      await visible(page, 'Sign in with Passkey', 'button');
      await visible(page, 'Create Passkey account', 'button');
      await visible(page, 'Sign in with Stellar wallet', 'button');
      assert.equal(await page.getByRole('button', { name: 'Sign with Stellar wallet' }).count(), 0);
      await snapshot(page, 'walletless-login-options', width);
    });

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
      await run('overview-workbench', width, {}, async ({ page }) => {
        await page.goto(origin + '/');
        await visible(page, 'Overview', 'heading');
        await visible(page, 'Needs your attention');
        await snapshot(page, 'overview', width);
        if (width === 375) {
          const more = page.getByRole('button', { name: 'More workspace tools' });
          await more.click();
          await visible(page, 'Activity', 'menuitem');
          await visible(page, 'Smart Contracts', 'menuitem');
          await visible(page, 'Treasuries', 'menuitem');
          await visible(page, 'Address Book', 'menuitem');
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
        await run('contacts-identity-scope', width, {}, async ({ page }) => {
          await page.goto(origin + '/address-book');
          await visible(page, 'Address Book', 'heading');
          await page.evaluate((wallet) => window.__MST_QA_SET_WALLET__(wallet),
            { ...walletState(addresses.bob), unlockedAddress: addresses.alice });
          await visible(page, 'Sign in to continue', 'heading');
          assert.equal(await page.getByRole('button', { name: 'Add contact' }).count(), 0);
          assert.equal(await page.getByText('Saved contact details are private').count(), 0);
        });
      }

      await run('contacts-search-and-save', width, {}, async ({ page, state }) => {
        await page.goto(origin + '/address-book');
        await visible(page, 'Address Book', 'heading');
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
          await visible(page, 'Address Book', 'heading');
          const bob = page.locator('.mst-address-row').filter({ hasText: addresses.bob });
          const carol = page.locator('.mst-address-row').filter({ hasText: addresses.carol });
          await bob.getByRole('button', { name: 'Edit contact Bob' }).click();
          await bob.getByPlaceholder('e.g. Bob').fill('Bob operations');
          await bob.getByRole('textbox', { name: 'Notification email' }).fill('bob.ops@example.org');
          const bobSaved = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/address-book'
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

        await run('contacts-inflight-save-does-not-leak-across-users', width, {}, async ({ page, state }) => {
          let releaseAlice;
          state.contactSaveDelays = {
            [addresses.carol]: new Promise((resolve) => { releaseAlice = resolve; }),
          };
          await page.goto(origin + '/address-book');
          await visible(page, 'Address Book', 'heading');
          const carol = page.locator('.mst-address-row').filter({ hasText: addresses.carol });
          await carol.getByRole('button', { name: 'Edit contact Carol' }).click();
          await carol.getByPlaceholder('e.g. Bob').fill('Alice private draft');
          await carol.getByRole('textbox', { name: 'Notification email' }).fill('alice-only@example.org');
          const aliceSaved = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/address-book'
            && response.request().method() === 'PUT' && response.request().postDataJSON().address === addresses.carol);
          await carol.getByRole('button', { name: 'Save contact' }).click();

          // Bob's contact store is empty. Alice's pending response must stay in Alice's scope.
          state.addressEntries = [];
          const bobLoaded = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/address-book'
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
        const grant = page.getByText('Payment request access');
        await grant.click();
        const address = page.getByRole('textbox', { name: 'Proposer G address' });
        await address.fill(addresses.carol);
        await page.getByRole('button', { name: 'Allow', exact: true }).click();
        await page.getByRole('button', { name: 'Revoke', exact: true }).waitFor({ state: 'visible' });
        assert.equal(state.proposerGrantCount, 1);
        assert.deepEqual(state.proposerGrants, [addresses.carol]);
        await snapshot(page, 'template-proposer-grant', width);
        await page.getByRole('button', { name: 'Revoke', exact: true }).click();
        await page.getByRole('button', { name: 'Revoke', exact: true }).waitFor({ state: 'hidden' });
        assert.equal(state.proposerGrantCount, 2);
        assert.deepEqual(state.proposerGrants, []);
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
        await visible(page, 'Copy signer link');
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