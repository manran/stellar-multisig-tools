import type { Pool } from 'pg';
import type {
  SorobanBrowserAuthorizationStore,
  StoredSorobanBrowserAuthorizationCapability,
} from '../server/sorobanBrowserAuthorizationStore.js';
import { coordinationPool } from './postgres.js';

interface CapabilityRow {
  capability_id: string;
  intent_id: string;
  integration_service_id: string;
  signer_address: string;
  authorization_plan_revision: number;
  authorization_plan_digest: string;
  origin: string;
  secret_hash: string;
  created_at: Date | string;
  expires_at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rowToCapability(row: CapabilityRow): StoredSorobanBrowserAuthorizationCapability {
  return {
    version: 1,
    capabilityId: row.capability_id,
    intentId: row.intent_id,
    integrationServiceId: row.integration_service_id,
    signerAddress: row.signer_address,
    authorizationPlanRevision: row.authorization_plan_revision,
    authorizationPlanDigest: row.authorization_plan_digest,
    origin: row.origin,
    secretHash: row.secret_hash,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
  };
}

export class PostgresSorobanBrowserAuthorizationStore implements SorobanBrowserAuthorizationStore {
  constructor(private readonly pool: Pool = coordinationPool()) {}

  async getCapability(capabilityId: string): Promise<StoredSorobanBrowserAuthorizationCapability | null> {
    const result = await this.pool.query<CapabilityRow>(
      `SELECT capability_id, intent_id, integration_service_id, signer_address,
              authorization_plan_revision, authorization_plan_digest, origin,
              secret_hash, created_at, expires_at
         FROM mst_stellar.soroban_browser_authorization_capabilities
        WHERE capability_id = $1`,
      [capabilityId],
    );
    const row = result.rows[0];
    return row ? rowToCapability(row) : null;
  }

  async putCapability(record: StoredSorobanBrowserAuthorizationCapability): Promise<void> {
    await this.pool.query(
      `INSERT INTO mst_stellar.soroban_browser_authorization_capabilities (
         capability_id, intent_id, integration_service_id, signer_address,
         authorization_plan_revision, authorization_plan_digest, origin,
         secret_hash, created_at, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        record.capabilityId,
        record.intentId,
        record.integrationServiceId,
        record.signerAddress,
        record.authorizationPlanRevision,
        record.authorizationPlanDigest,
        record.origin,
        record.secretHash,
        record.createdAt,
        record.expiresAt,
      ],
    );
  }
}

export function createPostgresSorobanBrowserAuthorizationStore(
  pool: Pool = coordinationPool(),
): SorobanBrowserAuthorizationStore {
  return new PostgresSorobanBrowserAuthorizationStore(pool);
}
