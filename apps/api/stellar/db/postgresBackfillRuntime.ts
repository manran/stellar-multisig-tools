import { list } from '@vercel/blob';
import type { Pool } from 'pg';
import { backfillCoordinationData, type CoordinationBackfillReport } from './postgresBackfill.js';
import { coordinationPool } from './postgres.js';
import { createPostgresSigningRequestStore } from './postgresSigningRequestStore.js';
import { createPostgresSorobanIntentStore } from './postgresSorobanIntentStore.js';
import { blobSigningRequestStore, withBlobStorage } from '../server/blobRequestStore.js';
import { blobSorobanIntentStore } from '../server/blobSorobanIntentStore.js';
import { isValidSigningRequestId } from '../server/requestLocator.js';
import type { StoredSorobanIntent } from '../server/sorobanIntentStore.js';
import type { StellarNetwork } from '../../../../src/stellar/types.js';

const REQUIRED_MIGRATION = '0006_classic_managed_channel_leases';

export interface RuntimeCoordinationBackfillReport extends CoordinationBackfillReport {
  network: StellarNetwork;
  outboxCountBefore: number;
  outboxCountAfter: number;
}

export async function assertCoordinationBackfillSchemaReady(
  pool: Pool = coordinationPool(),
): Promise<void> {
  try {
    const result = await pool.query<{ version: string }>(
      'SELECT version FROM mst_stellar.schema_migrations WHERE version = $1',
      [REQUIRED_MIGRATION],
    );
    if (result.rowCount !== 1) throw new Error('missing');
  } catch {
    throw new Error(
      `PostgreSQL coordination schema is not ready. Run npm run db:migrate first and require ${REQUIRED_MIGRATION}.`,
    );
  }
}

async function blobSorobanIntentIds(): Promise<string[]> {
  return withBlobStorage(async () => {
    const ids = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: 'intents/', limit: 100, cursor });
      for (const blob of page.blobs) {
        const match = /^intents\/([^/]+)\/intent\.json$/.exec(blob.pathname);
        const id = match?.[1]?.toUpperCase();
        if (id && isValidSigningRequestId(id)) ids.add(id);
      }
      cursor = page.cursor;
    } while (cursor);
    return [...ids].sort();
  });
}

async function loadBlobSorobanIntents(network: StellarNetwork): Promise<StoredSorobanIntent[]> {
  const ids = await blobSorobanIntentIds();
  const values: StoredSorobanIntent[] = [];
  const concurrency = 8;
  for (let index = 0; index < ids.length; index += concurrency) {
    const batch = await Promise.all(
      ids.slice(index, index + concurrency)
        .map((id) => blobSorobanIntentStore.getIntent(id)),
    );
    for (const value of batch) {
      if (value?.network === network) values.push(value);
    }
  }
  return values.sort((a, b) => a.id.localeCompare(b.id));
}

export async function runRuntimeCoordinationBackfill(
  network: StellarNetwork,
  pool: Pool = coordinationPool(),
): Promise<RuntimeCoordinationBackfillReport> {
  await assertCoordinationBackfillSchemaReady(pool);
  if (!blobSigningRequestStore.listRequests) {
    throw new Error('Blob Request store cannot enumerate legacy Requests for backfill.');
  }

  const requests = (await blobSigningRequestStore.listRequests())
    .filter((request) => request.network === network)
    .sort((a, b) => a.id.localeCompare(b.id));
  const intents = await loadBlobSorobanIntents(network);

  const outboxBefore = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM mst_stellar.integration_outbox',
  );
  const report = await backfillCoordinationData({
    requests,
    intents,
    sourceRequests: blobSigningRequestStore,
    sourceIntents: blobSorobanIntentStore,
    targetRequests: createPostgresSigningRequestStore(pool, undefined, { emitOutbox: false }),
    targetIntents: createPostgresSorobanIntentStore(pool, undefined, { emitOutbox: false }),
  });
  const outboxAfter = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM mst_stellar.integration_outbox',
  );

  const outboxCountBefore = Number(outboxBefore.rows[0]?.count ?? '0');
  const outboxCountAfter = Number(outboxAfter.rows[0]?.count ?? '0');
  if (outboxCountBefore !== outboxCountAfter) {
    throw new Error('Backfill unexpectedly changed the Integration outbox.');
  }

  return {
    network,
    ...report,
    outboxCountBefore,
    outboxCountAfter,
  };
}
