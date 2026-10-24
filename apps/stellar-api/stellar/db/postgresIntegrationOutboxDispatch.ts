import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { coordinationPool, withPostgresTransaction } from './postgres.js';

export interface IntegrationOutboxRecord {
  eventId: string;
  serviceId: string;
  resourceKind: 'classic_request' | 'soroban_intent';
  resourceId: string;
  eventType: string;
  eventVersion: number;
  payload: unknown;
  createdAt: string;
  availableAt: string;
  attemptCount: number;
}

interface OutboxRow {
  event_id: string;
  service_id: string;
  resource_kind: IntegrationOutboxRecord['resourceKind'];
  resource_id: string;
  event_type: string;
  event_version: number;
  payload: unknown;
  created_at: Date | string;
  available_at: Date | string;
  attempt_count: number;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toRecord(row: OutboxRow): IntegrationOutboxRecord {
  return {
    eventId: row.event_id,
    serviceId: row.service_id,
    resourceKind: row.resource_kind,
    resourceId: row.resource_id,
    eventType: row.event_type,
    eventVersion: row.event_version,
    payload: row.payload,
    createdAt: iso(row.created_at),
    availableAt: iso(row.available_at),
    attemptCount: row.attempt_count,
  };
}

export async function listDueIntegrationOutboxEventIds(
  options: {
    now?: Date;
    limit?: number;
    pool?: Pool;
  } = {},
): Promise<string[]> {
  const pool = options.pool ?? coordinationPool();
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const now = (options.now ?? new Date()).toISOString();
  const result = await pool.query<{ event_id: string }>(
    `SELECT event_id
       FROM mst_stellar.integration_outbox
      WHERE published_at IS NULL
        AND available_at <= $1
        AND (lease_until IS NULL OR lease_until <= $1)
      ORDER BY available_at, created_at, event_id
      LIMIT $2`,
    [now, limit],
  );
  return result.rows.map((row) => row.event_id);
}

export async function claimIntegrationOutboxEvent(
  eventId: string,
  options: {
    now?: Date;
    leaseSeconds?: number;
    leaseToken?: string;
    pool?: Pool;
  } = {},
): Promise<{ record: IntegrationOutboxRecord; leaseToken: string } | null> {
  const pool = options.pool ?? coordinationPool();
  const now = options.now ?? new Date();
  const leaseSeconds = Math.max(15, Math.min(options.leaseSeconds ?? 120, 900));
  const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
  const leaseToken = options.leaseToken ?? randomUUID();

  return withPostgresTransaction(pool, async (client) => {
    const result = await client.query<OutboxRow>(
      `UPDATE mst_stellar.integration_outbox
          SET lease_token = $2,
              lease_until = $3,
              attempt_count = attempt_count + 1,
              last_attempt_at = $4
        WHERE event_id = $1
          AND published_at IS NULL
          AND available_at <= $4
          AND (lease_until IS NULL OR lease_until <= $4)
      RETURNING event_id, service_id, resource_kind, resource_id,
                event_type, event_version, payload, created_at, available_at,
                attempt_count`,
      [eventId, leaseToken, leaseUntil, now.toISOString()],
    );
    const row = result.rows[0];
    return row ? { record: toRecord(row), leaseToken } : null;
  });
}

export async function markIntegrationOutboxPublished(
  eventId: string,
  leaseToken: string,
  options: { publishedAt?: Date; pool?: Pool } = {},
): Promise<boolean> {
  const pool = options.pool ?? coordinationPool();
  const publishedAt = (options.publishedAt ?? new Date()).toISOString();
  const result = await pool.query(
    `UPDATE mst_stellar.integration_outbox
        SET published_at = $3,
            lease_token = NULL,
            lease_until = NULL
      WHERE event_id = $1
        AND lease_token = $2
        AND published_at IS NULL`,
    [eventId, leaseToken, publishedAt],
  );
  return result.rowCount === 1;
}

export async function releaseIntegrationOutboxEvent(
  eventId: string,
  leaseToken: string,
  options: {
    nextAvailableAt: Date;
    pool?: Pool;
  },
): Promise<boolean> {
  const pool = options.pool ?? coordinationPool();
  const result = await pool.query(
    `UPDATE mst_stellar.integration_outbox
        SET available_at = $3,
            lease_token = NULL,
            lease_until = NULL
      WHERE event_id = $1
        AND lease_token = $2
        AND published_at IS NULL`,
    [eventId, leaseToken, options.nextAvailableAt.toISOString()],
  );
  return result.rowCount === 1;
}
