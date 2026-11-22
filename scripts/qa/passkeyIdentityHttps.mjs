#!/usr/bin/env node
// Real MST identity route + PostgreSQL + Chromium WebAuthn over loopback HTTPS.
// Use only a disposable database. No Testnet writes, deployed keys or public ports.
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

if (!process.env.MST_POSTGRES_TEST_URL || process.env.MST_POSTGRES_TEST_ALLOW_RESET !== '1') {
  throw new Error('This test requires a disposable PostgreSQL URL and MST_POSTGRES_TEST_ALLOW_RESET=1.');
}
process.env.DATABASE_URL = process.env.MST_POSTGRES_TEST_URL;
// Local HTTPS has its own origin; dual mode avoids the fixed production origin.
process.env.VITE_STELLAR_DEPLOYMENT_NETWORK = 'dual';

const { chromium } = await import(process.env.MST_QA_PLAYWRIGHT_MODULE || 'playwright');
const { blobAuthStore } = await import('../../apps/stellar-api/stellar/server/blobAuthStore.js');
const { GET, POST, DELETE } = await import('../../apps/stellar-api/stellar/routes/identity.js');
const { coordinationPool, closeCoordinationPool } = await import('../../apps/stellar-api/stellar/db/postgres.js');
const database = await coordinationPool().query('SELECT current_database() AS name');
assert.equal(database.rows[0]?.name, 'postgres', 'Use only the disposable local Postgres QA database.');

let qaKey = null;
// The existing AuthStore interface isolates this test from production Blob.
blobAuthStore.getServerKey = async () => qaKey;
blobAuthStore.createServerKey = async (key) => { qaKey ??= key; };
blobAuthStore.claimChallengeRedemption = async () => true;

const temp = await mkdtemp(path.join(tmpdir(), 'mst-identity-https-'));
const keyPath = path.join(temp, 'key.pem');
const certPath = path.join(temp, 'cert.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
  '-keyout', keyPath, '-out', certPath, '-days', '1',
  '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
const server = createServer({
  key: await readFile(keyPath), cert: await readFile(certPath),
}, async (incoming, outgoing) => {
  try {
    if (incoming.url === '/' && incoming.method === 'GET') {
      outgoing.writeHead(200, { 'Content-Type': 'text/html' });
      outgoing.end('<!doctype html><title>MST isolated Passkey test</title>');
      return;
    }
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const port = server.address().port;
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (typeof value === 'string') headers.set(key, value);
    }
    const request = new Request(`https://localhost:${port}${incoming.url}`, {
      method: incoming.method, headers,
      ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
    });
    const reply = incoming.method === 'POST' ? await POST(request)
      : incoming.method === 'GET' ? await GET(request)
        : incoming.method === 'DELETE' ? await DELETE()
          : Response.json({ error: 'unsupported' }, { status: 405 });
    outgoing.writeHead(reply.status, Object.fromEntries(reply.headers.entries()));
    outgoing.end(Buffer.from(await reply.arrayBuffer()));
  } catch (cause) {
    outgoing.writeHead(500, { 'Content-Type': 'application/json' });
    outgoing.end(JSON.stringify({ error: cause instanceof Error ? cause.message : 'unknown' }));
  }
});

