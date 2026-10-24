import type { Pool } from 'pg';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';
import { coordinationPool } from './postgres.js';

export type IntegrationWorkKind = 'classic_request' | 'soroban_intent';

export interface IntegrationWorkReference {
  kind: IntegrationWorkKind;
  id: string;
  network: StellarNetwork;
  externalReference?: string;
  createdAt: string;
}

export interface IntegrationWorkPage {
  items: IntegrationWorkReference[];
  nextCursor?: string;
}

interface Cursor {
  createdAt: string;
  kind: IntegrationWorkKind;
  id: string;
}

interface WorkRow {
  kind: IntegrationWorkKind;
  id: string;
  network: StellarNetwork;
  external_reference: string | null;
  created_at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function encodeCursor(value: Cursor): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (
      typeof parsed.createdAt !== 'string'
      || Number.isNaN(Date.parse(parsed.createdAt))
      || (parsed.kind !== 'classic_request' && parsed.kind !== 'soroban_intent')
      || typeof parsed.id !== 'string'
      || !parsed.id
    ) return null;
    return { createdAt: parsed.createdAt, kind: parsed.kind, id: parsed.id };
  } catch {
    return null;
  }
}

export class IntegrationActivityCursorError extends Error {
  constructor() {
    super('Invalid Integration Service Activity cursor.');
    this.name = 'IntegrationActivityCursorError';
  }
}

export async function listIntegrationWorkPage(
  serviceId: string,
  options: {
    network?: StellarNetwork;
    limit?: number;
    cursor?: string;
    pool?: Pool;
  } = {},
): Promise<IntegrationWorkPage> {
  const normalizedServiceId = serviceId.trim().toLowerCase();
  if (!normalizedServiceId) throw new Error('Integration service id is required.');
  const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
  const cursor = decodeCursor(options.cursor);
  if (options.cursor && !cursor) throw new IntegrationActivityCursorError();
  const pool = options.pool ?? coordinationPool();
  const result = await pool.query<WorkRow>(
    `SELECT kind, id, network, external_reference, created_at
       FROM mst_stellar.integration_work
      WHERE service_id = $1
        AND ($2::text IS NULL OR network = $2)
        AND (
          $3::timestamptz IS NULL
          OR created_at < $3::timestamptz
          OR (created_at = $3::timestamptz AND kind < $4)
          OR (created_at = $3::timestamptz AND kind = $4 AND id < $5)
        )
      ORDER BY created_at DESC, kind DESC, id DESC
      LIMIT $6`,
    [
      normalizedServiceId,
      options.network ?? null,
      cursor?.createdAt ?? null,
      cursor?.kind ?? '',
      cursor?.id ?? '',
      limit + 1,
    ],
  );
  const pageRows = result.rows.slice(0, limit);
  const items = pageRows.map((row) => ({
    kind: row.kind,
    id: row.id,
    network: row.network,
    ...(row.external_reference ? { externalReference: row.external_reference } : {}),
    createdAt: iso(row.created_at),
  }));
  const last = pageRows[pageRows.length - 1];
  return {
    items,
    ...(result.rows.length > limit && last
      ? { nextCursor: encodeCursor({ createdAt: iso(last.created_at), kind: last.kind, id: last.id }) }
      : {}),
  };
}
