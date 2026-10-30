import assert from 'node:assert/strict';
import test from 'node:test';
import { sendResendEmail } from './resendEmailTransport.js';

test('Resend transport sends with bearer auth and stable idempotency key', async () => {
  let request: { url: string; init?: RequestInit } | null = null;
  const fetchImpl: typeof fetch = async (input, init) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify({ id: 'email-123' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const result = await sendResendEmail({
    from: 'MultiSig Tools Testnet <notifications@testnet.notify.multisig.tools>',
    to: 'bob@example.com',
    subject: '[Testnet] Signature requested in MultiSig Tools',
    text: 'Review',
    html: '<p>Review</p>',
    idempotencyKey: 'classic_request:0123456789ABCDEF:signature_requested:GBBB',
  }, {
    apiKey: 're_test_only',
    fetchImpl,
  });

  assert.deepEqual(result, { status: 200, providerMessageId: 'email-123' });
  assert.equal(request?.url, 'https://api.resend.com/emails');
  const headers = new Headers(request?.init?.headers);
  assert.equal(headers.get('Authorization'), 'Bearer re_test_only');
  assert.equal(
    headers.get('Idempotency-Key'),
    'classic_request:0123456789ABCDEF:signature_requested:GBBB',
  );
  const body = JSON.parse(String(request?.init?.body));
  assert.deepEqual(body.to, ['bob@example.com']);
  assert.equal(body.tags[0].value, 'signature_requested');
});
