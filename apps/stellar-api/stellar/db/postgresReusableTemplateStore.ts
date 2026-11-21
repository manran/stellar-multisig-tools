import type { Pool, PoolClient } from 'pg';
import type {
  ReusableTemplateDefinition,
  ReusableTemplateKind,
} from '../../../../packages/stellar-core/src/reusableTemplate.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';
import { coordinationPool, withPostgresTransaction } from './postgres.js';
import type {
  ReusableTemplateStore,
  StoredReusableTemplate,
  StoredReusableTemplateVersion,
} from '../server/reusableTemplateStore.js';

interface TemplateRow {
  id: string;
  owner_address: string;
  network: StellarNetwork;
  name: string;
  kind: ReusableTemplateKind;
  current_version: number;
  created_at: Date | string;
  updated_at: Date | string;
  archived_at: Date | string | null;
  version: number;
  definition: ReusableTemplateDefinition;
  version_created_at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rowToVersion(row: TemplateRow): StoredReusableTemplateVersion {
  return {
    template: {
      id: row.id,
      ownerAddress: row.owner_address,
      network: row.network,
      name: row.name,
      kind: row.kind,
      currentVersion: row.current_version,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      ...(row.archived_at ? { archivedAt: iso(row.archived_at) } : {}),
    },
    version: row.version,
    definition: row.definition,
    createdAt: iso(row.version_created_at),
  };
}

async function selectVersion(
  db: Pool | PoolClient,
  id: string,
  version: number,
): Promise<StoredReusableTemplateVersion | null> {
  const result = await db.query<TemplateRow>(
    `SELECT t.id, t.owner_address, t.network, t.name, t.kind, t.current_version,
            t.created_at, t.updated_at, t.archived_at,
            v.version, v.definition, v.created_at AS version_created_at
       FROM mst_stellar.reusable_templates t
       JOIN mst_stellar.reusable_template_versions v
         ON v.template_id = t.id
      WHERE t.id = $1 AND v.version = $2`,
    [id, version],
  );
  const row = result.rows[0];
  return row ? rowToVersion(row) : null;
}

export class PostgresReusableTemplateStore implements ReusableTemplateStore {
  constructor(private readonly pool: Pool = coordinationPool()) {}

  async createTemplate(
    template: StoredReusableTemplate,
    version: StoredReusableTemplateVersion,
  ): Promise<void> {
    await withPostgresTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO mst_stellar.reusable_templates (
           id, owner_address, network, name, kind, current_version,
           created_at, updated_at, archived_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          template.id,
          template.ownerAddress,
          template.network,
          template.name,
          template.kind,
          template.currentVersion,
          template.createdAt,
          template.updatedAt,
          template.archivedAt ?? null,
        ],
      );
      await client.query(
        `INSERT INTO mst_stellar.reusable_template_versions (
           template_id, version, definition, created_at
         ) VALUES ($1, $2, $3, $4)`,
        [template.id, version.version, version.definition, version.createdAt],
      );
    });
  }

  async listTemplates(
    ownerAddress: string,
    network: StellarNetwork,
  ): Promise<StoredReusableTemplateVersion[]> {
    const result = await this.pool.query<TemplateRow>(
      `SELECT t.id, t.owner_address, t.network, t.name, t.kind, t.current_version,
              t.created_at, t.updated_at, t.archived_at,
              v.version, v.definition, v.created_at AS version_created_at
         FROM mst_stellar.reusable_templates t
         JOIN mst_stellar.reusable_template_versions v
           ON v.template_id = t.id AND v.version = t.current_version
        WHERE t.owner_address = $1
          AND t.network = $2
          AND t.archived_at IS NULL
        ORDER BY t.updated_at DESC, t.id`,
      [ownerAddress, network],
    );
    return result.rows.map(rowToVersion);
  }

  getTemplateVersion(id: string, version: number): Promise<StoredReusableTemplateVersion | null> {
    return selectVersion(this.pool, id, version);
  }

  async listGrantedTemplates(proposer: string, network: StellarNetwork): Promise<StoredReusableTemplateVersion[]> {
    const result = await this.pool.query<TemplateRow>(
      `SELECT t.id, t.owner_address, t.network, t.name, t.kind, t.current_version,
              t.created_at, t.updated_at, t.archived_at,
              v.version, v.definition, v.created_at AS version_created_at
         FROM mst_stellar.reusable_template_proposer_grants g
         JOIN mst_stellar.reusable_templates t ON t.id = g.template_id
         JOIN mst_stellar.reusable_template_versions v
           ON v.template_id = t.id AND v.version = t.current_version
        WHERE g.proposer_address = $1 AND g.revoked_at IS NULL
          AND t.network = $2 AND t.archived_at IS NULL
        ORDER BY t.updated_at DESC, t.id`,
      [proposer, network],
    );
    return result.rows.map(rowToVersion);
  }

  async listProposers(templateId: string): Promise<string[]> {
    const result = await this.pool.query<{ proposer_address: string }>(
      `SELECT proposer_address FROM mst_stellar.reusable_template_proposer_grants
        WHERE template_id = $1 AND revoked_at IS NULL ORDER BY proposer_address`,
      [templateId],
    );
    return result.rows.map((row) => row.proposer_address);
  }

  async hasActiveGrant(templateId: string, proposer: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM mst_stellar.reusable_template_proposer_grants
        WHERE template_id = $1 AND proposer_address = $2 AND revoked_at IS NULL LIMIT 1`,
      [templateId, proposer],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async grantProposer(templateId: string, proposer: string, by: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO mst_stellar.reusable_template_proposer_grants
         (template_id, proposer_address, granted_by_address)
       VALUES ($1, $2, $3)
       ON CONFLICT (template_id, proposer_address) WHERE revoked_at IS NULL DO NOTHING`,
      [templateId, proposer, by],
    );
  }

  async revokeProposer(templateId: string, proposer: string, by: string): Promise<void> {
    await this.pool.query(
      `UPDATE mst_stellar.reusable_template_proposer_grants
          SET revoked_at = now(), revoked_by_address = $3
        WHERE template_id = $1 AND proposer_address = $2 AND revoked_at IS NULL`,
      [templateId, proposer, by],
    );
  }
}

export function createPostgresReusableTemplateStore(
  pool: Pool = coordinationPool(),
): ReusableTemplateStore {
  return new PostgresReusableTemplateStore(pool);
}
