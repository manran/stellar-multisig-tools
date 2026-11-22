import { createHash } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import type { Pool } from 'pg';
import { coordinationPool } from '../db/postgres.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';

// Unlike Vercel Firewall rules, this quota also applies to the Cloudflare
// Tunnel / self-hosted Testnet API. Counters are shared across processes.
const WINDOW_SECONDS = 300;
const GLOBAL_LIMIT = 2000;
const LIMITS: Record<string, number> = {
  registration_options: 8,
  registration_verify: 16,
  authentication_options: 40,
  authentication_verify: 20,
  invitation_preview: 40,
  invitation_accept: 16,
  create_invitation: 15,
  revoke_user_grant: 20,
  revoke_invitation: 20,
  link_wallet: 12,
  unknown: 15,
};

export class IdentityQuotaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'IdentityQuotaError';
  }
}

export function identityClientAddress(request: Request): string | null {
  // Trust the header set by the actual ingress only. Accepting Cloudflare's
  // header on Vercel (or vice versa) would let callers spoof their quota key.
  const header = process.env.VERCEL === '1'
    ? 'x-vercel-forwarded-for' : 'cf-connecting-ip';
  const value = request.headers.get(header)?.trim();
  if (!value || value.includes(',') || !ipaddr.isValid(value)) return null;
  const parsed = ipaddr.parse(value);
  if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) {
    return parsed.toIPv4Address().toString();
  }
  return parsed instanceof ipaddr.IPv6 ? parsed.toNormalizedString() : parsed.toString();
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export async function consumeIdentityQuota(
  pool: Pick<Pool, 'query'>,
  bucket: string,
  actor: Buffer,
  limit: number,
  windowSeconds = WINDOW_SECONDS,
): Promise<boolean> {
  // The UPSERT serializes concurrent requests to one bucket. Failed attempts
  // count, and the first request after expiry starts a new window.
  const result = await pool.query<{ hits: number }>(
    `INSERT INTO mst_stellar.mst_identity_rate_limits(bucket, actor_hash, hits, reset_at)
       VALUES ($1, $2, 1, now() + ($3::integer * interval '1 second'))
       ON CONFLICT (bucket, actor_hash) DO UPDATE SET
         hits = CASE WHEN mst_stellar.mst_identity_rate_limits.reset_at <= now()
           THEN 1 ELSE mst_stellar.mst_identity_rate_limits.hits + 1 END,
         reset_at = CASE WHEN mst_stellar.mst_identity_rate_limits.reset_at <= now()
           THEN now() + ($3::integer * interval '1 second')
           ELSE mst_stellar.mst_identity_rate_limits.reset_at END
       RETURNING hits`,
    [bucket, actor, windowSeconds],
  );
  return Number(result.rows[0]?.hits ?? Number.POSITIVE_INFINITY) <= limit;
}

let lastPrune = 0;

export async function enforceIdentityQuota(
  request: Request,
  network: StellarNetwork,
  action: unknown,
  pool: Pick<Pool, 'query'> = coordinationPool(),
): Promise<void> {
  const kind = typeof action === 'string' && Object.hasOwn(LIMITS, action) ? action : 'unknown';
  const address = identityClientAddress(request) ?? 'unknown-edge-client';
  try {
    if (!await consumeIdentityQuota(pool, `${network}:${kind}:client`, digest(address), LIMITS[kind])) {
      throw new IdentityQuotaError('Too many identity requests. Try again later.', 429, 'identity_rate_limited', WINDOW_SECONDS);
    }
    if (!await consumeIdentityQuota(pool, `${network}:${kind}:global`, digest('all-clients'), GLOBAL_LIMIT)) {
      throw new IdentityQuotaError('Identity service is busy. Try again later.', 429, 'identity_rate_limited', WINDOW_SECONDS);
    }
    // Expired per-client hashes are pruned in small batches.
    if (Date.now() - lastPrune > 60_000) {
      lastPrune = Date.now();
      await pool.query(`WITH expired AS (
        SELECT bucket, actor_hash FROM mst_stellar.mst_identity_rate_limits
         WHERE reset_at < now() - interval '1 hour'
         ORDER BY reset_at LIMIT 200
       )
       DELETE FROM mst_stellar.mst_identity_rate_limits q USING expired e
       WHERE q.bucket = e.bucket AND q.actor_hash = e.actor_hash`);
    }
  } catch (cause) {
    if (cause instanceof IdentityQuotaError) throw cause;
    console.error('Identity quota storage unavailable', { cause });
    throw new IdentityQuotaError('Identity verification is temporarily unavailable.', 503, 'identity_rate_limit_unavailable');
  }
}
