import type { Pool } from 'pg';
import type { StellarNetwork } from '../../../../src/stellar/types.js';
import type {
  ClassicManagedChannelLeaseStore,
  StoredClassicManagedChannelLease,
} from '../server/classicManagedChannelStore.js';
import { coordinationPool } from './postgres.js';

interface LeaseRow {
  network: StellarNetwork;
  channel_account: string;
  request_id: string;
  leased_at: Date | string;
  expires_at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rowToLease(row: LeaseRow): StoredClassicManagedChannelLease {
  return {
    network: row.network,
    channelAccount: row.channel_account,
    requestId: row.request_id,
    leasedAt: iso(row.leased_at),
    expiresAt: iso(row.expires_at),
  };
}

export class PostgresClassicManagedChannelStore implements ClassicManagedChannelLeaseStore {
  constructor(private readonly pool: Pool = coordinationPool()) {}

  async getLeaseForRequest(requestId: string): Promise<StoredClassicManagedChannelLease | null> {
    const result = await this.pool.query<LeaseRow>(
      `SELECT network, channel_account, request_id, leased_at, expires_at
         FROM mst_stellar.classic_managed_channel_leases
        WHERE request_id = $1`,
      [requestId],
    );
    const row = result.rows[0];
    return row ? rowToLease(row) : null;
  }

  async claimLease(record: StoredClassicManagedChannelLease): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO mst_stellar.classic_managed_channel_leases (
         network, channel_account, request_id, leased_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (network, channel_account)
       DO UPDATE SET
         request_id = EXCLUDED.request_id,
         leased_at = EXCLUDED.leased_at,
         expires_at = EXCLUDED.expires_at
       WHERE mst_stellar.classic_managed_channel_leases.request_id = EXCLUDED.request_id
          OR mst_stellar.classic_managed_channel_leases.expires_at <= EXCLUDED.leased_at
       RETURNING request_id`,
      [
        record.network,
        record.channelAccount,
        record.requestId,
        record.leasedAt,
        record.expiresAt,
      ],
    );
    return result.rowCount === 1;
  }

  async releaseRequest(requestId: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM mst_stellar.classic_managed_channel_leases WHERE request_id = $1',
      [requestId],
    );
  }

  async listLeases(network: StellarNetwork): Promise<StoredClassicManagedChannelLease[]> {
    const result = await this.pool.query<LeaseRow>(
      `SELECT network, channel_account, request_id, leased_at, expires_at
         FROM mst_stellar.classic_managed_channel_leases
        WHERE network = $1
        ORDER BY channel_account`,
      [network],
    );
    return result.rows.map(rowToLease);
  }
}

export function createPostgresClassicManagedChannelStore(
  pool: Pool = coordinationPool(),
): ClassicManagedChannelLeaseStore {
  return new PostgresClassicManagedChannelStore(pool);
}
