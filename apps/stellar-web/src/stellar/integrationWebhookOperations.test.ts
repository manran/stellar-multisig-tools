import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const adminUi = source('../IntegrationAdminApp.tsx');
const adminRoute = source('../../../stellar-api/stellar/routes/integration-admin.ts');
const outbox = source('../../../stellar-api/stellar/db/postgresIntegrationOutboxDispatch.ts');
const deliveryHistory = source('../../../stellar-api/stellar/db/postgresIntegrationWebhookDeliveryHistory.ts');

test('Integration webhook operations expose delivery evidence without inventing new business events', () => {
  assert.match(adminUi, /Webhook delivery history/);
  assert.match(adminUi, /ProfileRow label="Events" value="Coordination changes"/);
  assert.match(adminUi, /Delivered means the configured receiver returned HTTP 2xx/);
  assert.match(adminUi, /manual redelivery resends the same webhook event id/);
  assert.match(adminUi, /Redeliver/);
  assert.match(adminRoute, /action === 'redeliver_webhook'/);
  assert.match(adminRoute, /integration_webhook_event_not_terminal/);
  assert.match(outbox, /published_at = NULL/);
  assert.match(outbox, /WHERE event_id = \$1[\s\S]*service_id = \$2[\s\S]*published_at IS NOT NULL/);
  assert.match(deliveryHistory, /listRecentIntegrationWebhookDeliverySummaries/);
  assert.doesNotMatch(deliveryHistory, /response_body/);
});
