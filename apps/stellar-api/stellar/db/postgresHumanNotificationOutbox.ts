import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  SigningRequestNotificationSummary,
} from '../../../../packages/stellar-core/src/requestTypes.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';
import { coordinationPool, withPostgresTransaction } from './postgres.js';

export type HumanNotificationEventType = 'signature_requested' | 'signature_reminder';
export type HumanNotificationTerminalOutcome = 'sent' | 'permanent_failure';
export type HumanNotificationDeliveryOutcome = 'succeeded' | 'retry' | 'permanent_failure';

export interface HumanNotificationOutboxRecord {
  eventId: string;
  eventType: HumanNotificationEventType;
  requestId: string;
  recipientSignerAddress: string;
  actorAddress: string;
  destinationEmail: string | null;
  network: StellarNetwork;
  baseXdr: string;
  templateName?: string;
  expiresAt: string;
  createdAt: string;
  availableAt: string;
  attemptCount: number;
}

interface OutboxRow {
  event_id: string;
  event_type: HumanNotificationEventType;
  request_id: string;
  recipient_signer_address: string;
  actor_address: string;
  destination_email: string | null;
  created_at: Date | string;
  available_at: Date | string;
  attempt_count: number;
  network: StellarNetwork;
  base_xdr: string;
  reusable_template_name: string | null;
  expires_at: Date | string;
}

interface DeliveryRow {
  delivery_id: string;
  event_id: string;
  attempt: number;
  started_at: Date | string;
  completed_at: Date | string | null;
  outcome: HumanNotificationDeliveryOutcome | null;
  provider_message_id: string | null;
  http_status: number | null;
  error_code: string | null;
  duration_ms: number | null;
}

export interface HumanNotificationDeliveryRecord {
  deliveryId: string;
  eventId: string;
  attempt: number;
  startedAt: string;
  completedAt?: string;
  outcome?: HumanNotificationDeliveryOutcome;
  providerMessageId?: string;
  httpStatus?: number;
  errorCode?: string;
  durationMs?: number;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rowToOutboxRecord(row: OutboxRow): HumanNotificationOutboxRecord {
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    requestId: row.request_id,
    recipientSignerAddress: row.recipient_signer_address,
    actorAddress: row.actor_address,
    destinationEmail: row.destination_email,
    network: row.network,
    baseXdr: row.base_xdr,
    ...(row.reusable_template_name ? { templateName: row.reusable_template_name } : {}),
    expiresAt: iso(row.expires_at),
    createdAt: iso(row.created_at),
    availableAt: iso(row.available_at),
    attemptCount: row.attempt_count,
  };
}

