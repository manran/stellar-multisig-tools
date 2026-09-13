import assert from 'node:assert/strict';
import test from 'node:test';
import { FeeBumpTransaction, Keypair, Networks, TransactionBuilder, hash } from '@stellar/stellar-sdk/base';
import type { StellarNetwork } from '../src/stellar/types.js';
import type { AuthStore, StoredAuthServerKey, StoredRedeemedChallenge } from './authStore.js';
import {
  AuthServiceError,
  createAuthChallenge,
  exchangeAuthChallenge,
  exchangeAuthMessageChallenge,
  privateWorkspaceSessionFromRequest,
  requirePrivateWorkspaceSession,
  resolveUnlockTtlSeconds,
  verifyAuthToken,
} from './authService.js';

const SEP53_PREFIX = Buffer.from('Stellar Signed Message:\n', 'utf8');

class MemoryAuthStore implements AuthStore {
  key: StoredAuthServerKey | null = null;
  redeemed = new Map<string, StoredRedeemedChallenge>();

  async getServerKey() { return this.key; }
  async createServerKey(key: StoredAuthServerKey) {
    if (this.key) throw new Error('already exists');
    this.key = key;
  }
  async claimChallengeRedemption(redemption: StoredRedeemedChallenge) {
    if (this.redeemed.has(redemption.transactionHash)) return false;
    this.redeemed.set(redemption.transactionHash, redemption);
    return true;
  }
}

const config = {
  homeDomain: 'stellar.multisig.tools',
  webAuthDomain: 'stellar.multisig.tools',
  issuer: 'https://stellar.multisig.tools/api/auth',
};

function passphrase(network: StellarNetwork) {
  return network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
}

function signChallenge(xdr: string, signer: Keypair, network: StellarNetwork = 'public') {
  const transaction = TransactionBuilder.fromXdr(xdr, passphrase(network));
  transaction.sign(signer);
  return transaction.toXDR();
}

function signMessage(message: string, signer: Keypair): string {
  const messageHash = hash(Buffer.concat([SEP53_PREFIX, Buffer.from(message, 'utf8')]));
  return Buffer.from(signer.sign(messageHash)).toString('base64');
}

test('creates a sequence-zero Mainnet unlock challenge and authenticates the exact wallet key', async () => {
  const store = new MemoryAuthStore();
  const signer = Keypair.random();
  const now = new Date('2026-08-29T08:00:00.000Z');
  const challenge = await createAuthChallenge(store, signer.publicKey(), 'public', { ...config, now });
  const transaction = TransactionBuilder.fromXdr(challenge.transaction, Networks.PUBLIC);
  assert.ok(!(transaction instanceof FeeBumpTransaction));
  if (transaction instanceof FeeBumpTransaction) throw new Error('Expected classic authentication transaction.');

  assert.equal(challenge.network, 'public');
  assert.equal(challenge.networkPassphrase, Networks.PUBLIC);
  assert.match(challenge.message, /Unlock MultiSig Tools/);
  assert.match(challenge.message, new RegExp(signer.publicKey()));
  assert.match(challenge.message, /Network: Mainnet/);
  assert.match(challenge.message, /Access: 1 hour/);
  assert.match(challenge.message, /Challenge expires:/);
  assert.equal(transaction.sequence, '0');
  assert.equal(transaction.source, challenge.signingKey);
  assert.equal(transaction.operations.length, 2);
  assert.equal(transaction.signatures.length, 1);

  const result = await exchangeAuthChallenge(
    store,
    signChallenge(challenge.transaction, signer),
    'public',
    { ...config, now: new Date(now.getTime() + 1_000) },
  );
  assert.equal(result.session.address, signer.publicKey());
  assert.equal(result.session.network, 'public');
  assert.equal(result.session.expiresAt - result.session.issuedAt, 3600);

  const verified = await verifyAuthToken(store, result.token, {
    ...config,
    now: new Date(now.getTime() + 2_000),
  });
  assert.equal(verified.address, signer.publicKey());
  assert.equal(verified.network, 'public');
});

