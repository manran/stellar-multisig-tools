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
