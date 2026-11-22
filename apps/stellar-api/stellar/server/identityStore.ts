import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { coordinationPool, withPostgresTransaction } from '../db/postgres.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';

export class IdentityError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'IdentityError';
  }
}

export interface IdentityCredential {
  id: string;
  userId: string;
  kind: 'passkey' | 'stellar_wallet';
  subject: string;
  publicKey?: Uint8Array;
  counter: number;
  transports: string[];
  deviceType?: string;
  backedUp?: boolean;
}

export interface IdentityChallenge {
  id: string;
  challenge: string;
  purpose: 'register' | 'authenticate';
  userId: string | null;
  invitationId: string | null;
  network: StellarNetwork;
}

export interface IdentityInvitation {
  id: string;
  templateId: string;
  templateName: string;
  templateVersion: number;
  network: StellarNetwork;
  invitedByAddress: string;
}

interface CredentialRow {
  id: string;
  user_id: string;
  kind: 'passkey' | 'stellar_wallet';
  subject: string;
  public_key: Buffer | null;
  sign_count: string;
  transports: string[];
  device_type: string | null;
  backed_up: boolean | null;
}

function credentialFromRow(row: CredentialRow): IdentityCredential {
  return {
    id: row.id, userId: row.user_id, kind: row.kind, subject: row.subject,
    ...(row.public_key ? { publicKey: new Uint8Array(row.public_key) } : {}),
    counter: Number(row.sign_count), transports: row.transports,
    ...(row.device_type ? { deviceType: row.device_type } : {}),
    ...(row.backed_up !== null ? { backedUp: row.backed_up } : {}),
  };
}

/** All credentials refer to one stable user, while signing rights remain on-chain. */
export class PostgresIdentityStore {
  constructor(readonly pool: Pool = coordinationPool()) {}

  async findCredential(kind: IdentityCredential['kind'], subject: string): Promise<IdentityCredential | null> {
    const result = await this.pool.query<CredentialRow>(
      `SELECT id, user_id, kind, subject, public_key, sign_count, transports, device_type, backed_up
         FROM mst_stellar.mst_auth_credentials
        WHERE kind = $1 AND subject = $2 AND revoked_at IS NULL`,
      [kind, subject],
    );
    return result.rows[0] ? credentialFromRow(result.rows[0]) : null;
  }

  async listCredentials(userId: string): Promise<IdentityCredential[]> {
    const result = await this.pool.query<CredentialRow>(
      `SELECT id, user_id, kind, subject, public_key, sign_count, transports, device_type, backed_up
         FROM mst_stellar.mst_auth_credentials
        WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at`,
      [userId],
    );
    return result.rows.map(credentialFromRow);
  }

  async walletUser(address: string): Promise<string> {
    const known = await this.findCredential('stellar_wallet', address);
    if (known) return known.userId;
    // The two inserts are atomic; a simultaneous first login simply reuses the winner.
    return withPostgresTransaction(this.pool, async (client) => {
      const id = randomUUID();
      await client.query('INSERT INTO mst_stellar.mst_users(id) VALUES ($1)', [id]);
      const created = await client.query<{ user_id: string }>(
        `INSERT INTO mst_stellar.mst_auth_credentials(user_id, kind, subject)
         VALUES ($1, 'stellar_wallet', $2)
         ON CONFLICT (kind, subject) DO NOTHING RETURNING user_id`,
        [id, address],
      );
      if (created.rows[0]) return id;
      await client.query('DELETE FROM mst_stellar.mst_users WHERE id = $1', [id]);
      const previous = await client.query<{ user_id: string }>(
        `SELECT user_id FROM mst_stellar.mst_auth_credentials
          WHERE kind = 'stellar_wallet' AND subject = $1 AND revoked_at IS NULL`,
        [address],
      );
      if (!previous.rows[0]) throw new IdentityError('Wallet identity is unavailable.', 409, 'wallet_identity_conflict');
      return previous.rows[0].user_id;
    });
  }

