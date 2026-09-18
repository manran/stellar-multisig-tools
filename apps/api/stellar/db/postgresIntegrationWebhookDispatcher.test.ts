import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Webhook } from 'standardwebhooks';
import type {
  IntegrationCredentialStore,
  StoredIntegrationCredential,
} from '../server/integrationCredentialStore.js';
import {
  dispatchIntegrationWebhookEvent,
  type IntegrationWebhookPayloadBuilder,
} from '../server/integrationWebhookDispatcher.js';
import type {
  IntegrationWebhookHttpRequest,
  IntegrationWebhookHttpTransport,
} from '../server/integrationWebhookHttpTransport.js';
import { deriveIntegrationWebhookSecret } from '../server/integrationWebhookSigning.js';
import { applyCoordinationMigrations } from './migrate.js';
import { closeCoordinationPool, coordinationPool } from './postgres.js';
import { listIntegrationWebhookDeliveries } from './postgresIntegrationWebhookDeliveryHistory.js';

const TEST_URL = process.env.MST_POSTGRES_TEST_URL?.trim();
const RESET_ALLOWED = process.env.MST_POSTGRES_TEST_ALLOW_RESET === '1';
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

const MASTER = 'mwh_' + Buffer.alloc(32, 9).toString('base64url');
const NOW = new Date();
NOW.setMilliseconds(0);

class MemoryCredentialStore implements IntegrationCredentialStore {
  constructor(private readonly value: StoredIntegrationCredential | null) {}
  async getCredential(serviceId: string) {
    return this.value?.credential.serviceId === serviceId ? this.value : null;
  }
  async listCredentials() { return this.value ? [this.value] : []; }
  async putCredential() {}
}

class MemoryTransport implements IntegrationWebhookHttpTransport {
  requests: IntegrationWebhookHttpRequest[] = [];
  constructor(private readonly result: { status?: number; error?: Error }) {}
  async post(request: IntegrationWebhookHttpRequest) {
    this.requests.push(request);
    if (this.result.error) throw this.result.error;
    return { status: this.result.status ?? 204 };
  }
}

function credential(options: { webhook?: boolean; enabled?: boolean } = {}): StoredIntegrationCredential {
  return {
    version: 1,
    credential: {
      serviceId: 'fednetwork',
      label: 'FedNetwork',
      secretHash: 'a'.repeat(64),
      networks: ['testnet'],
      classicSourceAccounts: ['GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'],
      classicExternalExecutionSourceAccounts: [],
      sorobanContracts: [],
      sorobanExecutionAccounts: [],
    },
    enabled: options.enabled ?? true,
    ...(options.webhook === false ? {} : {
      webhook: {
        version: 1,
        url: 'https://hooks.example.com/mst',
        enabled: true,
        secretVersion: 3,
      },
    }),
    createdAt: '2026-09-18T01:00:00Z',
    updatedAt: '2026-09-18T01:00:00Z',
  };
}

const payloadBuilder: IntegrationWebhookPayloadBuilder = {
  async build(record) {
    return {
      schema: 'multisigtools-integration-webhook-v1',
      type: 'work.changed',
      data: { kind: record.resourceKind, id: record.resourceId },
    };
  },
};

async function insertOutbox(eventId: string): Promise<void> {
  await coordinationPool().query(
    `INSERT INTO mst_stellar.integration_outbox (
       event_id, service_id, resource_kind, resource_id, event_type,
       payload, created_at, available_at
     ) VALUES (
       $1, 'fednetwork', 'soroban_intent', 'INT1',
       'coordination.changed', '{"version":1,"change":"changed"}'::jsonb,
       $2, $2
     )`,
    [eventId, NOW.toISOString()],
  );
}

before(async () => {
  if (!TEST_URL || !RESET_ALLOWED) return;
  const pool = coordinationPool();
  await pool.query('DROP SCHEMA IF EXISTS mst_stellar CASCADE');
  await applyCoordinationMigrations();
});

after(async () => {
  await closeCoordinationPool();
});