function rowToDeliveryRecord(row: DeliveryRow): HumanNotificationDeliveryRecord {
  return {
    deliveryId: row.delivery_id,
    eventId: row.event_id,
    attempt: row.attempt,
    startedAt: iso(row.started_at),
    ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
    ...(row.outcome ? { outcome: row.outcome } : {}),
    ...(row.provider_message_id ? { providerMessageId: row.provider_message_id } : {}),
    ...(row.http_status !== null ? { httpStatus: row.http_status } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
  };
}

export function signatureRequestedNotificationEventId(
  requestId: string,
  signerAddress: string,
): string {
  return `classic_request:${requestId}:signature_requested:${signerAddress}`;
}

export function signatureReminderNotificationEventId(
  requestId: string,
  signerAddress: string,
  nonce = randomUUID(),
): string {
  return `classic_request:${requestId}:signature_reminder:${signerAddress}:${nonce}`;
}

async function enqueueHumanNotification(
  input: {
    eventId: string;
    eventType: HumanNotificationEventType;
    requestId: string;
    recipientSignerAddress: string;
    actorAddress: string;
    destinationEmail: string;
    createdAt?: Date;
  },
  pool: Pool,
): Promise<{ eventId: string; created: boolean }> {
  const createdAt = (input.createdAt ?? new Date()).toISOString();
  const result = await pool.query(
    `INSERT INTO mst_stellar.human_notification_outbox (
       event_id, event_type, request_id, recipient_signer_address, actor_address,
       destination_email, created_at, available_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     ON CONFLICT (event_id) DO NOTHING`,
    [
      input.eventId,
      input.eventType,
      input.requestId,
      input.recipientSignerAddress,
      input.actorAddress,
      input.destinationEmail,
      createdAt,
    ],
  );
  return { eventId: input.eventId, created: result.rowCount === 1 };
}

export function enqueueSignatureRequestedNotification(
  input: {
    requestId: string;
    recipientSignerAddress: string;
    actorAddress: string;
    destinationEmail: string;
    createdAt?: Date;
  },
  pool: Pool = coordinationPool(),
): Promise<{ eventId: string; created: boolean }> {
  return enqueueHumanNotification({
    ...input,
    eventId: signatureRequestedNotificationEventId(input.requestId, input.recipientSignerAddress),
    eventType: 'signature_requested',
  }, pool);
}

export function enqueueSignatureReminderNotification(
  input: {
    requestId: string;
    recipientSignerAddress: string;
    actorAddress: string;
    destinationEmail: string;
    createdAt?: Date;
    eventId?: string;
  },
  pool: Pool = coordinationPool(),
): Promise<{ eventId: string; created: boolean }> {
  return enqueueHumanNotification({
    ...input,
    eventId: input.eventId ?? signatureReminderNotificationEventId(input.requestId, input.recipientSignerAddress),
    eventType: 'signature_reminder',
  }, pool);
}

interface NotificationSummaryRow {
  event_type: HumanNotificationEventType;
  recipient_signer_address: string;
  actor_address: string;
  created_at: Date | string;
  last_attempt_at: Date | string | null;
  completed_at: Date | string | null;
  outcome: HumanNotificationTerminalOutcome | null;
  terminal_error_code: string | null;
}

export async function listLatestHumanNotificationSummaries(
  requestId: string,
  pool: Pool = coordinationPool(),
): Promise<SigningRequestNotificationSummary[]> {
  const result = await pool.query<NotificationSummaryRow>(
    `SELECT DISTINCT ON (recipient_signer_address)
            event_type, recipient_signer_address, actor_address, created_at,
            last_attempt_at, completed_at, outcome, terminal_error_code
       FROM mst_stellar.human_notification_outbox
      WHERE request_id = $1
      ORDER BY recipient_signer_address, created_at DESC, event_id DESC`,
    [requestId],
  );
  return result.rows.map((row) => ({
    channel: 'email' as const,
    eventType: row.event_type,
    signerAddress: row.recipient_signer_address,
    actorAddress: row.actor_address,
    state: row.outcome === 'sent'
      ? 'provider_accepted' as const
      : row.outcome === 'permanent_failure'
        ? 'failed' as const
        : 'queued' as const,
    createdAt: iso(row.created_at),
    ...(row.last_attempt_at ? { lastAttemptAt: iso(row.last_attempt_at) } : {}),
    ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
    ...(row.terminal_error_code ? { errorCode: row.terminal_error_code } : {}),
  }));
}

export async function listDueHumanNotificationEventIds(
  options: { now?: Date; limit?: number; pool?: Pool } = {},
): Promise<string[]> {
  const pool = options.pool ?? coordinationPool();
  const now = (options.now ?? new Date()).toISOString();
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const result = await pool.query<{ event_id: string }>(
    `SELECT event_id
       FROM mst_stellar.human_notification_outbox
      WHERE completed_at IS NULL
        AND available_at <= $1
        AND (lease_until IS NULL OR lease_until <= $1)
      ORDER BY available_at, created_at, event_id
      LIMIT $2`,
    [now, limit],
  );
  return result.rows.map((row) => row.event_id);
}

export async function claimHumanNotificationEvent(
  eventId: string,
  options: {
    now?: Date;
    leaseSeconds?: number;
    leaseToken?: string;
    pool?: Pool;
  } = {},
): Promise<{ record: HumanNotificationOutboxRecord; leaseToken: string } | null> {
  const pool = options.pool ?? coordinationPool();
  const now = options.now ?? new Date();
  const leaseSeconds = Math.max(15, Math.min(options.leaseSeconds ?? 120, 900));
  const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
  const leaseToken = options.leaseToken ?? randomUUID();

  return withPostgresTransaction(pool, async (client) => {
    const result = await client.query<OutboxRow>(
      `UPDATE mst_stellar.human_notification_outbox AS o
          SET lease_token = $2,
              lease_until = $3,
              attempt_count = attempt_count + 1,
              last_attempt_at = $4
         FROM mst_stellar.classic_requests AS r
         LEFT JOIN mst_stellar.reusable_templates AS t
           ON t.id = r.reusable_template_id
        WHERE o.event_id = $1
          AND r.id = o.request_id
          AND o.completed_at IS NULL
          AND o.available_at <= $4
          AND (o.lease_until IS NULL OR o.lease_until <= $4)
      RETURNING o.event_id, o.event_type, o.request_id, o.recipient_signer_address,
                o.actor_address, o.destination_email, o.created_at, o.available_at,
                o.attempt_count, r.network, r.base_xdr,
                t.name AS reusable_template_name, r.expires_at`,
      [eventId, leaseToken, leaseUntil, now.toISOString()],
    );
    const row = result.rows[0];
    return row ? { record: rowToOutboxRecord(row), leaseToken } : null;
  });
}

export async function releaseHumanNotificationEvent(
  eventId: string,
  leaseToken: string,
  nextAvailableAt: Date,
  pool: Pool = coordinationPool(),
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE mst_stellar.human_notification_outbox
        SET available_at = $3,
            lease_token = NULL,
            lease_until = NULL
      WHERE event_id = $1
        AND lease_token = $2
        AND completed_at IS NULL`,
    [eventId, leaseToken, nextAvailableAt.toISOString()],
  );
  return result.rowCount === 1;
}

export async function completeHumanNotificationEvent(
  eventId: string,
  leaseToken: string,
  input: {
    outcome: HumanNotificationTerminalOutcome;
    completedAt?: Date;
    providerMessageId?: string;
    errorCode?: string;
  },
  pool: Pool = coordinationPool(),
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE mst_stellar.human_notification_outbox
        SET completed_at = $3,
            outcome = $4,
            provider_message_id = $5,
            terminal_error_code = $6,
            destination_email = NULL,
            lease_token = NULL,
            lease_until = NULL
      WHERE event_id = $1
        AND lease_token = $2
        AND completed_at IS NULL`,
    [
      eventId,
      leaseToken,
      (input.completedAt ?? new Date()).toISOString(),
      input.outcome,
      input.providerMessageId ?? null,
      input.errorCode ?? null,
    ],
  );
  return result.rowCount === 1;
}

