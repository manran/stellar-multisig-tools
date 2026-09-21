import type { Pool, PoolClient } from 'pg';
import type { StellarNetwork } from '../../../../src/stellar/types.js';
import type { ClassicManagedChannelCreatorState } from '../server/classicManagedChannelCapacity.js';
import type {
  ClassicManagedChannelCreatorMonitorStore,
  StoredClassicManagedChannelCreatorMonitor,
} from '../server/classicManagedChannelCreatorMonitorStore.js';
import { coordinationPool, withPostgresTransaction } from './postgres.js';

interface MonitorRow {
  network: StellarNetwork;
  state: ClassicManagedChannelCreatorState;
  native_balance_stroops: string | number;
  observed_at: Date | string;
  alerted_at: Date | string | null;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rowToRecord(row: MonitorRow): StoredClassicManagedChannelCreatorMonitor {
  return {
    network: row.network,
    state: row.state,
    nativeBalanceStroops: BigInt(row.native_balance_stroops),
    observedAt: iso(row.observed_at),
    ...(row.alerted_at ? { alertedAt: iso(row.alerted_at) } : {}),
  };
}

async function selectForUpdate(
  client: PoolClient,
  network: StellarNetwork,
): Promise<MonitorRow | null> {
  const result = await client.query<MonitorRow>(
    `SELECT network, state, native_balance_stroops, observed_at, alerted_at
       FROM mst_stellar.classic_managed_channel_creator_monitor
      WHERE network = $1
      FOR UPDATE`,
    [network],
  );
  return result.rows[0] ?? null;
}

export class PostgresClassicManagedChannelCreatorMonitorStore
implements ClassicManagedChannelCreatorMonitorStore {
  constructor(private readonly pool: Pool = coordinationPool()) {}

  async get(network: StellarNetwork): Promise<StoredClassicManagedChannelCreatorMonitor | null> {
    const result = await this.pool.query<MonitorRow>(
      `SELECT network, state, native_balance_stroops, observed_at, alerted_at
         FROM mst_stellar.classic_managed_channel_creator_monitor
        WHERE network = $1`,
      [network],
    );
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }

  async observe(
    record: StoredClassicManagedChannelCreatorMonitor,
  ): Promise<{ previousState: ClassicManagedChannelCreatorState | null; changed: boolean }> {
    return withPostgresTransaction(this.pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO mst_stellar.classic_managed_channel_creator_monitor (
           network, state, native_balance_stroops, observed_at, alerted_at
         ) VALUES ($1, $2, $3, $4, NULL)
         ON CONFLICT (network) DO NOTHING
         RETURNING state`,
        [record.network, record.state, record.nativeBalanceStroops.toString(), record.observedAt],
      );
      if (inserted.rowCount === 1) {
        return { previousState: null, changed: true };
      }

      const previous = await selectForUpdate(client, record.network);
      if (!previous) throw new Error('Managed Classic creator monitor row disappeared during transition.');
      await client.query(
        `UPDATE mst_stellar.classic_managed_channel_creator_monitor
            SET state = $2,
                native_balance_stroops = $3,
                observed_at = $4,
                alerted_at = CASE WHEN state = $2 THEN alerted_at ELSE NULL END
          WHERE network = $1`,
        [record.network, record.state, record.nativeBalanceStroops.toString(), record.observedAt],
      );
      return { previousState: previous.state, changed: previous.state !== record.state };
    });
  }

  async markAlerted(
    network: StellarNetwork,
    state: ClassicManagedChannelCreatorState,
    alertedAt: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE mst_stellar.classic_managed_channel_creator_monitor
          SET alerted_at = $3
        WHERE network = $1 AND state = $2`,
      [network, state, alertedAt],
    );
  }
}

export function createPostgresClassicManagedChannelCreatorMonitorStore(
  pool: Pool = coordinationPool(),
): ClassicManagedChannelCreatorMonitorStore {
  return new PostgresClassicManagedChannelCreatorMonitorStore(pool);
}
