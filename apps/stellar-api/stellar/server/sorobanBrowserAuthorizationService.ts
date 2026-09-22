import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { xdr } from '@stellar/stellar-sdk/base';
import { isValidStellarAccountId } from '../../../../packages/stellar-core/src/horizon.js';
import { sorobanAuthorizationEntryPreimageXdr } from '../../../../packages/stellar-core/src/sorobanAuthorization.js';
import type { SorobanIntentAuthorizationSnapshot } from './sorobanIntentAuthorizationService.js';
import type { StoredSorobanIntent } from './sorobanIntentStore.js';
import type {
  SorobanBrowserAuthorizationStore,
  StoredSorobanBrowserAuthorizationCapability,
} from './sorobanBrowserAuthorizationStore.js';

const CAPABILITY_PREFIX = 'mic';
const CAPABILITY_ID_BYTES = 9;
const CAPABILITY_SECRET_BYTES = 32;
const DEFAULT_CAPABILITY_LIFETIME_MS = 30 * 60 * 1000;

export class SorobanBrowserAuthorizationServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'SorobanBrowserAuthorizationServiceError';
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function currentRevision(stored: StoredSorobanIntent): number {
  return stored.authorizationPlanRevision ?? 1;
}

export function normalizeBrowserAuthorizationOrigin(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new SorobanBrowserAuthorizationServiceError(
      'Browser authorization requires an exact browser origin.',
      400,
      'invalid_browser_origin',
    );
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new SorobanBrowserAuthorizationServiceError(
      'Browser authorization origin is invalid.',
      400,
      'invalid_browser_origin',
    );
  }
  const localHttp = url.protocol === 'http:'
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  if (url.protocol !== 'https:' && !localHttp) {
    throw new SorobanBrowserAuthorizationServiceError(
      'Browser authorization origin must use HTTPS, except localhost development.',
      400,
      'invalid_browser_origin',
    );
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new SorobanBrowserAuthorizationServiceError(
      'Browser authorization origin must be an origin only, without credentials, path, query, or fragment.',
      400,
      'invalid_browser_origin',
    );
  }
  return url.origin;
}

function pendingForSigner(
  authorization: SorobanIntentAuthorizationSnapshot,
  signerAddress: string,
) {
  return authorization.authorizers.filter((authorizer) =>
    !authorizer.ready
    && authorizer.activeSigners.some((signer) => signer.publicKey === signerAddress)
    && !authorizer.signerEvidence.some((signer) => signer.publicKey === signerAddress));
}

function signerKnown(
  authorization: SorobanIntentAuthorizationSnapshot,
  signerAddress: string,
): boolean {
  return authorization.authorizers.some((authorizer) =>
    authorizer.activeSigners.some((signer) => signer.publicKey === signerAddress)
    || authorizer.signerEvidence.some((signer) => signer.publicKey === signerAddress));
}

