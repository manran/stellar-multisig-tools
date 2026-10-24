import { isValidStellarAccountId } from '../../../../packages/stellar-core/src/horizon.js';
import type { ActivityEvent, ActivityFactEvent } from '../../../../packages/stellar-core/src/activityTypes.js';
import type { MachineCallerProvenance } from '../../../../packages/stellar-core/src/coordinationActorTypes.js';
import type { ExecutionPolicy } from '../../../../packages/stellar-core/src/executionPolicy.js';
import type { RequestIntegrationContext } from '../../../../packages/stellar-core/src/integrationTypes.js';
import type { SorobanEffectsSnapshot } from '../../../../packages/stellar-core/src/sorobanEffects.js';
import type { SorobanRequestOrigin } from '../../../../packages/stellar-core/src/requestTypes.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';
import type { Pool, PoolClient } from 'pg';
import { blobRequestPrivateDataStore } from '../server/blobRequestPrivateDataStore.js';
import type { RequestPrivateDataStore } from '../server/requestPrivateDataStore.js';
import { requestDiscoverySubjects } from '../server/requestDiscovery.js';
import type {
  SigningRequestStore,
  StoredRequestParticipant,
  StoredSignatureContribution,
  StoredSigningRequest,
  StoredSubmissionResult,
} from '../server/requestStore.js';
import { coordinationPool, withPostgresTransaction } from './postgres.js';
import { enqueueCoordinationChange } from './postgresIntegrationOutbox.js';

interface RequestRow {
  id: string;
  network: StellarNetwork;
  base_xdr: string;
  transaction_hash: string;
  created_at: Date | string;
  expires_at: Date | string;
  creator_address: string | null;
  creator_actor: MachineCallerProvenance | null;
  integration_context: RequestIntegrationContext | null;
  instruction_digest: string | null;
  execution_policy: ExecutionPolicy | null;
  discovery_signer_keys: string[];
  capability_hash: string | null;
  soroban_effects_baseline: SorobanEffectsSnapshot | null;
  soroban_origin: SorobanRequestOrigin | null;
  has_private_data: boolean;
}

