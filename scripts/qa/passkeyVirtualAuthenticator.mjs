#!/usr/bin/env node
// Isolated WebAuthn cryptographic acceptance: local origin + Chromium virtual authenticator.
// No network wallets, live Testnet writes, email, or credential exports.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { chromium, devices } = await import(process.env.MST_QA_PLAYWRIGHT_MODULE || 'playwright');
const android = process.env.MST_QA_DEVICE === 'android';

const web = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end('<!doctype html><title>Temporary WebAuthn test</title><p>Local-only Passkey verification</p>');
});
await new Promise((resolve) => web.listen(0, '127.0.0.1', resolve));
const { port } = web.address();
const origin = `http://localhost:${port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const device = android ? devices['Pixel 7'] : null;
  const context = await browser.newContext(device ? {
    viewport: device.viewport, deviceScaleFactor: device.deviceScaleFactor,
    userAgent: device.userAgent, isMobile: true, hasTouch: true,
  } : {});
  const page = await context.newPage();
  await page.goto(origin);
  if (android) {
    assert.equal(await page.evaluate(() => navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches), true);
  }
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    },
  });
  const registrationOptions = await generateRegistrationOptions({
    rpName: 'MultiSig Tools', rpID: 'localhost', userName: 'walletless-qa',
    userID: randomBytes(16), attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  const registrationResponse = await page.evaluate(async (options) => {
    const decode = (v) => Uint8Array.from(atob(v.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(v.length / 4) * 4, '=')), c => c.charCodeAt(0));
    const encode = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const publicKey = {
      ...options, challenge: decode(options.challenge),
      user: { ...options.user, id: decode(options.user.id) },
      excludeCredentials: (options.excludeCredentials ?? []).map((x) => ({ ...x, id: decode(x.id) })),
    };
    const response = await navigator.credentials.create({ publicKey });
    if (!response) throw Error('Virtual authenticator failed to register');
    return {
      id: response.id, rawId: encode(response.rawId), type: response.type,
      response: {
        clientDataJSON: encode(response.response.clientDataJSON),
        attestationObject: encode(response.response.attestationObject),
        transports: response.response.getTransports(),
      },
      clientExtensionResults: response.getClientExtensionResults(),
      authenticatorAttachment: response.authenticatorAttachment,
    };
  }, registrationOptions);
  const registration = await verifyRegistrationResponse({
    response: registrationResponse,
    expectedChallenge: registrationOptions.challenge,
    expectedOrigin: origin,
    expectedRPID: 'localhost',
    requireUserVerification: true,
  });
  assert.equal(registration.verified, true);
  assert.ok(registration.registrationInfo?.credential);
  const credential = registration.registrationInfo.credential;
  assert.equal(credential.id, registrationResponse.id);
  console.log('PASS virtual-passkey-registration-verified');

  const authOptions = await generateAuthenticationOptions({
    rpID: 'localhost', userVerification: 'required',
  });
  const authResponse = await page.evaluate(async (options) => {
    const decode = (v) => Uint8Array.from(atob(v.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(v.length / 4) * 4, '=')), c => c.charCodeAt(0));
    const encode = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const response = await navigator.credentials.get({
      publicKey: { challenge: decode(options.challenge), rpId: options.rpId,
        userVerification: 'required', timeout: options.timeout },
    });
    if (!response) throw Error('Virtual authenticator failed to authenticate');
    return { id: response.id, rawId: encode(response.rawId), type: response.type,
      response: {
        authenticatorData: encode(response.response.authenticatorData),
        clientDataJSON: encode(response.response.clientDataJSON),
        signature: encode(response.response.signature),
        userHandle: response.response.userHandle ? encode(response.response.userHandle) : undefined,
      },
      clientExtensionResults: response.getClientExtensionResults(),
      authenticatorAttachment: response.authenticatorAttachment,
    };
  }, authOptions);
  const verification = await verifyAuthenticationResponse({
    response: authResponse, expectedChallenge: authOptions.challenge,
    expectedOrigin: origin, expectedRPID: 'localhost',
    requireUserVerification: true,
    credential: {
      id: credential.id, publicKey: credential.publicKey,
      counter: credential.counter, transports: registrationResponse.response.transports,
    },
  });
  assert.equal(verification.verified, true);
  assert.ok(verification.authenticationInfo);
  console.log('PASS virtual-passkey-authentication-verified');

  await assert.rejects(
    () => verifyAuthenticationResponse({
      response: authResponse, expectedChallenge: 'a-different-challenge', expectedOrigin: origin,
      expectedRPID: 'localhost', requireUserVerification: true,
      credential: { id: credential.id, publicKey: credential.publicKey, counter: credential.counter },
    }),
  );
  console.log('PASS webauthn-challenge-signature-replay-rejected');
  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
  console.log(`PASS isolated WebAuthn cryptographic acceptance${android ? ' (Android touch emulation)' : ''}`);
} finally {
  await browser?.close();
  await new Promise((resolve) => web.close(resolve));
}
