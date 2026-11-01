import assert from 'node:assert/strict';
import test from 'node:test';
import { Webhook } from 'standardwebhooks';

import { handleResendHumanNotificationWebhook } from './resendHumanNotificationWebhook.js';

const SECRET = 'whsec_' + Buffer.alloc(32, 7).toString('base64');

function signedRequest(
  event: unknown,
  options: { id?: string; timestamp?: Date; signature?: string } = {},
): Request {
  const body = JSON.stringify(event);
  const id = options.id ?? 'msg_test_1';
  const timestamp = options.timestamp ?? new Date();
  const signature = options.signature ?? new Webhook(SECRET).sign(id, timestamp, body);
  return new Request('https://api-testnet.multisig.tools/stellar/human-email-events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': id,
      'svix-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
      'svix-signature': signature,
    },
    body,
  });
}

test('Resend delivered webhook verifies the raw payload and records provider evidence', async () => {
  const recorded: unknown[] = [];
  const response = await handleResendHumanNotificationWebhook(signedRequest({
    type: 'email.delivered',
    created_at: '2026-11-01T00:00:00.000Z',
    data: { email_id: 'email-123', to: ['bob@example.com'] },
  }), {
    secret: SECRET,
    recordProviderEvent: async (input) => {
      recorded.push(input);
      return 'updated';
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    accepted: true,
    matched: true,
    state: 'delivered',
  });
  assert.deepEqual(recorded, [{
    providerMessageId: 'email-123',
    state: 'delivered',
    eventAt: new Date('2026-11-01T00:00:00.000Z'),
    providerEventId: 'msg_test_1',
  }]);
});

test('Resend bounced webhook records bounce evidence without exposing recipient data', async () => {
  let recordedState = '';
  const response = await handleResendHumanNotificationWebhook(signedRequest({
    type: 'email.bounced',
    created_at: '2026-11-01T00:01:00.000Z',
    data: { email_id: 'email-456', to: ['private@example.com'] },
  }), {
    secret: SECRET,
    recordProviderEvent: async (input) => {
      recordedState = input.state;
      return 'updated';
    },
  });

  assert.equal(response.status, 200);
  assert.equal(recordedState, 'bounced');
  assert.doesNotMatch(JSON.stringify(await response.json()), /private@example\.com/);
});

test('Resend webhook rejects an invalid signature before recording anything', async () => {
  let called = false;
  const response = await handleResendHumanNotificationWebhook(signedRequest({
    type: 'email.delivered',
    created_at: '2026-11-01T00:00:00.000Z',
    data: { email_id: 'email-123' },
  }, { signature: 'v1,invalid' }), {
    secret: SECRET,
    recordProviderEvent: async () => {
      called = true;
      return 'updated';
    },
  });

  assert.equal(response.status, 400);
  assert.equal(called, false);
  assert.equal((await response.json() as { code: string }).code, 'invalid_webhook_signature');
});

test('Resend webhook asks the provider to retry when the send record is not durable yet', async () => {
  const response = await handleResendHumanNotificationWebhook(signedRequest({
    type: 'email.delivered',
    created_at: '2026-11-01T00:00:00.000Z',
    data: { email_id: 'email-racing-send' },
  }), {
    secret: SECRET,
    recordProviderEvent: async () => 'not_found',
  });

  assert.equal(response.status, 503);
  assert.equal((await response.json() as { code: string }).code, 'provider_message_not_ready');
});

test('Resend webhook acknowledges unrelated event types without mutating notification state', async () => {
  let called = false;
  const response = await handleResendHumanNotificationWebhook(signedRequest({
    type: 'email.opened',
    created_at: '2026-11-01T00:00:00.000Z',
    data: { email_id: 'email-123' },
  }), {
    secret: SECRET,
    recordProviderEvent: async () => {
      called = true;
      return 'updated';
    },
  });

  assert.equal(response.status, 200);
  assert.equal(called, false);
  assert.deepEqual(await response.json(), { accepted: true, ignored: true });
});