interface RequestParentRow {
  integration_service_id: string | null;
  network: StellarNetwork;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function readRequest(
  db: Pool | PoolClient,
  privateStore: RequestPrivateDataStore,
  id: string,
): Promise<StoredSigningRequest | null> {
  const result = await db.query<RequestRow>(
    `SELECT id, network, base_xdr, transaction_hash, created_at, expires_at,
            creator_address, creator_actor, integration_context, instruction_digest,
            execution_policy, discovery_signer_keys, capability_hash,
            soroban_effects_baseline, soroban_origin, has_private_data
       FROM mst_stellar.classic_requests
      WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  const privateData = row.has_private_data
    ? await privateStore.getRequestPrivateData(id)
    : null;
  return {
    version: 1,
    id: row.id,
    network: row.network,
    baseXdr: row.base_xdr,
    transactionHash: row.transaction_hash,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    ...(row.creator_address ? { creatorAddress: row.creator_address } : {}),
    ...(row.creator_actor ? { creatorActor: row.creator_actor } : {}),
    ...(row.integration_context ? { integration: row.integration_context } : {}),
    ...(row.instruction_digest ? { instructionDigest: row.instruction_digest } : {}),
    ...(row.execution_policy ? { executionPolicy: row.execution_policy } : {}),
    ...(row.discovery_signer_keys.length > 0
      ? { discoverySignerKeys: row.discovery_signer_keys }
      : {}),
    ...(row.capability_hash ? { capabilityHash: row.capability_hash } : {}),
    ...(privateData?.initialPrivateNote ? { initialPrivateNote: privateData.initialPrivateNote } : {}),
    ...(privateData?.privateCommitment ? { privateCommitment: privateData.privateCommitment } : {}),
    ...(row.soroban_effects_baseline ? { sorobanEffectsBaseline: row.soroban_effects_baseline } : {}),
    ...(row.soroban_origin ? { sorobanOrigin: row.soroban_origin } : {}),
  };
}

async function lockParent(client: PoolClient, id: string): Promise<RequestParentRow | null> {
  const result = await client.query<RequestParentRow>(
    `SELECT integration_service_id, network
       FROM mst_stellar.classic_requests
      WHERE id = $1
      FOR UPDATE`,
    [id],
  );
  return result.rows[0] ?? null;
}

async function insertSubjects(
  client: PoolClient,
  requestId: string,
  network: StellarNetwork,
  purpose: 'discovery' | 'activity',
  kind: 'account' | 'signer',
  subjects: string[],
): Promise<void> {
  const values = [...new Set(subjects)].filter(Boolean);
  if (values.length === 0) return;
  await client.query(
    `INSERT INTO mst_stellar.classic_request_subjects (
       request_id, network, purpose, subject_kind, subject_id
     )
     SELECT $1, $2, $3, $4, subject
       FROM unnest($5::text[]) AS subject
     ON CONFLICT DO NOTHING`,
    [requestId, network, purpose, kind, values],
  );
}

async function insertActivityEvent(
  client: PoolClient,
  event: ActivityFactEvent,
): Promise<boolean> {
  const inserted = await client.query(
    `INSERT INTO mst_stellar.classic_activity_events (
       request_id, event_id, type, occurred_at, actor_address, actor, detail, ledger
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (request_id, event_id) DO NOTHING`,
    [
      event.requestId,
      event.eventId,
      event.type,
      event.occurredAt,
      event.actorAddress ?? null,
      event.actor ?? null,
      event.detail ?? null,
      event.ledger ?? null,
    ],
  );
  return inserted.rowCount === 1;
}

async function queryRequestIds(
  pool: Pool,
  network: StellarNetwork,
  purpose: 'discovery' | 'activity',
  accountIds: string[],
  signerAddress: string,
): Promise<string[]> {
  const accounts = [...new Set(accountIds)].filter(Boolean);
  const signer = signerAddress.trim();
  if (accounts.length === 0 && !signer) return [];
  const result = await pool.query<{ id: string }>(
    `SELECT DISTINCT r.id, r.created_at
       FROM mst_stellar.classic_request_subjects s
       JOIN mst_stellar.classic_requests r ON r.id = s.request_id
      WHERE s.network = $1
        AND s.purpose = $2
        AND (
          (s.subject_kind = 'account' AND s.subject_id = ANY($3::text[]))
          OR
          (s.subject_kind = 'signer' AND $4 <> '' AND s.subject_id = $4)
        )
      ORDER BY r.created_at DESC, r.id DESC`,
    [network, purpose, accounts, signer],
  );
  return result.rows.map((row) => row.id);
}

async function putPrivateRoot(
  privateStore: RequestPrivateDataStore,
  request: StoredSigningRequest,
): Promise<void> {
  if (!request.initialPrivateNote && !request.privateCommitment) return;
  await privateStore.putRequestPrivateData(request.id, {
    version: 1,
    ...(request.initialPrivateNote ? { initialPrivateNote: request.initialPrivateNote } : {}),
    ...(request.privateCommitment ? { privateCommitment: request.privateCommitment } : {}),
  });
}

export class PostgresSigningRequestStore implements SigningRequestStore {
  constructor(
    private readonly pool: Pool = coordinationPool(),
    private readonly privateStore: RequestPrivateDataStore = blobRequestPrivateDataStore,
    private readonly emitOutbox = true,
  ) {}

  async createRequest(request: StoredSigningRequest): Promise<void> {
    const subjects = requestDiscoverySubjects(request.baseXdr, request.network);
    const discoverySigners = request.discoverySignerKeys ?? subjects.directSignerKeys;
    const activitySigners = [...new Set([
      ...discoverySigners,
      ...(request.creatorAddress ? [request.creatorAddress] : []),
    ])].filter(isValidStellarAccountId);
    await putPrivateRoot(this.privateStore, request);

    await withPostgresTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO mst_stellar.classic_requests (
           id, network, base_xdr, transaction_hash, created_at, expires_at,
           creator_address, creator_actor, integration_service_id, integration_context,
           instruction_digest, execution_policy, discovery_signer_keys, capability_hash,
           soroban_effects_baseline, soroban_origin, has_private_data
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11, $12, $13, $14,
           $15, $16, $17
         )`,
        [
          request.id,
          request.network,
          request.baseXdr,
          request.transactionHash,
          request.createdAt,
          request.expiresAt,
          request.creatorAddress ?? null,
          request.creatorActor ?? null,
          request.integration?.serviceId ?? null,
          request.integration ?? null,
          request.instructionDigest ?? null,
          request.executionPolicy ?? null,
          request.discoverySignerKeys ?? [],
          request.capabilityHash ?? null,
          request.sorobanEffectsBaseline ?? null,
          request.sorobanOrigin ?? null,
          Boolean(request.initialPrivateNote || request.privateCommitment),
        ],
      );
      await insertSubjects(client, request.id, request.network, 'discovery', 'account', subjects.sourceAccountIds);
      await insertSubjects(client, request.id, request.network, 'discovery', 'signer', discoverySigners);
      await insertSubjects(client, request.id, request.network, 'activity', 'account', subjects.sourceAccountIds);
      await insertSubjects(client, request.id, request.network, 'activity', 'signer', activitySigners);
      await insertActivityEvent(client, {
        version: 1,
        eventId: 'created',
        requestId: request.id,
        type: 'request_created',
        occurredAt: request.createdAt,
        ...(request.creatorAddress ? { actorAddress: request.creatorAddress } : {}),
        ...(request.creatorActor ? { actor: request.creatorActor } : {}),
      });
      if (this.emitOutbox && request.integration) {
        await enqueueCoordinationChange(client, {
          serviceId: request.integration.serviceId,
          resourceKind: 'classic_request',
          resourceId: request.id,
          changeKey: 'created',
          change: 'created',
          occurredAt: request.createdAt,
        });
      }
    });
  }

  getRequest(id: string): Promise<StoredSigningRequest | null> {
    return readRequest(this.pool, this.privateStore, id);
  }

  async listRequests(): Promise<StoredSigningRequest[]> {
    const ids = await this.pool.query<{ id: string }>(
      'SELECT id FROM mst_stellar.classic_requests ORDER BY created_at DESC, id DESC',
    );
    const values = await Promise.all(ids.rows.map((row) => this.getRequest(row.id)));
    return values.filter((value): value is StoredSigningRequest => Boolean(value));
  }

  async listRequestsByDiscoverySubjects(
    network: StellarNetwork,
    sourceAccountIds: string[],
    directSignerKey: string,
  ): Promise<StoredSigningRequest[]> {
    const ids = await queryRequestIds(this.pool, network, 'discovery', sourceAccountIds, directSignerKey);
    const values = await Promise.all(ids.map((id) => this.getRequest(id)));
    return values.filter((value): value is StoredSigningRequest => Boolean(value));
  }

  async listRequestsByActivitySubjects(
    network: StellarNetwork,
    sourceAccountIds: string[],
    actorAddress: string,
  ): Promise<StoredSigningRequest[]> {
    const ids = await queryRequestIds(this.pool, network, 'activity', sourceAccountIds, actorAddress);
    const values = await Promise.all(ids.map((id) => this.getRequest(id)));
    return values.filter((value): value is StoredSigningRequest => Boolean(value));
  }

  async listContributions(id: string): Promise<StoredSignatureContribution[]> {
    const result = await this.pool.query<{ record: StoredSignatureContribution }>(
      `SELECT record
         FROM mst_stellar.classic_signature_contributions
        WHERE request_id = $1
        ORDER BY received_at, digest`,
      [id],
    );
    return result.rows.map((row) => row.record);
  }

  async putContribution(id: string, contribution: StoredSignatureContribution): Promise<void> {
    await withPostgresTransaction(this.pool, async (client) => {
      const parent = await lockParent(client, id);
      if (!parent) return;
      const inserted = await client.query(
        `INSERT INTO mst_stellar.classic_signature_contributions (
           request_id, digest, received_at, record
         ) VALUES ($1, $2, $3, $4)
         ON CONFLICT (request_id, digest) DO NOTHING`,
        [id, contribution.digest, contribution.receivedAt, contribution],
      );
      if (!inserted.rowCount) return;

      const actorAddresses = [...new Set(
        (contribution.acceptedSignatures ?? [])
          .map((item) => item.signerKey)
          .filter(isValidStellarAccountId),
      )];
      await insertSubjects(client, id, parent.network, 'activity', 'signer', actorAddresses);
      await insertActivityEvent(client, {
        version: 1,
        eventId: `approval-${contribution.digest}`,
        requestId: id,
        type: 'approval_added',
        occurredAt: contribution.receivedAt,
        ...(actorAddresses.length === 1 ? { actorAddress: actorAddresses[0] } : {}),
        ...(contribution.submittedBy ? { actor: contribution.submittedBy } : {}),
      });
      if (this.emitOutbox && parent.integration_service_id) {
        await enqueueCoordinationChange(client, {
          serviceId: parent.integration_service_id,
          resourceKind: 'classic_request',
          resourceId: id,
          changeKey: `signature:${contribution.digest}`,
          change: 'signature_contributed',
          occurredAt: contribution.receivedAt,
        });
      }
    });
  }

  async getSubmission(id: string, transactionHash: string): Promise<StoredSubmissionResult | null> {
    const result = await this.pool.query<{
      transaction_hash: string;
      ledger: string;
      submitted_at: Date | string;
    }>(
      `SELECT transaction_hash, ledger, submitted_at
         FROM mst_stellar.classic_submissions
        WHERE request_id = $1 AND transaction_hash = $2`,
      [id, transactionHash],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      version: 1,
      transactionHash: row.transaction_hash,
      ledger: Number(row.ledger),
      submittedAt: iso(row.submitted_at),
    };
  }

  async putSubmission(id: string, submission: StoredSubmissionResult): Promise<void> {
    await withPostgresTransaction(this.pool, async (client) => {
      const parent = await lockParent(client, id);
      if (!parent) return;
      const inserted = await client.query(
        `INSERT INTO mst_stellar.classic_submissions (
           request_id, transaction_hash, ledger, submitted_at
         ) VALUES ($1, $2, $3, $4)
         ON CONFLICT (request_id, transaction_hash) DO NOTHING`,
        [id, submission.transactionHash, submission.ledger, submission.submittedAt],
      );
      if (!inserted.rowCount) return;
      await insertActivityEvent(client, {
        version: 1,
        eventId: `confirmed-${submission.transactionHash}`,
        requestId: id,
        type: 'transaction_confirmed',
        occurredAt: submission.submittedAt,
        ledger: submission.ledger,
      });
      if (this.emitOutbox && parent.integration_service_id) {
        await enqueueCoordinationChange(client, {
          serviceId: parent.integration_service_id,
          resourceKind: 'classic_request',
          resourceId: id,
          changeKey: `submission:${submission.transactionHash}`,
          change: 'execution_confirmed',
          occurredAt: submission.submittedAt,
        });
      }
    });
  }

  async getRequestParticipant(id: string, address: string): Promise<StoredRequestParticipant | null> {
    const result = await this.pool.query<{ joined_at: Date | string }>(
      `SELECT joined_at
         FROM mst_stellar.classic_request_participants
        WHERE request_id = $1 AND address = $2`,
      [id, address],
    );
    const row = result.rows[0];
    return row ? { version: 1, address, joinedAt: iso(row.joined_at) } : null;
  }

  async listRequestParticipants(id: string): Promise<StoredRequestParticipant[]> {
    const result = await this.pool.query<{ address: string; joined_at: Date | string }>(
      `SELECT address, joined_at
         FROM mst_stellar.classic_request_participants
        WHERE request_id = $1
        ORDER BY joined_at, address`,
      [id],
    );
    return result.rows.map((row) => ({
      version: 1,
      address: row.address,
      joinedAt: iso(row.joined_at),
    }));
  }

  async putRequestParticipant(id: string, participant: StoredRequestParticipant): Promise<void> {
    await withPostgresTransaction(this.pool, async (client) => {
      const parent = await lockParent(client, id);
      if (!parent) return;
      const inserted = await client.query(
        `INSERT INTO mst_stellar.classic_request_participants (
           request_id, address, joined_at
         ) VALUES ($1, $2, $3)
         ON CONFLICT (request_id, address) DO NOTHING`,
        [id, participant.address, participant.joinedAt],
      );
      if (!inserted.rowCount) return;
      if (isValidStellarAccountId(participant.address)) {
        await insertSubjects(client, id, parent.network, 'activity', 'signer', [participant.address]);
      }
    });
  }

  async listActivityEvents(id: string): Promise<ActivityEvent[]> {
    const result = await this.pool.query<{
      event_id: string;
      type: ActivityEvent['type'];
      occurred_at: Date | string;
      actor_address: string | null;
      actor: MachineCallerProvenance | null;
      detail: string | null;
      ledger: string | null;
    }>(
      `SELECT event_id, type, occurred_at, actor_address, actor, detail, ledger
         FROM mst_stellar.classic_activity_events
        WHERE request_id = $1
        ORDER BY occurred_at, event_id`,
      [id],
    );
    return result.rows.map((row) => ({
      version: 1,
      eventId: row.event_id,
      requestId: id,
      type: row.type,
      occurredAt: iso(row.occurred_at),
      ...(row.actor_address ? { actorAddress: row.actor_address } : {}),
      ...(row.actor ? { actor: row.actor } : {}),
      ...(row.detail ? { detail: row.detail } : {}),
      ...(row.ledger !== null ? { ledger: Number(row.ledger) } : {}),
    }));
  }

  async putActivityEvent(id: string, event: ActivityFactEvent): Promise<void> {
    await withPostgresTransaction(this.pool, async (client) => {
      const parent = await lockParent(client, id);
      if (!parent) return;
      const inserted = await insertActivityEvent(client, event);
      if (inserted && event.actorAddress && isValidStellarAccountId(event.actorAddress)) {
        await insertSubjects(client, id, parent.network, 'activity', 'signer', [event.actorAddress]);
      }
      if (this.emitOutbox && inserted && parent.integration_service_id) {
        await enqueueCoordinationChange(client, {
          serviceId: parent.integration_service_id,
          resourceKind: 'classic_request',
          resourceId: id,
          changeKey: `activity:${event.eventId}`,
          change: event.type,
          occurredAt: event.occurredAt,
        });
      }
    });
  }

  listPrivateNoteRevisions(id: string) {
    return this.privateStore.listPrivateNoteRevisions(id);
  }

  putPrivateNoteRevision(id: string, revision: Parameters<NonNullable<SigningRequestStore['putPrivateNoteRevision']>>[1]) {
    return this.privateStore.putPrivateNoteRevision(id, revision);
  }
}

export function createPostgresSigningRequestStore(
  pool: Pool = coordinationPool(),
  privateStore: RequestPrivateDataStore = blobRequestPrivateDataStore,
  options: { emitOutbox?: boolean } = {},
): SigningRequestStore {
  return new PostgresSigningRequestStore(pool, privateStore, options.emitOutbox ?? true);
}
