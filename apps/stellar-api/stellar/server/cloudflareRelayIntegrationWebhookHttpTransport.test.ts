import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CloudflareRelayIntegrationWebhookHttpTransport,
  integrationWebhookRelaySignature,
} from './cloudflareRelayIntegrationWebhookHttpTransport.js';

const SECRET = 'mrelay_' + Buffer.alloc(32, 7).toString('base64url');

test('relay signature binds timestamp, target and body', () => {
  const signature = integrationWebhookRelaySignature({
    targetUrl: 'https://hooks.example.test/events',
    timestamp: '1790250000',
    body: '{"ok":true}',
    secret: SECRET,
  });
  assert.match(signature, /^v1=[A-Za-z0-9_-]{43}$/);
  assert.notEqual(signature, integrationWebhookRelaySignature({
    targetUrl: 'https://hooks.example.test/other',
    timestamp: '1790250000',
    body: '{"ok":true}',
    secret: SECRET,
  }));
});

test('relay transport preserves standard webhook headers and never connects to target directly', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const transport = new CloudflareRelayIntegrationWebhookHttpTransport(
    'https://relay.example.test/deliver',
    SECRET,
    async () => [{ address: '203.0.113.10', family: 4 }],
    async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(null, { status: 204 });
    },
  );

  const response = await transport.post({
    url: 'https://hooks.example.test/events',
    body: '{"event":"ok"}',
    headers: {
      'content-type': 'application/json',
      'webhook-id': 'evt-1',
      'webhook-timestamp': '1790250000',
      'webhook-signature': 'v1,abc',
      'x-not-forwarded': 'secret',
    },
    timeoutMs: 5000,
  });

  assert.equal(response.status, 204);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://relay.example.test/deliver');
  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.get('webhook-id'), 'evt-1');
  assert.equal(headers.get('x-mst-relay-target'), 'https://hooks.example.test/events');
  assert.match(headers.get('x-mst-relay-signature') ?? '', /^v1=/);
  assert.equal(headers.get('x-not-forwarded'), null);
});

test('relay transport keeps existing webhook SSRF policy', async () => {
  const transport = new CloudflareRelayIntegrationWebhookHttpTransport(
    'https://relay.example.test/deliver',
    SECRET,
    async () => [{ address: '127.0.0.1', family: 4 }],
    async () => new Response(null, { status: 204 }),
  );

  await assert.rejects(
    transport.post({
      url: 'https://hooks.example.test/events',
      body: '{}',
      headers: {},
    }),
  );
});
