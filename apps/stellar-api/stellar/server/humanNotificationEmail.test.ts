import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSignatureRequestedEmail } from './humanNotificationEmail.js';

test('signature-request email uses a capability-free Request locator', () => {
  const email = buildSignatureRequestedEmail({
    requestId: '0123456789ABCDEF',
    network: 'testnet',
    expiresAt: '2026-10-31T12:00:00Z',
    webOrigin: 'https://stellar-testnet.multisig.tools',
  });

  assert.equal(
    email.actionUrl,
    'https://stellar-testnet.multisig.tools/s#0123456789ABCDEF',
  );
  assert.match(email.subject, /Testnet/);
  assert.match(email.text, /confirm the assigned signer wallet/);
  assert.doesNotMatch(email.actionUrl, /capability/i);
  assert.equal(email.actionUrl.split('#')[1]?.length, 16);
});
