import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { coordinationPool } from './postgres.js';

export type IntegrationWebhookDeliveryOutcome =
  | 'succeeded'
  | 'retry'
  | 'permanent_failure';

export interface IntegrationWebhookDeliveryRecord {
  deliveryId: string;
  eventId: string;
  serviceId: string;
  attempt: number;
  endpointHash: string;
  startedAt: string;
  completedAt?: string;
  outcome?: IntegrationWebhookDeliveryOutcome;
  httpStatus?: number;
  errorCode?: string;
  durationMs?: number;
}

export type IntegrationWebhookDeliveryStatus =
  | 'pending'
  | 'retrying'
  | 'delivered'
  | 'failed'
  | 'not_sent';

export interface IntegrationWebhookDeliverySummary {
  eventId: string;
  serviceId: string;
  resourceKind: 'classic_request' | 'soroban_intent';
  resourceId: string;
  eventType: string;
  createdAt: string;
  availableAt: string;
  publishedAt?: string;
  attemptCount: number;
  lastAttemptAt?: string;
  status: IntegrationWebhookDeliveryStatus;
  latestDelivery?: IntegrationWebhookDeliveryRecord;
}

interface DeliveryRow {
  delivery_id: string;
  event_id: string;
  service_id: string;
  attempt: number;
  endpoint_hash: string;
  started_at: Date | string;
  completed_at: Date | string | null;
  outcome: IntegrationWebhookDeliveryOutcome | null;
  http_status: number | null;
  error_code: string | null;
  duration_ms: number | null;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rowToRecord(row: DeliveryRow): IntegrationWebhookDeliveryRecord {
  return {
    deliveryId: row.delivery_id,
    eventId: row.event_id,
    serviceId: row.service_id,
    attempt: row.attempt,
    endpointHash: row.endpoint_hash,
    startedAt: iso(row.started_at),
    ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
    ...(row.outcome ? { outcome: row.outcome } : {}),
    ...(row.http_status !== null ? { httpStatus: row.http_status } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
  };
}

export function integrationWebhookEndpointHash(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

export function integrationWebhookDeliveryId(eventId: string, attempt: number): string {
  return `${eventId}:${attempt}`;
}

export async function startIntegrationWebhookDelivery(
  input: {
    eventId: string;
    serviceId: string;
    attempt: number;
    endpointUrl: string;
    startedAt?: Date;
  },
  pool: Pool = coordinationPool(),
): Promise<IntegrationWebhookDeliveryRecord> {
  const deliveryId = integrationWebhookDeliveryId(input.eventId, input.attempt);
  const endpointHash = integrationWebhookEndpointHash(input.endpointUrl);
  const startedAt = (input.startedAt ?? new Date()).toISOString();
  const result = await pool.query<DeliveryRow>(
    `INSERT INTO mst_stellar.integration_webhook_deliveries (
       delivery_id, event_id, service_id, attempt, endpoint_hash, started_at
     ) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (event_id, attempt) DO UPDATE
       SET delivery_id = mst_stellar.integration_webhook_deliveries.delivery_id
     RETURNING delivery_id, event_id, service_id, attempt, endpoint_hash, started_at,
               completed_at, outcome, http_status, error_code, duration_ms`,
    [deliveryId, input.eventId, input.serviceId, input.attempt, endpointHash, startedAt],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Unable to persist Integration webhook delivery start.');
  return rowToRecord(row);
}

export async function completeIntegrationWebhookDelivery(
  deliveryId: string,
  input: {
    outcome: IntegrationWebhookDeliveryOutcome;
    completedAt?: Date;
    httpStatus?: number;
    errorCode?: string;
    durationMs?: number;
  },
  pool: Pool = coordinationPool(),
): Promise<IntegrationWebhookDeliveryRecord | null> {
  const completedAt = (input.completedAt ?? new Date()).toISOString();
  const result = await pool.query<DeliveryRow>(
    `UPDATE mst_stellar.integration_webhook_deliveries
        SET completed_at = $2,
            outcome = $3,
            http_status = $4,
            error_code = $5,
            duration_ms = $6
      WHERE delivery_id = $1
      RETURNING delivery_id, event_id, service_id, attempt, endpoint_hash, started_at,
                completed_at, outcome, http_status, error_code, duration_ms`,
    [
      deliveryId,
      completedAt,
      input.outcome,
      input.httpStatus ?? null,
      input.errorCode ?? null,
      input.durationMs ?? null,
    ],
  );
  const row = result.rows[0];
  return row ? rowToRecord(row) : null;
}

export async function listIntegrationWebhookDeliveries(
  eventId: string,
  pool: Pool = coordinationPool(),
): Promise<IntegrationWebhookDeliveryRecord[]> {
  const result = await pool.query<DeliveryRow>(
    `SELECT delivery_id, event_id, service_id, attempt, endpoint_hash, started_at,
            completed_at, outcome, http_status, error_code, duration_ms
       FROM mst_stellar.integration_webhook_deliveries
      WHERE event_id = $1
      ORDER BY attempt`,
    [eventId],
  );
  return result.rows.map(rowToRecord);
}

interface DeliverySummaryRow {
  event_id: string;
  service_id: string;
  resource_kind: IntegrationWebhookDeliverySummary['resourceKind'];
  resource_id: string;
  event_type: string;
  created_at: Date | string;
  available_at: Date | string;
  published_at: Date | string | null;
  attempt_count: number;
  last_attempt_at: Date | string | null;
  delivery_id: string | null;
  delivery_attempt: number | null;
  endpoint_hash: string | null;
  delivery_started_at: Date | string | null;
  delivery_completed_at: Date | string | null;
  delivery_outcome: IntegrationWebhookDeliveryOutcome | null;
  http_status: number | null;
  error_code: string | null;
  duration_ms: number | null;
}

function summaryStatus(row: DeliverySummaryRow): IntegrationWebhookDeliveryStatus {
  if (row.delivery_outcome === 'succeeded') return 'delivered';
  if (row.delivery_outcome === 'permanent_failure') return 'failed';
  if (row.delivery_outcome === 'retry') return 'retrying';
  if (row.published_at) return 'not_sent';
  return 'pending';
}

export async function listRecentIntegrationWebhookDeliverySummaries(
  serviceId: string,
  options: { limit?: number; pool?: Pool } = {},
): Promise<IntegrationWebhookDeliverySummary[]> {
  const pool = options.pool ?? coordinationPool();
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  const result = await pool.query<DeliverySummaryRow>(
    `SELECT o.event_id, o.service_id, o.resource_kind, o.resource_id, o.event_type,
            o.created_at, o.available_at, o.published_at, o.attempt_count, o.last_attempt_at,
            d.delivery_id, d.attempt AS delivery_attempt, d.endpoint_hash,
            d.started_at AS delivery_started_at, d.completed_at AS delivery_completed_at,
            d.outcome AS delivery_outcome, d.http_status, d.error_code, d.duration_ms
       FROM mst_stellar.integration_outbox o
       LEFT JOIN LATERAL (
         SELECT delivery_id, attempt, endpoint_hash, started_at, completed_at,
                outcome, http_status, error_code, duration_ms
           FROM mst_stellar.integration_webhook_deliveries
          WHERE event_id = o.event_id
          ORDER BY attempt DESC
          LIMIT 1
       ) d ON TRUE
      WHERE o.service_id = $1
      ORDER BY o.created_at DESC, o.event_id DESC
      LIMIT $2`,
    [serviceId, limit],
  );
  return result.rows.map((row) => ({
    eventId: row.event_id,
    serviceId: row.service_id,
    resourceKind: row.resource_kind,
    resourceId: row.resource_id,
    eventType: row.event_type,
    createdAt: iso(row.created_at),
    availableAt: iso(row.available_at),
    ...(row.published_at ? { publishedAt: iso(row.published_at) } : {}),
    attemptCount: row.attempt_count,
    ...(row.last_attempt_at ? { lastAttemptAt: iso(row.last_attempt_at) } : {}),
    status: summaryStatus(row),
    ...(row.delivery_id && row.delivery_attempt !== null && row.endpoint_hash && row.delivery_started_at
      ? {
          latestDelivery: {
            deliveryId: row.delivery_id,
            eventId: row.event_id,
            serviceId: row.service_id,
            attempt: row.delivery_attempt,
            endpointHash: row.endpoint_hash,
            startedAt: iso(row.delivery_started_at),
            ...(row.delivery_completed_at ? { completedAt: iso(row.delivery_completed_at) } : {}),
            ...(row.delivery_outcome ? { outcome: row.delivery_outcome } : {}),
            ...(row.http_status !== null ? { httpStatus: row.http_status } : {}),
            ...(row.error_code ? { errorCode: row.error_code } : {}),
            ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
          },
        }
      : {}),
  }));
}