test('authenticates with a SEP-53 unlock message without adding a transaction signature', async () => {
  const store = new MemoryAuthStore();
  const signer = Keypair.random();
  const now = new Date('2026-08-29T08:00:00.000Z');
  const challenge = await createAuthChallenge(store, signer.publicKey(), 'testnet', { ...config, now });

  const result = await exchangeAuthMessageChallenge(
    store,
    challenge.transaction,
    signMessage(challenge.message, signer),
    'testnet',
    { ...config, now: new Date(now.getTime() + 1_000) },
  );

  assert.equal(result.session.address, signer.publicKey());
  assert.equal(result.session.network, 'testnet');
  const transaction = TransactionBuilder.fromXdr(challenge.transaction, Networks.TESTNET);
  assert.equal(transaction.signatures.length, 1);
});

test('binds the selected unlock duration into the SEP-53 message', async () => {
  const store = new MemoryAuthStore();
  const signer = Keypair.random();
  const now = new Date('2026-08-29T08:00:00.000Z');
  const challenge = await createAuthChallenge(store, signer.publicKey(), 'public', {
    ...config,
    now,
    sessionTtlSeconds: 900,
  });
  assert.match(challenge.message, /Access: 15 minutes/);
  const signature = signMessage(challenge.message, signer);

  await assert.rejects(
    exchangeAuthMessageChallenge(
      store,
      challenge.transaction,
      signature,
      'public',
      { ...config, now: new Date(now.getTime() + 1_000), sessionTtlSeconds: 3600 },
    ),
    (cause: unknown) => cause instanceof AuthServiceError && cause.code === 'invalid_signature',
  );

  const result = await exchangeAuthMessageChallenge(
    store,
    challenge.transaction,
    signature,
    'public',
    { ...config, now: new Date(now.getTime() + 1_000), sessionTtlSeconds: 900 },
  );
  assert.equal(result.session.expiresAt - result.session.issuedAt, 900);
});

test('accepts only the supported private-workspace unlock durations', () => {
  assert.equal(resolveUnlockTtlSeconds(undefined), 3600);
  assert.equal(resolveUnlockTtlSeconds('900'), 900);
  assert.equal(resolveUnlockTtlSeconds(28800), 28800);
  assert.throws(
    () => resolveUnlockTtlSeconds(7200),
    (cause: unknown) => cause instanceof AuthServiceError && cause.code === 'invalid_unlock_duration',
  );
});

test('rejects a SEP-53 signature from a different wallet', async () => {
  const store = new MemoryAuthStore();
  const expectedSigner = Keypair.random();
  const otherSigner = Keypair.random();
  const now = new Date('2026-08-29T08:00:00.000Z');
  const challenge = await createAuthChallenge(store, expectedSigner.publicKey(), 'public', { ...config, now });

  await assert.rejects(
    exchangeAuthMessageChallenge(
      store,
      challenge.transaction,
      signMessage(challenge.message, otherSigner),
      'public',
      { ...config, now: new Date(now.getTime() + 1_000) },
    ),
    (cause: unknown) => cause instanceof AuthServiceError && cause.code === 'invalid_signature',
  );
});

test('SEP-53 and SEP-10 share the same one-time challenge redemption', async () => {
  const store = new MemoryAuthStore();
  const signer = Keypair.random();
  const now = new Date('2026-08-29T08:00:00.000Z');
  const challenge = await createAuthChallenge(store, signer.publicKey(), 'public', { ...config, now });

  await exchangeAuthMessageChallenge(
    store,
    challenge.transaction,
    signMessage(challenge.message, signer),
    'public',
    { ...config, now: new Date(now.getTime() + 1_000) },
  );

  await assert.rejects(
    exchangeAuthChallenge(
      store,
      signChallenge(challenge.transaction, signer),
      'public',
      { ...config, now: new Date(now.getTime() + 2_000) },
    ),
    (cause: unknown) => cause instanceof AuthServiceError && cause.code === 'challenge_replayed',
  );
});

test('creates and exchanges a Testnet challenge using the Testnet passphrase', async () => {
  const store = new MemoryAuthStore();
  const signer = Keypair.random();
  const now = new Date('2026-08-29T08:00:00.000Z');
  const challenge = await createAuthChallenge(store, signer.publicKey(), 'testnet', { ...config, now });
  const transaction = TransactionBuilder.fromXdr(challenge.transaction, Networks.TESTNET);
  assert.ok(!(transaction instanceof FeeBumpTransaction));
  assert.equal(challenge.network, 'testnet');
  assert.equal(challenge.networkPassphrase, Networks.TESTNET);
  assert.match(challenge.message, /Network: Testnet/);

  const signed = signChallenge(challenge.transaction, signer, 'testnet');
  const result = await exchangeAuthChallenge(
    store,
    signed,
    'testnet',
    { ...config, now: new Date(now.getTime() + 1_000), sessionTtlSeconds: 28800 },
  );
  assert.equal(result.session.address, signer.publicKey());
  assert.equal(result.session.network, 'testnet');
  assert.equal(result.session.expiresAt - result.session.issuedAt, 28800);

  const verified = await verifyAuthToken(store, result.token, {
    ...config,
    now: new Date(now.getTime() + 2_000),
  });
  assert.equal(verified.network, 'testnet');
});

