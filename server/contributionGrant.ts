import { randomUUID } from 'node:crypto';
import type { AuthStore } from './authStore.js';
import { getOrCreateAuthServerKeypair } from './authService.js';
import type { StellarNetwork } from '../src/stellar/types.js';

export const CONTRIBUTION_GRANT_TTL_SECONDS = 15 * 60;
const COOKIE_NAME = 'mst_contribution';

interface GrantOptions {
  now?: Date;
  homeDomain: string;
  issuer: string;
}

interface GrantPayload {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
  auth_mode: 'transaction_contribution';
  stellar_network: StellarNetwork;
  request_id: string;
  contribution_digest: string;
}

export interface ContributionGrant {
  address: string;
  network: StellarNetwork;
  requestId: string;
  contributionDigest: string;
  issuedAt: number;
  expiresAt: number;
}

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function tokenFromRequest(request: Request): string {
  const cookie = request.headers.get('cookie') ?? '';
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return decodeURIComponent(rest.join('='));
  }
  return '';
}

export async function issueContributionGrant(
  store: AuthStore,
  input: { address: string; network: StellarNetwork; requestId: string; contributionDigest: string },
  options: GrantOptions,
): Promise<{ token: string; grant: ContributionGrant }> {
  const now = options.now ?? new Date();
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = issuedAt + CONTRIBUTION_GRANT_TTL_SECONDS;
  const payload: GrantPayload = {
    iss: options.issuer,
    sub: input.address,
    aud: options.homeDomain,
    iat: issuedAt,
    exp: expiresAt,
    jti: randomUUID(),
    auth_mode: 'transaction_contribution',
    stellar_network: input.network,
    request_id: input.requestId,
    contribution_digest: input.contributionDigest,
  };
  const header = base64urlJson({ alg: 'EdDSA', typ: 'JWT' });
  const body = base64urlJson(payload);
  const unsigned = `${header}.${body}`;
  const server = await getOrCreateAuthServerKeypair(store, now);
  const signature = Buffer.from(server.sign(Buffer.from(unsigned))).toString('base64url');
  return {
    token: `${unsigned}.${signature}`,
    grant: {
      address: input.address,
      network: input.network,
      requestId: input.requestId,
      contributionDigest: input.contributionDigest,
      issuedAt,
      expiresAt,
    },
  };
}

export async function contributionGrantFromRequest(
  store: AuthStore,
  request: Request,
  options: GrantOptions,
): Promise<ContributionGrant | null> {
  const token = tokenFromRequest(request);
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as { alg?: string };
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as GrantPayload;
    if (header.alg !== 'EdDSA') return null;
    const server = await getOrCreateAuthServerKeypair(store, options.now);
    if (!server.verify(Buffer.from(`${parts[0]}.${parts[1]}`), Buffer.from(parts[2], 'base64url'))) return null;
    const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
    if (
      payload.iss !== options.issuer
      || payload.aud !== options.homeDomain
      || payload.auth_mode !== 'transaction_contribution'
      || (payload.stellar_network !== 'public' && payload.stellar_network !== 'testnet')
      || !payload.sub.startsWith('G')
      || !payload.request_id
      || !payload.contribution_digest
      || payload.exp <= nowSeconds
      || payload.iat > nowSeconds + 60
    ) return null;
    return {
      address: payload.sub,
      network: payload.stellar_network,
      requestId: payload.request_id,
      contributionDigest: payload.contribution_digest,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
    };
  } catch {
    return null;
  }
}

export function contributionGrantCookie(token: string): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/api/request; HttpOnly; Secure; SameSite=Lax; Max-Age=${CONTRIBUTION_GRANT_TTL_SECONDS}`;
}