let browser;
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `https://localhost:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(origin);
  assert.equal(await page.evaluate(() => window.isSecureContext), true);
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const post = (action, extra = {}) => page.evaluate(async ({ action, extra }) => {
    const response = await fetch('/api/identity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.13' },
      body: JSON.stringify({ action, network: 'testnet', ...extra }),
    });
    return { status: response.status, body: await response.json(),
      retryAfter: response.headers.get('Retry-After') };
  }, { action, extra });
  const identity = () => page.evaluate(async () => {
    const response = await fetch('/api/identity?network=testnet');
    return { status: response.status, body: await response.json() };
  });

  const registration = await post('registration_options');
  assert.equal(registration.status, 200, JSON.stringify(registration.body));
  assert.equal(registration.body.options.rp.id, 'localhost');
  assert.equal(registration.body.options.authenticatorSelection.userVerification, 'required');
  const registrationResponse = await page.evaluate(async (options) => {
    const decode = (v) => Uint8Array.from(atob(v.replace(/-/g, '+').replace(/_/g, '/')
      .padEnd(Math.ceil(v.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
    const encode = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const credential = await navigator.credentials.create({ publicKey: {
      ...options, challenge: decode(options.challenge),
      user: { ...options.user, id: decode(options.user.id) },
      excludeCredentials: (options.excludeCredentials ?? []).map((c) => ({ ...c, id: decode(c.id) })),
    } });
    if (!credential) throw Error('Browser did not create Passkey');
    return { id: credential.id, rawId: encode(credential.rawId), type: credential.type,
      response: { clientDataJSON: encode(credential.response.clientDataJSON),
        attestationObject: encode(credential.response.attestationObject),
        transports: credential.response.getTransports() },
      clientExtensionResults: credential.getClientExtensionResults(),
      authenticatorAttachment: credential.authenticatorAttachment };
  }, registration.body.options);
  const verified = await post('registration_verify', {
    challengeId: registration.body.challengeId, response: registrationResponse,
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  const userId = verified.body.userId;
  assert.ok(userId);
  const signedIn = await identity();
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.body.identity.userId, userId);
  assert.equal(signedIn.body.identity.method, 'passkey');
  const session = (await context.cookies(origin)).find((c) => c.name === '__Host-mst-identity');
  assert.ok(session?.httpOnly && session.secure && session.sameSite === 'Strict');
  console.log('PASS HTTPS API registration, session cookie and stable User ID');

  const replay = await post('registration_verify', {
    challengeId: registration.body.challengeId, response: registrationResponse,
  });
  assert.equal(replay.status, 401);
  await page.evaluate(() => fetch('/api/identity', { method: 'DELETE' }));
  assert.equal((await identity()).body.authenticated, false);

  const challenge = await post('authentication_options');
  assert.equal(challenge.status, 200);
  const signed = await page.evaluate(async (options) => {
    const decode = (v) => Uint8Array.from(atob(v.replace(/-/g, '+').replace(/_/g, '/')
      .padEnd(Math.ceil(v.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
    const encode = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const credential = await navigator.credentials.get({ publicKey: {
      challenge: decode(options.challenge), rpId: options.rpId,
      timeout: options.timeout, userVerification: 'required',
    } });
    if (!credential) throw Error('Browser did not authenticate');
    return { id: credential.id, rawId: encode(credential.rawId), type: credential.type,
      response: { authenticatorData: encode(credential.response.authenticatorData),
        clientDataJSON: encode(credential.response.clientDataJSON),
        signature: encode(credential.response.signature),
        ...(credential.response.userHandle ? { userHandle: encode(credential.response.userHandle) } : {}) },
      clientExtensionResults: credential.getClientExtensionResults(),
      authenticatorAttachment: credential.authenticatorAttachment };
  }, challenge.body.options);
  const authenticated = await post('authentication_verify', {
    challengeId: challenge.body.challengeId, response: signed,
  });
  assert.equal(authenticated.status, 200, JSON.stringify(authenticated.body));
  assert.equal(authenticated.body.userId, userId);
  assert.equal((await identity()).body.identity.userId, userId);
  const replayLogin = await post('authentication_verify', {
    challengeId: challenge.body.challengeId, response: signed,
  });
  assert.equal(replayLogin.status, 401);
  console.log('PASS HTTPS API Passkey login, replay prevention and returning User ID');

  for (let i = 0; i < 7; i += 1) assert.equal((await post('registration_options')).status, 200);
  const overLimit = await post('registration_options');
  assert.equal(overLimit.status, 429);
  assert.equal(overLimit.body.code, 'identity_rate_limited');
  assert.equal(overLimit.retryAfter, '300');
  console.log('PASS shared PostgreSQL identity quota returns HTTP 429 and Retry-After');

  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
  await context.close();
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await closeCoordinationPool();
  await rm(temp, { recursive: true, force: true });
}
