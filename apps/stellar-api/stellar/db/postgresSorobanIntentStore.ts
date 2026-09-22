import type { Pool, PoolClient } from 'pg';
import type { MachineCallerProvenance } from '../../../../packages/stellar-core/src/coordinationActorTypes.js';
import type { SorobanExecutionPolicy } from '../../../../packages/stellar-core/src/executionPolicy.js';
import type { SorobanIntentIntegrationContext } from '../../../../packages/stellar-core/src/integrationTypes.js';
import type { SorobanAuthorizationPlan } from '../../../../packages/stellar-core/src/sorobanAuthorizationPlan.js';
import type { SorobanIntent } from '../../../../packages/stellar-core/src/sorobanIntent.js';
import { blobSorobanIntentPrivateDataStore } from '../server/blobSorobanIntentPrivateDataStore.js';
import type { SorobanIntentPrivateDataStore } from '../server/sorobanIntentPrivateDataStore.js';
import {
  SorobanIntentStoreConflictError,
  type SorobanIntentStore,
  type StoredSorobanAuthorizationPlanRevision,
  type StoredSorobanIntent,
  type StoredSorobanIntentAuthorizationContribution,
  type StoredSorobanIntentCancellation,
  type StoredSorobanIntentExecutionObservation,
  type StoredSorobanIntentExecutionPreparation,
} from '../server/sorobanIntentStore.js';
import { coordinationPool, withPostgresTransaction } from './postgres.js';
import { enqueueCoordinationChange } from './postgresIntegrationOutbox.js';

interface IntentRow {
  id: string;
  network: 'public' | 'testnet';
  intent: SorobanIntent;
  authorization_plan: SorobanAuthorizationPlan;
  authorization_plan_revision: number;
  authorization_plan_history: StoredSorobanAuthorizationPlanRevision[];
  created_at: Date | string;
  creator_address: string | null;
  creator_actor: MachineCallerProvenance | null;
  integration_context: SorobanIntentIntegrationContext | null;
  external_reference: string | null;
  execution_policy: SorobanExecutionPolicy | null;
  has_private_note: boolean;
  bound_execution_policy: SorobanExecutionPolicy | null;
  cancelled_at: Date | string | null;
  cancellation_plan_digest: string | null;
  cancellation_plan_revision: number | null;
  cancelled_by_address: string | null;
  cancelled_by: MachineCallerProvenance | null;
}

