import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { normalizePostgresConnectionString } from '../apps/stellar-api/stellar/db/postgres.js';

const MIGRATION_FILE = /^([0-9]{4}_[a-z0-9_]+)\.sql$/;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

const connectionString = (
  process.env.DATABASE_URL_UNPOOLED?.trim()
  || process.env.DATABASE_URL?.trim()
);

if (!connectionString) {
  throw new Error('DATABASE_URL_UNPOOLED or DATABASE_URL is required.');
}

const migrationDirectory = path.resolve(process.cwd(), 'apps/stellar-api/stellar/db/migrations');
const expectedMigrations = (await readdir(migrationDirectory))
  .map((name) => MIGRATION_FILE.exec(name)?.[1])
  .filter((value): value is string => Boolean(value))
  .sort();

const pool = new Pool({
  connectionString: normalizePostgresConnectionString(connectionString),
  max: 1,
});

const client = await pool.connect();

try {
  await client.query('BEGIN READ ONLY');

  const applied = await client.query<{ version: string }>(
    'SELECT version FROM mst_stellar.schema_migrations ORDER BY version',
  );
  const appliedMigrations = applied.rows.map((row) => row.version);

  if (
    appliedMigrations.length !== expectedMigrations.length
    || appliedMigrations.some((version, index) => version !== expectedMigrations[index])
  ) {
    throw new Error(
      `Migration mismatch. expected=${expectedMigrations.join(',')} applied=${appliedMigrations.join(',')}`,
    );
  }

  const relations = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'mst_stellar' ORDER BY tablename",
  );

  if (relations.rowCount === 0) {
    throw new Error('No mst_stellar tables found.');
  }

  const tableCounts: Record<string, string> = {};
  for (const { tablename } of relations.rows) {
    const count = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM mst_stellar.${quoteIdentifier(tablename)}`,
    );
    tableCounts[tablename] = count.rows[0]?.count ?? '0';
  }

  await client.query('ROLLBACK');

  console.log(JSON.stringify({
    ok: true,
    migrations: appliedMigrations,
    tableCount: relations.rowCount,
    tableCounts,
  }, null, 2));
} catch (cause) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw cause;
} finally {
  client.release();
  await pool.end();
}
