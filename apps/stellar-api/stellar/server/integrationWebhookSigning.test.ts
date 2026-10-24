import assert from 'node:assert/strict';
import test from 'node:test';
import { Webhook, WebhookVerificationError } from 'standardwebhooks';
import {
  createIntegrationWebhookMasterSecret,
  deriveIntegrationWebhookSecret,
  signIntegrationWebhookPayload,
} from './integrationWebhookSigning.js';

test('per-Service Standard Webhooks secret is deterministic, isolated and rotatable by generation', () => {
  const master = createIntegrationWebhookMasterSecret();
  const v1 = deriveIntegrationWebhookSecret('fednetwork', 1, master);
  assert.match(master, /^mwh_[A-Za-z0-9_-]{43}$/);
  assert.match(v1, /^whsec_/);
  assert.equal(v1, deriveIntegrationWebhookSecret('FEDNETWORK', 1, master));
  assert.notEqual(v1, deriveIntegrationWebhookSecret('fednetwork', 2, master));
  assert.notEqual(v1, deriveIntegrationWebhookSecret('other-service', 1, master));
  assert.equal(v1.includes(master), false);
});

test('outbound headers interoperate with the official Standard Webhooks verifier', () => {
  const master = createIntegrationWebhookMasterSecret();
  const timestamp = new Date();
  timestamp.setMilliseconds(0);
  const payload = {
    schema: 'multisigtools-integration-webhook-v1',
    type: 'work.changed',
    data: { id: 'INT1' },
  };
  const signed = signIntegrationWebhookPayload({
    serviceId: 'fednetwork',
    secretVersion: 4,
    eventId: 'evt_123',
    timestamp,
    payload,
    masterSecret: master,
  });
  assert.equal(signed.headers['webhook-id'], 'evt_123');
  assert.equal(signed.headers['webhook-timestamp'], String(Math.floor(timestamp.getTime() / 1000)));
  assert.match(signed.headers['webhook-signature'], /^v1,/);

  const verifier = new Webhook(deriveIntegrationWebhookSecret('fednetwork', 4, master));
  assert.deepEqual(verifier.verify(signed.body, signed.headers), payload);
  assert.throws(
    () => new Webhook(deriveIntegrationWebhookSecret('fednetwork', 5, master))
      .verify(signed.body, signed.headers),
    WebhookVerificationError,
  );
});
