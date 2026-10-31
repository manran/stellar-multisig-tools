import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSignatureRequestedEmail } from './humanNotificationEmail.js';

test('signature-request email uses a capability-free Request locator', () => {
  const email = buildSignatureRequestedEmail({
    requestId: '0123456789ABCDEF',
    network: 'testnet',
    expiresAt: '2026-10-31T12:00:00Z',
    webOrigin: 'https://stellar-testnet.multisig.tools',
    actorAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    systemType: 'Batch payment',
    businessLabel: 'Monthly payroll',
  });

  assert.equal(
    email.actionUrl,
    'https://stellar-testnet.multisig.tools/s#0123456789ABCDEF',
  );
  assert.match(email.subject, /Testnet/);
  assert.match(email.text, /GAAAAAAAA.* invited you to review and sign:/);
  assert.match(email.text, /Monthly payroll\nBatch payment/);
  assert.match(email.text, /Proposal ID: 0123-4567-89AB-CDEF/);
  assert.match(email.text, /Oct 31, 2026, 12:00 PM UTC/);
  assert.match(email.text, /continue from Inbox/);
  assert.match(email.text, /https:\/\/stellar-testnet\.multisig\.tools\/inbox/);
  assert.match(email.text, /enter Proposal ID 0123-4567-89AB-CDEF/);
  assert.match(email.text, /Your Stellar wallet—not this email—determines signing access/);
  assert.doesNotMatch(email.text, /amount|destination|XDR|memo/i);
  assert.doesNotMatch(email.actionUrl, /capability/i);
  assert.equal(email.actionUrl.split('#')[1]?.length, 16);
});

test('signature-request email escapes user-defined business labels in HTML', () => {
  const email = buildSignatureRequestedEmail({
    requestId: '0123456789ABCDEF',
    network: 'testnet',
    expiresAt: '2026-10-31T12:00:00Z',
    webOrigin: 'https://stellar-testnet.multisig.tools',
    actorAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    systemType: 'Payment',
    businessLabel: '<Monthly & payroll>',
  });

  assert.match(email.text, /<Monthly & payroll>/);
  assert.match(email.html, /&lt;Monthly &amp; payroll&gt;/);
  assert.doesNotMatch(email.html, /<Monthly & payroll>/);
});
