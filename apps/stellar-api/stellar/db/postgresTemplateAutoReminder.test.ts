import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Keypair } from '@stellar/stellar-sdk';
import { applyCoordinationMigrations } from './migrate.js';
import { closeCoordinationPool, coordinationPool } from './postgres.js';
import {
  enqueueTemplateRemindersFromAsk,
  templateReminderDispatchDecision,
  listLatestHumanNotificationSummaries,
  signatureRequestedNotificationEventId,
  templateAutoReminderEventId,
} from './postgresHumanNotificationOutbox.js';
import { dispatchHumanNotificationEvent } from '../server/humanNotificationDispatcher.js';

const URL = process.env.MST_POSTGRES_TEST_URL?.trim();
const ENABLED = Boolean(URL && process.env.MST_POSTGRES_TEST_ALLOW_RESET === '1');
if (URL) process.env.DATABASE_URL = URL;

before(async () => {
  if (!ENABLED) return;
  const db = coordinationPool();
  await db.query('DROP SCHEMA IF EXISTS mst_stellar CASCADE');
  await applyCoordinationMigrations();
});
after(async () => { if (ENABLED) await closeCoordinationPool(); });

test('template reminder SQL selects a single opted-in, delivered, due assignment and skips after quorum', {
  skip: !ENABLED,
}, async () => {
  const db = coordinationPool();
  const sender = Keypair.random().publicKey();
  const signer = Keypair.random().publicKey();
  const requestId = '0123456789ABCDEF';
  const templateId = 'tpl_abcdefghijklmnop';
  const assignedAt = new Date('2026-11-19T20:00:00Z');
  const dueAt = new Date('2026-11-20T13:00:00Z');
  await db.query(
    `INSERT INTO mst_stellar.reusable_templates
       (id, owner_address, network, name, kind, current_version, created_at, updated_at)
     VALUES ($1, $2, 'testnet', 'Monthly supplier payment', 'payment', 1, $3, $3)`,
    [templateId, sender, assignedAt],
  );
  await db.query(
    `INSERT INTO mst_stellar.reusable_template_versions
       (template_id, version, definition, created_at)
     VALUES ($1, 1, $2, $3)`,
    [templateId, JSON.stringify({ version: 1, source: sender, recipients: [], signingWindowSeconds: 86400, autoRemind: true }), assignedAt],
  );
  await db.query(
    `INSERT INTO mst_stellar.classic_requests
       (id, network, base_xdr, transaction_hash, created_at, expires_at,
        creator_address, reusable_template_id, reusable_template_version)
     VALUES ($1, 'testnet', 'AAAA', $2, $3, '2026-11-30T00:00:00Z', $4, $5, 1)`,
    [requestId, 'a'.repeat(64), assignedAt, sender, templateId],
  );
  await db.query(
    `INSERT INTO mst_stellar.classic_request_assignments
       (request_id, signer_address, assigned_by_address, assigned_at)
     VALUES ($1, $2, $3, $4)`,
    [requestId, signer, sender, assignedAt],
  );
  await db.query(
    `INSERT INTO mst_stellar.human_notification_outbox
       (event_id, event_type, request_id, recipient_signer_address,
        actor_address, created_at, available_at, completed_at, outcome, provider_message_id)
     VALUES ($1, 'signature_requested', $2, $3, $4, $5, $5, $5, 'sent', 'resend-qa-001')`,
    [signatureRequestedNotificationEventId(requestId, signer), requestId, signer, sender, assignedAt],
  );

  const data = { requestId, signerAddress: signer, assignedByAddress: sender,
    destinationEmail: 'signer@example.org', assignedAt };
  assert.equal(await enqueueTemplateRemindersFromAsk(data, db), 2);
  assert.equal(await enqueueTemplateRemindersFromAsk(data, db), 0);
  const rows = await db.query<{ event_id: string; available_at: Date | string }>(
    `SELECT event_id, available_at FROM mst_stellar.human_notification_outbox
       WHERE event_type = 'signature_reminder' ORDER BY event_id`,
  );
  assert.deepEqual(rows.rows.map((row) => row.event_id), [
    templateAutoReminderEventId(requestId, signer, 1),
    templateAutoReminderEventId(requestId, signer, 2),
  ]);
  assert.equal(new Date(rows.rows[0].available_at).toISOString(), '2026-11-20T08:00:00.000Z');
  assert.equal(new Date(rows.rows[1].available_at).toISOString(), '2026-11-21T08:00:00.000Z');
  const id = templateAutoReminderEventId(requestId, signer, 1);
  assert.deepEqual(await templateReminderDispatchDecision(id, dueAt, db), { state: 'send' });

  let sent = 0;
  const skipped = await dispatchHumanNotificationEvent(id, {
    pool: db,
    now: () => new Date('2026-11-20T13:00:01Z'),
    automationEnabled: true,
    verifyTemplateReminder: async () => false,
    sendEmail: async () => { sent += 1; throw Error('must not send'); },
  });
  assert.deepEqual(skipped, { status: 'skipped' });
  assert.equal(sent, 0);

  const row = await db.query<{ outcome: string; destination_email: string | null }>(
    'SELECT outcome, destination_email FROM mst_stellar.human_notification_outbox WHERE event_id = $1', [id],
  );
  assert.deepEqual(row.rows, [{ outcome: 'skipped', destination_email: null }]);
  const summary = await listLatestHumanNotificationSummaries(requestId, db);
  assert.equal(summary.length, 1);
  assert.equal(summary[0].eventType, 'signature_requested');

  // A skipped reminder must neither show as delivery failure nor trigger stage 2.
  const secondId = templateAutoReminderEventId(requestId, signer, 2);
  assert.deepEqual(await templateReminderDispatchDecision(
    secondId, new Date('2026-11-22T13:00:00Z'), db,
  ), { state: 'skip' });

  // A successful first reminder starts a new 24-hour cooldown. Slot 2
  // cannot send just because its nominal scheduled timestamp has passed.
  await db.query(
    `UPDATE mst_stellar.human_notification_outbox
       SET outcome = 'sent', completed_at = '2026-11-22T13:00:00Z', terminal_error_code = NULL
     WHERE event_id = $1`, [id],
  );
  const tooSoon = await templateReminderDispatchDecision(
    secondId, new Date('2026-11-23T12:59:00Z'), db,
  );
  assert.deepEqual(tooSoon, {
    state: 'wait', retryAt: new Date('2026-11-23T13:00:00Z'),
  });
  assert.deepEqual(await templateReminderDispatchDecision(
    secondId, new Date('2026-11-23T13:00:00Z'), db,
  ), { state: 'send' });

  // A bounced original invitation must stop an automatic follow-up.
  await db.query(
    `UPDATE mst_stellar.human_notification_outbox
       SET provider_delivery_state = 'bounced'
     WHERE event_id = $1`, [signatureRequestedNotificationEventId(requestId, signer)],
  );
  assert.deepEqual(await templateReminderDispatchDecision(
    secondId, new Date('2026-11-23T13:00:00Z'), db,
  ), { state: 'skip' });
});