export async function issueSorobanBrowserAuthorizationCapability(
  store: SorobanBrowserAuthorizationStore,
  stored: StoredSorobanIntent,
  authorization: SorobanIntentAuthorizationSnapshot,
  input: {
    integrationServiceId: string;
    signerAddress: unknown;
    origin: unknown;
  },
  options: {
    now?: Date;
    lifetimeMs?: number;
    idFactory?: () => string;
    secretFactory?: () => string;
  } = {},
): Promise<{
  capability: string;
  record: StoredSorobanBrowserAuthorizationCapability;
}> {
  if (!stored.integration || stored.integration.serviceId !== input.integrationServiceId) {
    throw new SorobanBrowserAuthorizationServiceError(
      'Only the Integration Service that owns this Intent can issue Browser authorization.',
      403,
      'browser_authorization_owner_required',
    );
  }
  const signerAddress = typeof input.signerAddress === 'string' ? input.signerAddress.trim() : '';
  if (!isValidStellarAccountId(signerAddress)) {
    throw new SorobanBrowserAuthorizationServiceError(
      'A valid Stellar signer address is required.',
      400,
      'invalid_browser_signer',
    );
  }
  if (stored.cancellation) {
    throw new SorobanBrowserAuthorizationServiceError(
      'This Intent is cancelled and cannot issue Browser authorization.',
      409,
      'intent_cancelled',
    );
  }
  if (authorization.status !== 'awaiting_authorization' || pendingForSigner(authorization, signerAddress).length === 0) {
    throw new SorobanBrowserAuthorizationServiceError(
      'This signer is not currently needed for this Intent authorization.',
      409,
      'browser_signer_not_pending',
    );
  }

  const origin = normalizeBrowserAuthorizationOrigin(input.origin);
  const now = options.now ?? new Date();
  const lifetimeMs = options.lifetimeMs ?? DEFAULT_CAPABILITY_LIFETIME_MS;
  if (!Number.isFinite(lifetimeMs) || lifetimeMs <= 0 || lifetimeMs > DEFAULT_CAPABILITY_LIFETIME_MS) {
    throw new SorobanBrowserAuthorizationServiceError(
      'Browser authorization lifetime is invalid.',
      400,
      'invalid_browser_capability_lifetime',
    );
  }
  const capabilityId = options.idFactory?.() ?? randomBytes(CAPABILITY_ID_BYTES).toString('base64url');
  const secret = options.secretFactory?.() ?? randomBytes(CAPABILITY_SECRET_BYTES).toString('base64url');
  const capability = `${CAPABILITY_PREFIX}_${capabilityId}_${secret}`;
  const record: StoredSorobanBrowserAuthorizationCapability = {
    version: 1,
    capabilityId,
    intentId: stored.id,
    integrationServiceId: stored.integration.serviceId,
    signerAddress,
    authorizationPlanRevision: currentRevision(stored),
    authorizationPlanDigest: stored.authorizationPlan.authorizationPlanDigest,
    origin,
    secretHash: sha256(capability),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + lifetimeMs).toISOString(),
  };
  await store.putCapability(record);
  return { capability, record };
}

function capabilityParts(value: string): { capabilityId: string; capability: string } {
  const capability = value.trim();
  const marker = `${CAPABILITY_PREFIX}_`;
  if (!capability.startsWith(marker)) {
    throw new SorobanBrowserAuthorizationServiceError(
      'Invalid Browser authorization capability.',
      401,
      'invalid_browser_capability',
    );
  }
  const separator = capability.indexOf('_', marker.length);
  if (separator < 0) {
    throw new SorobanBrowserAuthorizationServiceError(
      'Invalid Browser authorization capability.',
      401,
      'invalid_browser_capability',
    );
  }
  const capabilityId = capability.slice(marker.length, separator);
  const secret = capability.slice(separator + 1);
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(capabilityId) || !/^[A-Za-z0-9_-]{32,128}$/.test(secret)) {
    throw new SorobanBrowserAuthorizationServiceError(
      'Invalid Browser authorization capability.',
      401,
      'invalid_browser_capability',
    );
  }
  return { capabilityId, capability };
}

