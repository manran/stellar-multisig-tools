import { closeCoordinationPool } from '../apps/stellar-api/stellar/db/postgres.js';
import { runRuntimeCoordinationBackfill } from '../apps/stellar-api/stellar/db/postgresBackfillRuntime.js';
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

const network = requestedNetwork();

try {
  const report = await runRuntimeCoordinationBackfill(network);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await closeCoordinationPool();
}