interface ParentLockRow {
  integration_service_id: string | null;
  authorization_plan: SorobanAuthorizationPlan;
  authorization_plan_revision: number;
  authorization_plan_history: StoredSorobanAuthorizationPlanRevision[];
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function currentRevision(value: StoredSorobanIntent): number {
  return value.authorizationPlanRevision ?? 1;
}

function planDigestForRevision(row: ParentLockRow, revision: number): string | null {
  if (row.authorization_plan_revision === revision) {
    return row.authorization_plan.authorizationPlanDigest;
  }
  return row.authorization_plan_history
    .find((item) => item.revision === revision)
    ?.authorizationPlan.authorizationPlanDigest ?? null;
}

async function privateData(
  store: SorobanIntentPrivateDataStore,
  id: string,
  value: StoredSorobanIntent,
): Promise<void> {
  const note = value.privateContext?.initialPrivateNote;
  if (!note) return;
  await store.putIntentPrivateData(id, { version: 1, initialPrivateNote: note });
}

async function signerAddresses(db: Pool | PoolClient, id: string): Promise<string[]> {
  const result = await db.query<{ signer_address: string }>(
    `SELECT signer_address
       FROM mst_stellar.soroban_intent_signers
      WHERE intent_id = $1
      ORDER BY signer_address`,
    [id],
  );
  return result.rows.map((row) => row.signer_address);
}

async function readIntent(
  db: Pool | PoolClient,
  privateStore: SorobanIntentPrivateDataStore,
  id: string,
): Promise<StoredSorobanIntent | null> {
  const result = await db.query<IntentRow>(
    `SELECT
       i.id,
       i.network,
       i.intent,
       i.authorization_plan,
       i.authorization_plan_revision,
       i.authorization_plan_history,
       i.created_at,
       i.creator_address,
       i.creator_actor,
       i.integration_context,
       i.external_reference,
       i.execution_policy,
       i.has_private_note,
       b.execution_policy AS bound_execution_policy,
       c.cancelled_at,
       c.authorization_plan_digest AS cancellation_plan_digest,
       c.authorization_plan_revision AS cancellation_plan_revision,
       c.cancelled_by_address,
       c.cancelled_by
     FROM mst_stellar.soroban_intents i
     LEFT JOIN mst_stellar.soroban_execution_bindings b ON b.intent_id = i.id
     LEFT JOIN mst_stellar.soroban_intent_cancellations c ON c.intent_id = i.id
     WHERE i.id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  const [signers, secret] = await Promise.all([
    signerAddresses(db, id),
    row.has_private_note ? privateStore.getIntentPrivateData(id) : Promise.resolve(null),
  ]);
  const privateContext = row.external_reference || secret?.initialPrivateNote
    ? {
        ...(row.external_reference ? { externalReference: row.external_reference } : {}),
        ...(secret?.initialPrivateNote ? { initialPrivateNote: secret.initialPrivateNote } : {}),
      }
    : undefined;
  const cancellation: StoredSorobanIntentCancellation | undefined = row.cancelled_at
    && row.cancellation_plan_digest
    && row.cancellation_plan_revision
    ? {
        version: 1,
        cancelledAt: iso(row.cancelled_at),
        authorizationPlanDigest: row.cancellation_plan_digest,
        authorizationPlanRevision: row.cancellation_plan_revision,
        ...(row.cancelled_by_address ? { cancelledByAddress: row.cancelled_by_address } : {}),
        ...(row.cancelled_by ? { cancelledBy: row.cancelled_by } : {}),
      }
    : undefined;
  return {
    version: 1,
    id: row.id,
    network: row.network,
    intent: row.intent,
    authorizationPlan: row.authorization_plan,
    authorizationPlanRevision: row.authorization_plan_revision,
    ...(row.authorization_plan_history.length > 0
      ? { authorizationPlanHistory: row.authorization_plan_history }
      : {}),
    createdAt: iso(row.created_at),
    ...(row.creator_address ? { creatorAddress: row.creator_address } : {}),
    ...(row.creator_actor ? { creatorActor: row.creator_actor } : {}),
    discoverySignerKeys: signers,
    ...(row.integration_context ? { integration: row.integration_context } : {}),
    ...((row.bound_execution_policy ?? row.execution_policy)
      ? { executionPolicy: row.bound_execution_policy ?? row.execution_policy ?? undefined }
      : {}),
    ...(privateContext ? { privateContext } : {}),
    ...(cancellation ? { cancellation } : {}),
  };
}

async function lockParent(client: PoolClient, id: string): Promise<ParentLockRow | null> {
  const result = await client.query<ParentLockRow>(
    `SELECT integration_service_id, authorization_plan, authorization_plan_revision, authorization_plan_history
       FROM mst_stellar.soroban_intents
      WHERE id = $1
      FOR UPDATE`,
    [id],
  );
  return result.rows[0] ?? null;
}

async function cancelled(client: PoolClient, id: string): Promise<boolean> {
  const result = await client.query(
    'SELECT 1 FROM mst_stellar.soroban_intent_cancellations WHERE intent_id = $1',
    [id],
  );
  return result.rowCount === 1;
}

async function syncSigners(
  client: PoolClient,
  value: Pick<StoredSorobanIntent, 'id' | 'network' | 'discoverySignerKeys'>,
): Promise<void> {
  await client.query('DELETE FROM mst_stellar.soroban_intent_signers WHERE intent_id = $1', [value.id]);
  if (value.discoverySignerKeys.length === 0) return;
  await client.query(
    `INSERT INTO mst_stellar.soroban_intent_signers (intent_id, network, signer_address)
     SELECT $1, $2, signer
       FROM unnest($3::text[]) AS signer
     ON CONFLICT DO NOTHING`,
    [value.id, value.network, value.discoverySignerKeys],
  );
}

export class PostgresSorobanIntentStore implements SorobanIntentStore {
  constructor(
    private readonly pool: Pool = coordinationPool(),
    private readonly privateStore: SorobanIntentPrivateDataStore = blobSorobanIntentPrivateDataStore,
    private readonly emitOutbox = true,
  ) {}

  async createIntent(value: StoredSorobanIntent): Promise<void> {
    await privateData(this.privateStore, value.id, value);
    await withPostgresTransaction(this.pool, async (client) => {
      const policy = value.executionPolicy ?? null;
      await client.query(
        `INSERT INTO mst_stellar.soroban_intents (
           id, network, intent_digest, intent, authorization_plan,
           authorization_plan_revision, authorization_plan_history,
           created_at, creator_address, creator_actor,
           integration_service_id, integration_context, external_reference, execution_policy,
           has_private_note
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10, $11, $12, $13, $14, $15
         )`,
        [
          value.id,
          value.network,
          value.intent.intentDigest,
          value.intent,
          value.authorizationPlan,
          currentRevision(value),
          JSON.stringify(value.authorizationPlanHistory ?? []),
          value.createdAt,
          value.creatorAddress ?? null,
          value.creatorActor ?? null,
          value.integration?.serviceId ?? null,
          value.integration ?? null,
          value.privateContext?.externalReference ?? null,
          policy,
          Boolean(value.privateContext?.initialPrivateNote),
        ],
      );
      await syncSigners(client, value);
      if (value.executionPolicy?.executor) {
        await client.query(
          `INSERT INTO mst_stellar.soroban_execution_bindings (intent_id, execution_policy)
           VALUES ($1, $2)`,
          [value.id, value.executionPolicy],
        );
      }
      if (this.emitOutbox && value.integration) {
        await enqueueCoordinationChange(client, {
          serviceId: value.integration.serviceId,
          resourceKind: 'soroban_intent',
          resourceId: value.id,
          changeKey: 'created',
          change: 'created',
          occurredAt: value.createdAt,
        });
      }
    });
  }

  getIntent(id: string): Promise<StoredSorobanIntent | null> {
    return readIntent(this.pool, this.privateStore, id);
  }

  async updateIntent(value: StoredSorobanIntent): Promise<void> {
    await withPostgresTransaction(this.pool, async (client) => {
      const row = await lockParent(client, value.id);
      if (!row) return;
      if (await cancelled(client, value.id)) return;

      const nextRevision = currentRevision(value);
      if (nextRevision > row.authorization_plan_revision) {
        const previous = value.authorizationPlanHistory
          ?.find((item) => item.revision === nextRevision - 1);
        if (
          nextRevision !== row.authorization_plan_revision + 1
          || !previous
          || previous.authorizationPlan.authorizationPlanDigest
            !== row.authorization_plan.authorizationPlanDigest
        ) {
          throw new SorobanIntentStoreConflictError('authorization_plan_changed');
        }
      } else if (nextRevision < row.authorization_plan_revision) {
        throw new SorobanIntentStoreConflictError('authorization_plan_changed');
      }

      await client.query(
        `UPDATE mst_stellar.soroban_intents
            SET intent_digest = $2,
                intent = $3,
                authorization_plan = $4,
                authorization_plan_revision = $5,
                authorization_plan_history = $6,
                creator_address = $7,
                creator_actor = $8,
                integration_service_id = $9,
                integration_context = $10,
                external_reference = $11,
                execution_policy = $12
          WHERE id = $1`,
        [
          value.id,
          value.intent.intentDigest,
          value.intent,
          value.authorizationPlan,
          nextRevision,
          JSON.stringify(value.authorizationPlanHistory ?? []),
          value.creatorAddress ?? null,
          value.creatorActor ?? null,
          value.integration?.serviceId ?? null,
          value.integration ?? null,
          value.privateContext?.externalReference ?? null,
          value.executionPolicy ?? null,
        ],
      );
      await syncSigners(client, value);
      if (this.emitOutbox && value.integration && nextRevision > row.authorization_plan_revision) {
        await enqueueCoordinationChange(client, {
          serviceId: value.integration.serviceId,
          resourceKind: 'soroban_intent',
          resourceId: value.id,
          changeKey: `plan:${nextRevision}:${value.authorizationPlan.authorizationPlanDigest}`,
          change: 'authorization_plan_revised',
          occurredAt: value.authorizationPlanHistory?.at(-1)?.supersededAt ?? new Date().toISOString(),
        });
      }
    });
  }

  async cancelIntent(
    id: string,
    value: StoredSorobanIntentCancellation,
  ): Promise<{ cancellation: StoredSorobanIntentCancellation; created: boolean }> {
    return withPostgresTransaction(this.pool, async (client) => {
      const parent = await lockParent(client, id);
      if (!parent) throw new Error('Soroban Intent not found while cancelling.');

      const existing = await client.query<{
        cancelled_at: Date | string;
        authorization_plan_digest: string;
        authorization_plan_revision: number;
        cancelled_by_address: string | null;
        cancelled_by: MachineCallerProvenance | null;
      }>(
        `SELECT cancelled_at, authorization_plan_digest, authorization_plan_revision,
                cancelled_by_address, cancelled_by
           FROM mst_stellar.soroban_intent_cancellations
          WHERE intent_id = $1`,
        [id],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        return {
          created: false,
          cancellation: {
            version: 1,
            cancelledAt: iso(row.cancelled_at),
            authorizationPlanDigest: row.authorization_plan_digest,
            authorizationPlanRevision: row.authorization_plan_revision,
            ...(row.cancelled_by_address ? { cancelledByAddress: row.cancelled_by_address } : {}),
            ...(row.cancelled_by ? { cancelledBy: row.cancelled_by } : {}),
          },
        };
      }

      const successful = await client.query(
        `SELECT 1
           FROM mst_stellar.soroban_execution_observations
          WHERE intent_id = $1 AND successful = true
          LIMIT 1`,
        [id],
      );
      if (successful.rowCount) {
        throw new SorobanIntentStoreConflictError('intent_already_executed');
      }

      await client.query(
        `INSERT INTO mst_stellar.soroban_intent_cancellations (
           intent_id, cancelled_at, authorization_plan_digest, authorization_plan_revision,
           cancelled_by_address, cancelled_by
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          value.cancelledAt,
          value.authorizationPlanDigest,
          value.authorizationPlanRevision,
          value.cancelledByAddress ?? null,
          value.cancelledBy ?? null,
        ],
      );
      if (this.emitOutbox && parent.integration_service_id) {
        await enqueueCoordinationChange(client, {
          serviceId: parent.integration_service_id,
          resourceKind: 'soroban_intent',
          resourceId: id,
          changeKey: 'cancelled',
          change: 'cancelled',
          occurredAt: value.cancelledAt,
        });
      }
      return { cancellation: value, created: true };
    });
  }

  async bindExecutionPolicy(id: string, executionPolicy: SorobanExecutionPolicy): Promise<SorobanExecutionPolicy> {
    return withPostgresTransaction(this.pool, async (client) => {
      const parent = await lockParent(client, id);
      if (!parent) throw new Error('Soroban Intent not found while binding executor.');
      const existing = await client.query<{ execution_policy: SorobanExecutionPolicy }>(
        'SELECT execution_policy FROM mst_stellar.soroban_execution_bindings WHERE intent_id = $1',
        [id],
      );
      if (existing.rows[0]) return existing.rows[0].execution_policy;
      if (await cancelled(client, id)) return executionPolicy;

      await client.query(
        `INSERT INTO mst_stellar.soroban_execution_bindings (intent_id, execution_policy)
         VALUES ($1, $2)`,
        [id, executionPolicy],
      );
      await client.query(
        'UPDATE mst_stellar.soroban_intents SET execution_policy = $2 WHERE id = $1',
        [id, executionPolicy],
      );
      if (this.emitOutbox && parent.integration_service_id) {
        await enqueueCoordinationChange(client, {
          serviceId: parent.integration_service_id,
          resourceKind: 'soroban_intent',
          resourceId: id,
          changeKey: 'executor-bound',
          change: 'executor_bound',
          occurredAt: new Date().toISOString(),
        });
      }
      return executionPolicy;
    });
  }

  async listIntentsBySigner(network: 'public' | 'testnet', signerAddress: string): Promise<StoredSorobanIntent[]> {
    const ids = await this.pool.query<{ intent_id: string }>(
      `SELECT intent_id
         FROM mst_stellar.soroban_intent_signers
        WHERE network = $1 AND signer_address = $2
        ORDER BY intent_id`,
      [network, signerAddress],
    );
    const values = await Promise.all(ids.rows.map((row) => this.getIntent(row.intent_id)));
    return values.filter((value): value is StoredSorobanIntent => Boolean(value));
  }

  async listContributions(id: string): Promise<StoredSorobanIntentAuthorizationContribution[]> {
    const result = await this.pool.query<{ record: StoredSorobanIntentAuthorizationContribution }>(
      `SELECT record
         FROM mst_stellar.soroban_auth_contributions
        WHERE intent_id = $1
        ORDER BY received_at, digest`,
      [id],
    );
    return result.rows.map((row) => row.record);
  }

  async putContribution(id: string, contribution: StoredSorobanIntentAuthorizationContribution): Promise<void> {
    await withPostgresTransaction(this.pool, async (client) => {
      const parent = await lockParent(client, id);
      if (!parent || await cancelled(client, id)) return;
      const revision = contribution.authorizationPlanRevision ?? 1;
      const digest = contribution.authorizationPlanDigest ?? planDigestForRevision(parent, revision);
      if (!digest) throw new Error(`AuthorizationPlan revision ${revision} is unavailable for this contribution.`);

      const inserted = await client.query(
        `INSERT INTO mst_stellar.soroban_auth_contributions (
           intent_id, authorization_plan_revision, authorization_plan_digest,
           digest, entry_index, signer_address, received_at, record
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (intent_id, authorization_plan_revision, digest) DO NOTHING`,
        [
          id,
          revision,
          digest,
          contribution.digest,
          contribution.entryIndex,
          contribution.signerAddress,
          contribution.receivedAt,
          contribution,
        ],
      );
      if (this.emitOutbox && inserted.rowCount && parent.integration_service_id) {
        await enqueueCoordinationChange(client, {
          serviceId: parent.integration_service_id,
          resourceKind: 'soroban_intent',
          resourceId: id,
          changeKey: `auth:${revision}:${contribution.digest}`,
          change: 'authorization_contributed',
          occurredAt: contribution.receivedAt,
        });
      }
    });
  }

  async listExecutionPreparations(id: string): Promise<StoredSorobanIntentExecutionPreparation[]> {
    const result = await this.pool.query<{
      transaction_hash: string;
      authorization_plan_digest: string;
      authorization_plan_revision: number;
      execution_source: string;
      transaction_sequence: string;
      valid_until: Date | string | null;
      latest_ledger: string;
      effects_digest: string;
      effects_accepted: boolean;
      prepared_at: Date | string;
      prepared_by_address: string | null;
      prepared_by: MachineCallerProvenance | null;
    }>(
      `SELECT transaction_hash, authorization_plan_digest, authorization_plan_revision,
              execution_source, transaction_sequence, valid_until, latest_ledger,
              effects_digest, effects_accepted, prepared_at, prepared_by_address, prepared_by
         FROM mst_stellar.soroban_execution_preparations
        WHERE intent_id = $1
        ORDER BY prepared_at, transaction_hash`,
      [id],
    );
    return result.rows.map((row) => ({
      version: 1,
      transactionHash: row.transaction_hash,
      authorizationPlanDigest: row.authorization_plan_digest,
      authorizationPlanRevision: row.authorization_plan_revision,
      executionSource: row.execution_source,
      transactionSequence: row.transaction_sequence,
      validUntil: row.valid_until ? iso(row.valid_until) : null,
      latestLedger: Number(row.latest_ledger),
      effectsDigest: row.effects_digest,
      effectsAccepted: row.effects_accepted,
      preparedAt: iso(row.prepared_at),
      ...(row.prepared_by_address ? { preparedByAddress: row.prepared_by_address } : {}),
      ...(row.prepared_by ? { preparedBy: row.prepared_by } : {}),
    }));
  }

  async putExecutionPreparation(id: string, value: StoredSorobanIntentExecutionPreparation): Promise<void> {
    await withPostgresTransaction(this.pool, async (client) => {
      const parent = await lockParent(client, id);
      if (!parent || await cancelled(client, id)) return;
      const inserted = await client.query(
        `INSERT INTO mst_stellar.soroban_execution_preparations (
           intent_id, authorization_plan_revision, authorization_plan_digest,
           transaction_hash, execution_source, transaction_sequence, valid_until,
           latest_ledger, effects_digest, effects_accepted, prepared_at,
           prepared_by_address, prepared_by
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10, $11, $12, $13
         )
         ON CONFLICT (intent_id, prepared_at, transaction_hash) DO NOTHING`,
        [
          id,
          value.authorizationPlanRevision,
          value.authorizationPlanDigest,
          value.transactionHash,
          value.executionSource,
          value.transactionSequence,
          value.validUntil,
          value.latestLedger,
          value.effectsDigest,
          value.effectsAccepted,
          value.preparedAt,
          value.preparedByAddress ?? null,
          value.preparedBy ?? null,
        ],
      );
      if (this.emitOutbox && inserted.rowCount && parent.integration_service_id) {
        await enqueueCoordinationChange(client, {
          serviceId: parent.integration_service_id,
          resourceKind: 'soroban_intent',
          resourceId: id,
          changeKey: `prepared:${value.authorizationPlanRevision}:${value.transactionHash}`,
          change: 'execution_prepared',
          occurredAt: value.preparedAt,
        });
      }
    });
  }

  async listExecutionObservations(id: string): Promise<StoredSorobanIntentExecutionObservation[]> {
    const result = await this.pool.query<{
      transaction_hash: string;
      authorization_plan_digest: string;
      authorization_plan_revision: number;
      execution_source: string;
      ledger: string;
      successful: boolean;
      observed_at: Date | string;
      network_created_at: Date | string | null;
    }>(
      `SELECT transaction_hash, authorization_plan_digest, authorization_plan_revision,
              execution_source, ledger, successful, observed_at, network_created_at
         FROM mst_stellar.soroban_execution_observations
        WHERE intent_id = $1
        ORDER BY observed_at, transaction_hash`,
      [id],
    );
    return result.rows.map((row) => ({
      version: 1,
      transactionHash: row.transaction_hash,
      authorizationPlanDigest: row.authorization_plan_digest,
      authorizationPlanRevision: row.authorization_plan_revision,
      executionSource: row.execution_source,
      ledger: Number(row.ledger),
      successful: row.successful,
      observedAt: iso(row.observed_at),
      ...(row.network_created_at ? { networkCreatedAt: iso(row.network_created_at) } : {}),
    }));
  }

  async getExecutionObservation(id: string, transactionHash: string): Promise<StoredSorobanIntentExecutionObservation | null> {
    const values = await this.pool.query<{
      authorization_plan_digest: string;
      authorization_plan_revision: number;
      execution_source: string;
      ledger: string;
      successful: boolean;
      observed_at: Date | string;
      network_created_at: Date | string | null;
    }>(
      `SELECT authorization_plan_digest, authorization_plan_revision, execution_source,
              ledger, successful, observed_at, network_created_at
         FROM mst_stellar.soroban_execution_observations
        WHERE intent_id = $1 AND transaction_hash = $2`,
      [id, transactionHash],
    );
    const row = values.rows[0];
    if (!row) return null;
    return {
      version: 1,
      transactionHash,
      authorizationPlanDigest: row.authorization_plan_digest,
      authorizationPlanRevision: row.authorization_plan_revision,
      executionSource: row.execution_source,
      ledger: Number(row.ledger),
      successful: row.successful,
      observedAt: iso(row.observed_at),
      ...(row.network_created_at ? { networkCreatedAt: iso(row.network_created_at) } : {}),
    };
  }

  async putExecutionObservation(id: string, value: StoredSorobanIntentExecutionObservation): Promise<void> {
    await withPostgresTransaction(this.pool, async (client) => {
      const parent = await lockParent(client, id);
      if (!parent) return;
      const inserted = await client.query(
        `INSERT INTO mst_stellar.soroban_execution_observations (
           intent_id, transaction_hash, authorization_plan_revision,
           authorization_plan_digest, execution_source, ledger, successful,
           observed_at, network_created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (intent_id, transaction_hash) DO NOTHING`,
        [
          id,
          value.transactionHash,
          value.authorizationPlanRevision,
          value.authorizationPlanDigest,
          value.executionSource,
          value.ledger,
          value.successful,
          value.observedAt,
          value.networkCreatedAt ?? null,
        ],
      );
      if (this.emitOutbox && inserted.rowCount && parent.integration_service_id) {
        await enqueueCoordinationChange(client, {
          serviceId: parent.integration_service_id,
          resourceKind: 'soroban_intent',
          resourceId: id,
          changeKey: `observed:${value.transactionHash}`,
          change: value.successful ? 'execution_confirmed' : 'execution_failed',
          occurredAt: value.observedAt,
        });
      }
    });
  }
}

export function createPostgresSorobanIntentStore(
  pool: Pool = coordinationPool(),
  privateStore: SorobanIntentPrivateDataStore = blobSorobanIntentPrivateDataStore,
  options: { emitOutbox?: boolean } = {},
): SorobanIntentStore {
  return new PostgresSorobanIntentStore(pool, privateStore, options.emitOutbox ?? true);
}