export async function authenticateSorobanBrowserAuthorizationCapability(
  store: SorobanBrowserAuthorizationStore,
  stored: StoredSorobanIntent,
  authorization: SorobanIntentAuthorizationSnapshot,
  input: {
    capability: string;
    origin: string | null;
  },
  now = new Date(),
): Promise<StoredSorobanBrowserAuthorizationCapability> {
  const parsed = capabilityParts(input.capability);
  const record = await store.getCapability(parsed.capabilityId);
  if (!record) {
    throw new SorobanBrowserAuthorizationServiceError(
      'Invalid Browser authorization capability.',
      401,
      'invalid_browser_capability',
    );
  }
  const expected = Buffer.from(record.secretHash, 'hex');
  const actual = Buffer.from(sha256(parsed.capability), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new SorobanBrowserAuthorizationServiceError(
      'Invalid Browser authorization capability.',
      401,
      'invalid_browser_capability',
    );
  }
  if (record.intentId !== stored.id || record.integrationServiceId !== stored.integration?.serviceId) {
    throw new SorobanBrowserAuthorizationServiceError(
      'This Browser authorization capability does not belong to this Intent.',
      403,
      'browser_capability_scope_denied',
    );
  }
  if (!input.origin || input.origin !== record.origin) {
    throw new SorobanBrowserAuthorizationServiceError(
      'This Browser authorization capability is not valid for this origin.',
      403,
      'browser_capability_origin_denied',
    );
  }
  if (Date.parse(record.expiresAt) <= now.getTime()) {
    throw new SorobanBrowserAuthorizationServiceError(
      'This Browser authorization capability has expired.',
      410,
      'browser_capability_expired',
    );
  }
  if (
    record.authorizationPlanRevision !== currentRevision(stored)
    || record.authorizationPlanDigest !== stored.authorizationPlan.authorizationPlanDigest
    || record.authorizationPlanDigest !== authorization.authorizationPlanDigest
  ) {
    throw new SorobanBrowserAuthorizationServiceError(
      'This Browser authorization capability belongs to an older AuthorizationPlan.',
      409,
      'browser_capability_stale',
    );
  }
  if (stored.cancellation) {
    throw new SorobanBrowserAuthorizationServiceError(
      'This Intent is cancelled.',
      409,
      'intent_cancelled',
    );
  }
  if (!signerKnown(authorization, record.signerAddress)) {
    throw new SorobanBrowserAuthorizationServiceError(
      'This signer is no longer valid for the current authorization.',
      403,
      'browser_signer_not_current',
    );
  }
  return record;
}

export interface SorobanBrowserAuthorizationProjection {
  version: 1;
  intentId: string;
  network: StoredSorobanIntent['network'];
  intentDigest: string;
  authorizationPlanDigest: string;
  authorizationPlanRevision: number;
  signerAddress: string;
  status: SorobanIntentAuthorizationSnapshot['status'];
  expiresAt: string;
  challenges: Array<{
    entryIndex: number;
    authorizer: string;
    preimageXdr: string;
    expiresAtLedger: number;
  }>;
  hostedReviewUrl: string;
}

export function projectSorobanBrowserAuthorization(
  stored: StoredSorobanIntent,
  authorization: SorobanIntentAuthorizationSnapshot,
  capability: StoredSorobanBrowserAuthorizationCapability,
  hostedReviewUrl: string,
): SorobanBrowserAuthorizationProjection {
  const challenges = pendingForSigner(authorization, capability.signerAddress).map((authorizer) => {
    const entryXdr = authorization.authorizationEntriesXdr[authorizer.entryIndex];
    if (!entryXdr) {
      throw new SorobanBrowserAuthorizationServiceError(
        'The current authorization challenge is unavailable. Refresh this Intent.',
        409,
        'browser_authorization_challenge_unavailable',
      );
    }
    return {
      entryIndex: authorizer.entryIndex,
      authorizer: authorizer.authorizer,
      preimageXdr: sorobanAuthorizationEntryPreimageXdr({
        entry: xdr.SorobanAuthorizationEntry.fromXdr(entryXdr, 'base64'),
        network: stored.network,
        expirationLedger: authorizer.expirationLedger,
      }),
      expiresAtLedger: authorizer.expirationLedger,
    };
  });
  return {
    version: 1,
    intentId: stored.id,
    network: stored.network,
    intentDigest: stored.intent.intentDigest,
    authorizationPlanDigest: authorization.authorizationPlanDigest,
    authorizationPlanRevision: currentRevision(stored),
    signerAddress: capability.signerAddress,
    status: authorization.status,
    expiresAt: capability.expiresAt,
    challenges,
    hostedReviewUrl,
  };
}
