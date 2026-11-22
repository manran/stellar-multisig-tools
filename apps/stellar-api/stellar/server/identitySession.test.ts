import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk/base';
import { IdentityError } from './identityStore.js';
import type { PostgresIdentityStore } from './identityStore.js';
import type { AuthStore, StoredAuthServerKey } from './authStore.js';
import { identityCookie, issuePasskeySession, passkeyIdentityFromRequest } from './identityService.js';

function memoryAuth(): AuthStore {
  let key: StoredAuthServerKey | null = null;
  return {
    async getServerKey() { return key; },
    async createServerKey(item) { key ??= item; },
    async claimChallengeRedemption() { return true; },
  };
}

function request(token?: string): Request {
  return new Request('http://localhost/api/identity?network=testnet', {
    headers: token ? { cookie: identityCookie(token) } : undefined,
  });
}

test('Passkey cookie stores only signed stable User ID and cannot grant Stellar wallet proof', async () => {
  const signer = memoryAuth();
  const userId = randomUUID();
  const credentialId = 'passkey_test_1';
  const credential = {
    id: randomUUID(), userId, kind: 'passkey' as const, subject: credentialId,
    publicKey: Uint8Array.of(1, 2, 3), counter: 0, transports: [],
  };
  const identityStore = {
    async findCredential(kind: string, subject: string) {
      return kind === credential.kind && subject === credential.subject ? credential : null;
    },
  } as PostgresIdentityStore;
  const token = await issuePasskeySession(request(), userId, credentialId, 'testnet', signer);
  assert.equal(token.split('.').length, 3);
  assert.equal(Buffer.from(token.split('.')[1], 'base64url').toString().includes('G[A-Z2-7]'), false);
  const cookie = identityCookie(token);
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  const resolved = await passkeyIdentityFromRequest(request(token), identityStore, signer);
  assert.deepEqual(resolved && { userId: resolved.userId, network: resolved.network, method: resolved.method },
    { userId, network: 'testnet', method: 'passkey' });
  assert.equal(resolved?.address, undefined);
  assert.equal(await passkeyIdentityFromRequest(request(), identityStore, signer), null);

  // A forged token with a different signer is not a login, even with valid fields.
  const fakeSigner = Keypair.random();
  const chunks = token.split('.');
  const forged = `${chunks[0]}.${chunks[1]}.${Buffer.from(fakeSigner.sign(Buffer.from(`${chunks[0]}.${chunks[1]}`))).toString('base64url')}`;
  await assert.rejects(() => passkeyIdentityFromRequest(request(forged), identityStore, signer),
    (cause: unknown) => cause instanceof IdentityError && cause.code === 'identity_session_invalid');
  const altered = `${chunks[0]}.${chunks[1]}.${chunks[2][0] === 'A' ? 'B' : 'A'}${chunks[2].slice(1)}`;
  await assert.rejects(() => passkeyIdentityFromRequest(request(altered), identityStore, signer), IdentityError);
});

test('Passkey cookie becomes unusable when credential is revoked', async () => {
  const signer = memoryAuth();
  const userId = randomUUID();
  const token = await issuePasskeySession(request(), userId, 'revoked_credential', 'testnet', signer);
  const store = { async findCredential() { return null; } } as unknown as PostgresIdentityStore;
  await assert.rejects(() => passkeyIdentityFromRequest(request(token), store, signer),
    (cause: unknown) => cause instanceof IdentityError && cause.code === 'identity_session_revoked');
});

test('walletless visitor may create an MST Passkey without a Template invitation', async () => {
  const { startPasskeyRegistration } = await import('./identityService.js');
  let saved: { userId: string | null; invitationId: string | null; network: string } | undefined;
  const store = {
    async createChallenge(value: { challenge: string; purpose: string; userId: string | null; invitationId: string | null; network: string }) {
      saved = value;
      return { id: randomUUID(), ...value };
    },
  } as unknown as PostgresIdentityStore;
  const options = await startPasskeyRegistration(
    new Request('https://stellar-testnet.multisig.tools/api/identity'), store, 'testnet',
  );
  assert.ok(options.challengeId);
  assert.ok(options.options.challenge);
  assert.ok(saved?.userId);
  assert.equal(saved?.invitationId, null);
  assert.equal(saved?.network, 'testnet');
  assert.equal(options.options.authenticatorSelection?.userVerification, 'required');
});

test('expired login cannot turn a registration challenge into an extra Passkey on an existing user', async () => {
  const { finishPasskeyRegistration } = await import('./identityService.js');
  const userId = randomUUID();
  const request = new Request('https://stellar-testnet.multisig.tools/api/identity');
  const expiredSessionStore = {
    async consumeChallenge() {
      return { id: randomUUID(), challenge: 'test-challenge', purpose: 'register', userId,
        invitationId: null, network: 'testnet' };
    },
    async userExists(value: string) { return value === userId; },
  } as unknown as PostgresIdentityStore;
  await assert.rejects(
    () => finishPasskeyRegistration(request, expiredSessionStore, 'test-challenge-id', {} as Parameters<typeof finishPasskeyRegistration>[3]),
    (cause: unknown) => cause instanceof IdentityError && cause.code === 'registration_not_authorized',
  );
});