export function humanNotificationDeliveryId(eventId: string, attempt: number): string {
  return `${eventId}:${attempt}`;
}

export async function startHumanNotificationDelivery(
  input: {
    eventId: string;
    attempt: number;
    startedAt?: Date;
  },
  pool: Pool = coordinationPool(),
): Promise<HumanNotificationDeliveryRecord> {
  const deliveryId = humanNotificationDeliveryId(input.eventId, input.attempt);
  const startedAt = (input.startedAt ?? new Date()).toISOString();
  const result = await pool.query<DeliveryRow>(
    `INSERT INTO mst_stellar.human_notification_deliveries (
       delivery_id, event_id, attempt, started_at
     ) VALUES ($1, $2, $3, $4)
     ON CONFLICT (event_id, attempt) DO UPDATE
       SET delivery_id = mst_stellar.human_notification_deliveries.delivery_id
     RETURNING delivery_id, event_id, attempt, started_at, completed_at, outcome,
               provider_message_id, http_status, error_code, duration_ms`,
    [deliveryId, input.eventId, input.attempt, startedAt],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Unable to persist Human notification delivery start.');
  return rowToDeliveryRecord(row);
}

export async function findSucceededHumanNotificationDelivery(
  eventId: string,
  pool: Pool = coordinationPool(),
): Promise<HumanNotificationDeliveryRecord | null> {
  const result = await pool.query<DeliveryRow>(
    `SELECT delivery_id, event_id, attempt, started_at, completed_at, outcome,
            provider_message_id, http_status, error_code, duration_ms
       FROM mst_stellar.human_notification_deliveries
      WHERE event_id = $1
        AND outcome = 'succeeded'
        AND provider_message_id IS NOT NULL
      ORDER BY attempt DESC
      LIMIT 1`,
    [eventId],
  );
  const row = result.rows[0];
  return row ? rowToDeliveryRecord(row) : null;
}

export async function completeHumanNotificationDelivery(
  deliveryId: string,
  input: {
    outcome: HumanNotificationDeliveryOutcome;
    completedAt?: Date;
    providerMessageId?: string;
    httpStatus?: number;
    errorCode?: string;
    durationMs?: number;
  },
  pool: Pool = coordinationPool(),
): Promise<HumanNotificationDeliveryRecord | null> {
  const result = await pool.query<DeliveryRow>(
    `UPDATE mst_stellar.human_notification_deliveries
        SET completed_at = $2,
            outcome = $3,
            provider_message_id = $4,
            http_status = $5,
            error_code = $6,
            duration_ms = $7
      WHERE delivery_id = $1
      RETURNING delivery_id, event_id, attempt, started_at, completed_at, outcome,
                provider_message_id, http_status, error_code, duration_ms`,
    [
      deliveryId,
      (input.completedAt ?? new Date()).toISOString(),
      input.outcome,
      input.providerMessageId ?? null,
      input.httpStatus ?? null,
      input.errorCode ?? null,
      input.durationMs ?? null,
    ],
  );
  const row = result.rows[0];
  return row ? rowToDeliveryRecord(row) : null;
}
