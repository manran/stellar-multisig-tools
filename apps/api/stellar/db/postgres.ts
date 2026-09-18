import { attachDatabasePool } from '@vercel/functions';
import { Pool, type PoolClient } from 'pg';

export class CoordinationDatabaseUnavailableError extends Error {
  constructor(message = 'PostgreSQL coordination storage is not configured for this deployment.') {
    super(message);
    this.name = 'CoordinationDatabaseUnavailableError';
  }
}

let sharedPool: Pool | null = null;

function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new CoordinationDatabaseUnavailableError();
  return value;
}

export function coordinationPool(): Pool {
  if (sharedPool) return sharedPool;
  sharedPool = new Pool({ connectionString: databaseUrl() });
  attachDatabasePool(sharedPool);
  return sharedPool;
}

export async function withPostgresTransaction<T>(
  pool: Pool,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (cause) {
    await client.query('ROLLBACK');
    throw cause;
  } finally {
    client.release();
  }
}

export function withCoordinationTransaction<T>(
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withPostgresTransaction(coordinationPool(), run);
}

export async function closeCoordinationPool(): Promise<void> {
  const pool = sharedPool;
  sharedPool = null;
  if (pool) await pool.end();
}
