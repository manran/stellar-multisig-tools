import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { coordinationPool } from './postgres.js';

const MIGRATION_FILE = /^([0-9]{4}_[a-z0-9_]+)\.sql$/;
const ADVISORY_LOCK = 'mst_stellar:migrations';

async function appliedVersions(client: PoolClient): Promise<Set<string>> {
  const relation = await client.query<{ name: string | null }>(
    "SELECT to_regclass('mst_stellar.schema_migrations')::text AS name",
  );
  if (!relation.rows[0]?.name) return new Set();
  const result = await client.query<{ version: string }>(
    'SELECT version FROM mst_stellar.schema_migrations ORDER BY version',
  );
  return new Set(result.rows.map((row) => row.version));
}

export async function applyCoordinationMigrations(
  directory = path.resolve(process.cwd(), 'apps/api/stellar/db/migrations'),
): Promise<string[]> {
  const entries = (await readdir(directory))
    .map((name) => ({ name, match: MIGRATION_FILE.exec(name) }))
    .filter((entry): entry is { name: string; match: RegExpExecArray } => Boolean(entry.match))
    .sort((left, right) => left.name.localeCompare(right.name));

  const client = await coordinationPool().connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [ADVISORY_LOCK]);
    const known = await appliedVersions(client);
    for (const entry of entries) {
      const version = entry.match[1];
      if (known.has(version)) continue;
      const sql = await readFile(path.join(directory, entry.name), 'utf8');
      await client.query(sql);
      const recorded = await client.query<{ version: string }>(
        'SELECT version FROM mst_stellar.schema_migrations WHERE version = $1',
        [version],
      );
      if (recorded.rowCount !== 1) {
        throw new Error(`Migration ${version} did not record itself in mst_stellar.schema_migrations.`);
      }
      known.add(version);
      applied.push(version);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [ADVISORY_LOCK]).catch(() => undefined);
    client.release();
  }
}
