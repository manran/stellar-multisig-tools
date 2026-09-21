import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IntegrationWebhookNetworkPolicyError,
  resolvePublicIntegrationWebhookAddresses,
  type WebhookLookup,
} from './integrationWebhookNetworkPolicy.js';

test('delivery-time DNS validation accepts only fully public resolution sets', async () => {
  const publicOnly: WebhookLookup = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
  ];
  assert.equal(
    (await resolvePublicIntegrationWebhookAddresses('https://hooks.example.com/mst', publicOnly)).length,
    2,
  );

  const mixed: WebhookLookup = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '10.0.0.7', family: 4 },
  ];
  await assert.rejects(
    () => resolvePublicIntegrationWebhookAddresses('https://hooks.example.com/mst', mixed),
    IntegrationWebhookNetworkPolicyError,
  );
});

test('literal IP destinations are checked without DNS and fail closed for private space', async () => {
  const unexpectedLookup: WebhookLookup = async () => {
    throw new Error('literal IP must not use DNS');
  };
  assert.deepEqual(
    await resolvePublicIntegrationWebhookAddresses('https://8.8.8.8/hook', unexpectedLookup),
    [{ address: '8.8.8.8', family: 4 }],
  );
  await assert.rejects(
    () => resolvePublicIntegrationWebhookAddresses('https://127.0.0.1/hook', unexpectedLookup),
    IntegrationWebhookNetworkPolicyError,
  );
  await assert.rejects(
    () => resolvePublicIntegrationWebhookAddresses('https://[::1]/hook', unexpectedLookup),
    IntegrationWebhookNetworkPolicyError,
  );
});