test('dispatcher signs, sends, records and terminally publishes a successful delivery', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  await insertOutbox('evt-success');
  const transport = new MemoryTransport({ status: 204 });
  const result = await dispatchIntegrationWebhookEvent('evt-success', {
    credentials: new MemoryCredentialStore(credential()),
    transport,
    payloadBuilder,
    pool: coordinationPool(),
    now: () => new Date(NOW),
    webhookMasterSecret: MASTER,
  });
  assert.deepEqual(result, { status: 'delivered', httpStatus: 204 });
  assert.equal(transport.requests.length, 1);

  const request = transport.requests[0]!;
  const verifier = new Webhook(deriveIntegrationWebhookSecret('fednetwork', 3, MASTER));
  assert.deepEqual(verifier.verify(request.body, request.headers), {
    schema: 'multisigtools-integration-webhook-v1',
    type: 'work.changed',
    data: { kind: 'soroban_intent', id: 'INT1' },
  });

  const outbox = await coordinationPool().query<{ published_at: Date | null }>(
    "SELECT published_at FROM mst_stellar.integration_outbox WHERE event_id = 'evt-success'",
  );
  assert.ok(outbox.rows[0]?.published_at);
  assert.deepEqual(
    (await listIntegrationWebhookDeliveries('evt-success')).map((item) => ({
      attempt: item.attempt,
      outcome: item.outcome,
      httpStatus: item.httpStatus,
    })),
    [{ attempt: 1, outcome: 'succeeded', httpStatus: 204 }],
  );
});

test('retryable HTTP failure releases the PostgreSQL lease and schedules the next attempt', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  await insertOutbox('evt-retry');
  const result = await dispatchIntegrationWebhookEvent('evt-retry', {
    credentials: new MemoryCredentialStore(credential()),
    transport: new MemoryTransport({ status: 503 }),
    payloadBuilder,
    pool: coordinationPool(),
    now: () => new Date(NOW),
    webhookMasterSecret: MASTER,
  });
  const expectedRetry = new Date(NOW.getTime() + 5000).toISOString();
  assert.deepEqual(result, {
    status: 'retry_scheduled',
    errorCode: 'http_503',
    nextAvailableAt: expectedRetry,
  });

  const state = await coordinationPool().query<{
    published_at: Date | null;
    lease_token: string | null;
    available_at: Date;
  }>(
    "SELECT published_at, lease_token, available_at FROM mst_stellar.integration_outbox WHERE event_id = 'evt-retry'",
  );
  assert.equal(state.rows[0]?.published_at, null);
  assert.equal(state.rows[0]?.lease_token, null);
  assert.equal(state.rows[0]?.available_at.toISOString(), expectedRetry);
  assert.equal((await listIntegrationWebhookDeliveries('evt-retry'))[0]?.outcome, 'retry');
});

test('Service without an enabled webhook consumes the internal outbox event without HTTP delivery', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  await insertOutbox('evt-skipped');
  const transport = new MemoryTransport({ status: 204 });
  const result = await dispatchIntegrationWebhookEvent('evt-skipped', {
    credentials: new MemoryCredentialStore(credential({ webhook: false })),
    transport,
    payloadBuilder,
    pool: coordinationPool(),
    now: () => new Date(NOW),
    webhookMasterSecret: MASTER,
  });
  assert.deepEqual(result, { status: 'skipped', reason: 'webhook_disabled' });
  assert.equal(transport.requests.length, 0);
  assert.deepEqual(await listIntegrationWebhookDeliveries('evt-skipped'), []);
});

test('projection failure is durable audit evidence and follows the same PG retry authority', {
  skip: !TEST_URL || !RESET_ALLOWED,
}, async () => {
  await insertOutbox('evt-projection');
  const result = await dispatchIntegrationWebhookEvent('evt-projection', {
    credentials: new MemoryCredentialStore(credential()),
    transport: new MemoryTransport({ status: 204 }),
    payloadBuilder: { async build() { throw new Error('projection failed'); } },
    pool: coordinationPool(),
    now: () => new Date(NOW),
    webhookMasterSecret: MASTER,
  });
  assert.equal(result.status, 'retry_scheduled');
  const history = await listIntegrationWebhookDeliveries('evt-projection');
  assert.equal(history[0]?.outcome, 'retry');
  assert.equal(history[0]?.errorCode, 'projection_error');
});