test('rejects exchanging a Testnet challenge as Mainnet', async () => {
  const store = new MemoryAuthStore();
  const signer = Keypair.random();
  const now = new Date('2026-08-29T08:00:00.000Z');
  const challenge = await createAuthChallenge(store, signer.publicKey(), 'testnet', { ...config, now });
  const signed = signChallenge(challenge.transaction, signer, 'testnet');

  await assert.rejects(
    exchangeAuthChallenge(
      store,
      signed,
      'public',
      { ...config, now: new Date(now.getTime() + 1_000) },
    ),
    (cause: unknown) => cause instanceof AuthServiceError && cause.code === 'invalid_signature',
  );
});

test('rejects a transaction challenge signature from a different wallet', async () => {
  const store = new MemoryAuthStore();
  const expectedSigner = Keypair.random();
  const otherSigner = Keypair.random();
  const now = new Date('2026-08-29T08:00:00.000Z');
  const challenge = await createAuthChallenge(store, expectedSigner.publicKey(), 'public', { ...config, now });

  await assert.rejects(
    exchangeAuthChallenge(
      store,
      signChallenge(challenge.transaction, otherSigner),
      'public',
      { ...config, now: new Date(now.getTime() + 1_000) },
    ),
    (cause: unknown) => cause instanceof AuthServiceError && cause.code === 'invalid_signature',
  );
});

test('rejects replay of an already exchanged challenge', async () => {
  const store = new MemoryAuthStore();
  const signer = Keypair.random();
  const now = new Date('2026-08-29T08:00:00.000Z');
  const challenge = await createAuthChallenge(store, signer.publicKey(), 'public', { ...config, now });
  const signed = signChallenge(challenge.transaction, signer);

  await exchangeAuthChallenge(store, signed, 'public', { ...config, now: new Date(now.getTime() + 1_000) });
  await assert.rejects(
    exchangeAuthChallenge(
      store,
      signed,
      'public',
      { ...config, now: new Date(now.getTime() + 2_000) },
    ),
    (cause: unknown) => cause instanceof AuthServiceError && cause.code === 'challenge_replayed',
  );
});


test('resolves optional and required private workspace sessions from request transport', async () => {
  const store = new MemoryAuthStore();
  const signer = Keypair.random();
  const now = new Date('2026-09-01T03:00:00.000Z');
  const challenge = await createAuthChallenge(store, signer.publicKey(), 'testnet', { ...config, now });
  const issued = await exchangeAuthChallenge(
    store,
    signChallenge(challenge.transaction, signer, 'testnet'),
    'testnet',
    { ...config, now: new Date(now.getTime() + 1_000) },
  );
  const verifyOptions = { ...config, now: new Date(now.getTime() + 2_000) };

  const bearer = new Request('https://stellar.multisig.tools/api/inbox', {
    headers: { Authorization: `Bearer ${issued.token}` },
  });
  const bearerSession = await privateWorkspaceSessionFromRequest(store, bearer, verifyOptions);
  assert.equal(bearerSession?.address, signer.publicKey());
  assert.equal(bearerSession?.network, 'testnet');

  const cookie = new Request('https://stellar.multisig.tools/api/activity', {
    headers: { Cookie: `mst_auth=${encodeURIComponent(issued.token)}` },
  });
  const cookieSession = await requirePrivateWorkspaceSession(store, cookie, verifyOptions, 'Unlock private data.');
  assert.equal(cookieSession.address, signer.publicKey());

  const anonymous = new Request('https://stellar.multisig.tools/api/inbox');
  assert.equal(await privateWorkspaceSessionFromRequest(store, anonymous, verifyOptions), null);
  await assert.rejects(
    () => requirePrivateWorkspaceSession(store, anonymous, verifyOptions, 'Unlock private data.'),
    (cause: unknown) => cause instanceof AuthServiceError
      && cause.status === 401
      && cause.code === 'authentication_required'
      && cause.message === 'Unlock private data.',
  );
});
