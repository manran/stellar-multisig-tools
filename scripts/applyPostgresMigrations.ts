import { applyCoordinationMigrations } from '../apps/api/stellar/db/migrate.js';
import { closeCoordinationPool } from '../apps/api/stellar/db/postgres.js';

try {
  const applied = await applyCoordinationMigrations();
  console.log(applied.length > 0 ? `Applied: ${applied.join(', ')}` : 'No pending migrations.');
} finally {
  await closeCoordinationPool();
}