  async linkWallet(userId: string, address: string): Promise<void> {
    const existing = await this.findCredential('stellar_wallet', address);
    if (existing?.userId === userId) return;
    if (existing) throw new IdentityError('This wallet is already linked to a different MST user.', 409, 'wallet_already_linked');
    try {
      await this.pool.query(
        `INSERT INTO mst_stellar.mst_auth_credentials(user_id, kind, subject)
         VALUES ($1, 'stellar_wallet', $2)`, [userId, address],
      );
    } catch (cause) {
      if ((cause as { code?: string }).code === '23505') {
        throw new IdentityError('This wallet is already linked.', 409, 'wallet_already_linked');
      }
      throw cause;
    }
  }

  async createChallenge(value: Omit<IdentityChallenge, 'id'>): Promise<IdentityChallenge> {
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO mst_stellar.mst_webauthn_challenges
        (id, challenge, purpose, user_id, invitation_id, network, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + interval '5 minutes')`,
      [id, value.challenge, value.purpose, value.userId, value.invitationId, value.network],
    );
    return { id, ...value };
  }

  async consumeChallenge(id: string, purpose: IdentityChallenge['purpose']): Promise<IdentityChallenge> {
    const result = await this.pool.query<{
      id: string; challenge: string; purpose: IdentityChallenge['purpose'];
      user_id: string | null; invitation_id: string | null; network: StellarNetwork;
    }>(
      `UPDATE mst_stellar.mst_webauthn_challenges
          SET used_at = now()
        WHERE id = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
      RETURNING id, challenge, purpose, user_id, invitation_id, network`, [id, purpose],
    );
    const value = result.rows[0];
    if (!value) throw new IdentityError('Authentication challenge expired or was already used.', 401, 'challenge_expired');
    return { id: value.id, challenge: value.challenge, purpose: value.purpose,
      userId: value.user_id, invitationId: value.invitation_id, network: value.network };
  }

  async createInvitation(templateId: string, network: StellarNetwork, invitedByAddress: string, hash: Buffer): Promise<void> {
    await this.pool.query(
      `INSERT INTO mst_stellar.mst_template_invitations
       (template_id, network, invited_by_address, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '24 hours')`,
      [templateId, network, invitedByAddress, hash],
    );
  }

  async invitation(hash: Buffer): Promise<IdentityInvitation | null> {
    const result = await this.pool.query<{
      id: string; template_id: string; name: string; current_version: number;
      network: StellarNetwork; invited_by_address: string;
    }>(
      `SELECT i.id, i.template_id, t.name, t.current_version, i.network, i.invited_by_address
         FROM mst_stellar.mst_template_invitations i
         JOIN mst_stellar.reusable_templates t ON t.id = i.template_id
        WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
          AND i.expires_at > now() AND t.archived_at IS NULL
          AND i.network = t.network AND t.kind = 'payment'`,
      [hash],
    );
    const row = result.rows[0];
    return row ? { id: row.id, templateId: row.template_id, templateName: row.name,
      templateVersion: row.current_version, network: row.network, invitedByAddress: row.invited_by_address } : null;
  }

  private async useInvitation(client: PoolClient, invitationId: string, userId: string): Promise<void> {
    const invitation = await client.query<{ template_id: string; invited_by_address: string }>(
      `UPDATE mst_stellar.mst_template_invitations i
          SET accepted_at = now(), accepted_by_user_id = $2
         FROM mst_stellar.reusable_templates t
        WHERE i.id = $1 AND i.template_id = t.id AND i.network = t.network
          AND t.kind = 'payment' AND t.archived_at IS NULL
          AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
      RETURNING i.template_id, i.invited_by_address`,
      [invitationId, userId],
    );
    const value = invitation.rows[0];
    if (!value) throw new IdentityError('This invitation expired or was already accepted.', 409, 'invitation_invalid');
    await client.query(
      `INSERT INTO mst_stellar.mst_template_user_grants(template_id, user_id, invited_by_address)
       VALUES ($1, $2, $3)
       ON CONFLICT (template_id, user_id) WHERE revoked_at IS NULL DO NOTHING`,
      [value.template_id, userId, value.invited_by_address],
    );
  }

  async acceptInvitation(invitationId: string, userId: string): Promise<void> {
    await withPostgresTransaction(this.pool, (client) => this.useInvitation(client, invitationId, userId));
  }

  async registerPasskey(value: {
    userId: string;
    newUser: boolean;
    invitationId: string | null;
    id: string;
    publicKey: Uint8Array;
    counter: number;
    transports: string[];
    deviceType: string;
    backedUp: boolean;
  }): Promise<void> {
    try {
      await withPostgresTransaction(this.pool, async (client) => {
        if (value.newUser) await client.query('INSERT INTO mst_stellar.mst_users(id) VALUES ($1)', [value.userId]);
        await client.query(
          `INSERT INTO mst_stellar.mst_auth_credentials
            (user_id, kind, subject, public_key, sign_count, transports, device_type, backed_up)
           VALUES ($1, 'passkey', $2, $3, $4, $5, $6, $7)`,
          [value.userId, value.id, Buffer.from(value.publicKey), value.counter,
            value.transports, value.deviceType, value.backedUp],
        );
        if (value.invitationId) await this.useInvitation(client, value.invitationId, value.userId);
      });
    } catch (cause) {
      if ((cause as { code?: string }).code === '23505') {
        throw new IdentityError('This Passkey already belongs to an account.', 409, 'passkey_already_registered');
      }
      throw cause;
    }
  }

  async updatePasskeyCounter(id: string, current: number, next: number): Promise<void> {
    const result = await this.pool.query(
      `UPDATE mst_stellar.mst_auth_credentials
          SET sign_count = $3, last_used_at = now()
        WHERE id = $1 AND sign_count = $2 AND kind = 'passkey' AND revoked_at IS NULL`,
      [id, current, next],
    );
    if (!result.rowCount) throw new IdentityError('Passkey was used concurrently. Please try again.', 409, 'passkey_counter_conflict');
  }

  async grantedTemplateIds(userId: string, network: StellarNetwork): Promise<string[]> {
    const result = await this.pool.query<{ template_id: string }>(
      `SELECT g.template_id FROM mst_stellar.mst_template_user_grants g
         JOIN mst_stellar.reusable_templates t ON t.id = g.template_id
        WHERE g.user_id = $1 AND g.revoked_at IS NULL AND t.network = $2
          AND t.archived_at IS NULL AND t.kind = 'payment'
        ORDER BY t.updated_at DESC LIMIT 100`,
      [userId, network],
    );
    return result.rows.map((row) => row.template_id);
  }

  async grantUsers(templateId: string): Promise<string[]> {
    const rows = await this.pool.query<{ user_id: string }>(
      `SELECT user_id FROM mst_stellar.mst_template_user_grants
        WHERE template_id = $1 AND revoked_at IS NULL ORDER BY created_at`,
      [templateId],
    );
    return rows.rows.map((row) => row.user_id);
  }

  async revokeUserGrant(templateId: string, userId: string, owner: string): Promise<void> {
    await this.pool.query(
      `UPDATE mst_stellar.mst_template_user_grants
          SET revoked_at = now(), revoked_by_address = $3
        WHERE template_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [templateId, userId, owner],
    );
  }

  async listPendingInvitations(templateId: string): Promise<{ id: string; expiresAt: string }[]> {
    const rows = await this.pool.query<{ id: string; expires_at: Date }>(
      `SELECT id, expires_at FROM mst_stellar.mst_template_invitations
        WHERE template_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
          AND expires_at > now() ORDER BY created_at DESC`, [templateId],
    );
    return rows.rows.map((r) => ({ id: r.id, expiresAt: new Date(r.expires_at).toISOString() }));
  }

  async revokeInvitation(templateId: string, inviteId: string, owner: string): Promise<void> {
    await this.pool.query(
      `UPDATE mst_stellar.mst_template_invitations
          SET revoked_at = now()
        WHERE id = $1 AND template_id = $2 AND invited_by_address = $3
          AND accepted_at IS NULL AND revoked_at IS NULL`, [inviteId, templateId, owner],
    );
  }

  async hasGrant(userId: string, templateId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM mst_stellar.mst_template_user_grants
        WHERE user_id = $1 AND template_id = $2 AND revoked_at IS NULL LIMIT 1`,
      [userId, templateId],
    );
    return Boolean(result.rowCount);
  }
}
