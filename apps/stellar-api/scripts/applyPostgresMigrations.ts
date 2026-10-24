import { applyCoordinationMigrations } from '../stellar/db/migrate.js';
import { closeCoordinationPool } from '../stellar/db/postgres.js';

const unpooledUrl = process.env.DATABASE_URL_UNPOOLED?.trim();
if (unpooledUrl) process.env.DATABASE_URL = unpooledUrl;

try {
  const applied = await applyCoordinationMigrations();
  console.log(applied.length > 0 ? `Applied: ${applied.join(', ')}` : 'No pending migrations.');
} finally {
  await closeCoordinationPool();
}
