import { list } from '@vercel/blob';
import { applyCoordinationMigrations } from '../apps/api/stellar/db/migrate.js';
import { backfillCoordinationData } from '../apps/api/stellar/db/postgresBackfill.js';
import { closeCoordinationPool, coordinationPool } from '../apps/api/stellar/db/postgres.js';
import { createPostgresSigningRequestStore } from '../apps/api/stellar/db/postgresSigningRequestStore.js';
import { createPostgresSorobanIntentStore } from '../apps/api/stellar/db/postgresSorobanIntentStore.js';
import { blobSigningRequestStore, withBlobStorage } from '../apps/api/stellar/server/blobRequestStore.js';
import { blobSorobanIntentStore } from '../apps/api/stellar/server/blobSorobanIntentStore.js';
import { isValidSigningRequestId } from '../apps/api/stellar/server/requestLocator.js';
import type { StoredSorobanIntent } from '../apps/api/stellar/server/sorobanIntentStore.js';
import type { StellarNetwork } from '../src/stellar/types.js';

function requestedNetwork(): StellarNetwork {
  const value = process.env.MST_COORDINATION_BACKFILL_NETWORK?.trim();
  if (value !== 'testnet' && value !== 'public') {
    throw new Error('Set MST_COORDINATION_BACKFILL_NETWORK to testnet or public.');
  }
  if (process.env.MST_COORDINATION_BACKFILL_WRITE !== '1') {
    throw new Error('Set MST_COORDINATION_BACKFILL_WRITE=1 to acknowledge that this command writes PostgreSQL and dedicated private-context Blob records.');
  }
  if (value === 'public' && process.env.MST_ALLOW_MAINNET_COORDINATION_BACKFILL !== '1') {
    throw new Error('Mainnet coordination backfill is frozen. Set MST_ALLOW_MAINNET_COORDINATION_BACKFILL=1 only after an explicit Mainnet migration decision.');
  }
  return value;
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
    const batch = await Promise.all(ids.slice(index, index + concurrency)
      .map((id) => blobSorobanIntentStore.getIntent(id)));
    for (const value of batch) {
      if (value?.network === network) values.push(value);
    }
  }
  return values.sort((a, b) => a.id.localeCompare(b.id));
}

const network = requestedNetwork();

try {
  await applyCoordinationMigrations();
  if (!blobSigningRequestStore.listRequests) {
    throw new Error('Blob Request store cannot enumerate legacy Requests for backfill.');
  }
  const requests = (await blobSigningRequestStore.listRequests())
    .filter((request) => request.network === network)
    .sort((a, b) => a.id.localeCompare(b.id));
  const intents = await loadBlobSorobanIntents(network);

  const pool = coordinationPool();
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
  if (outboxBefore.rows[0]?.count !== outboxAfter.rows[0]?.count) {
    throw new Error('Backfill unexpectedly changed the Integration outbox.');
  }

  console.log(JSON.stringify({ network, ...report }, null, 2));
} finally {
  await closeCoordinationPool();
}
