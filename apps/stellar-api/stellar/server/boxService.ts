import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  MAX_ACTIVE_TREASURY_AUDIT_KEYS,
  type BoxAuditAction,
  type BoxAuditActor,
  type BoxAuditEvent,
  type TreasuryAuditKeySummary,
  type TreasuryBoxMetadata,
  type TreasuryBoxRef,
} from '../../../../packages/stellar-core/src/boxTypes.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';
import { inspectTransactionXdr } from '../../../../packages/stellar-core/src/transactionXdr.js';
import type { BoxStore, StoredTreasuryAuditKey } from './boxStore.js';

const AUDIT_KEY_PREFIX = 'mta';
const API_KEY_ID_BYTES = 9;
const API_KEY_SECRET_BYTES = 32;
const API_KEY_ID_CHARS = Math.ceil((API_KEY_ID_BYTES * 4) / 3);
const API_KEY_SECRET_CHARS = Math.ceil((API_KEY_SECRET_BYTES * 4) / 3);
const API_KEY_PART_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_BOX_NAME_CHARS = 80;
const MAX_KEY_LABEL_CHARS = 80;
const MAX_IDEMPOTENCY_CHARS = 160;
const MAX_EXTERNAL_REFERENCE_CHARS = 160;

export class BoxServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'BoxServiceError';
    this.status = status;
    this.code = code;
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizedText(value: unknown, label: string, maxChars: number): string {
  const code = `invalid_${label.toLowerCase().replaceAll(' ', '_')}`;
  if (typeof value !== 'string') throw new BoxServiceError(`${label} must be text.`, 400, code);
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new BoxServiceError(`${label} is required.`, 400, code);
  if ([...normalized].length > maxChars) throw new BoxServiceError(`${label} is too long.`, 400, code);
  if (/\p{Cc}/u.test(normalized)) throw new BoxServiceError(`${label} contains control characters.`, 400, code);
  return normalized;
}

export function treasuryBoxRef(network: StellarNetwork, accountId: string): TreasuryBoxRef {
  return { type: 'treasury', network, accountId: accountId.trim() };
}

export function sameTreasuryBox(a: TreasuryBoxRef, b: TreasuryBoxRef): boolean {
  return a.type === b.type && a.network === b.network && a.accountId === b.accountId;
}

export function normalizeTreasuryName(value: unknown): string {
  return normalizedText(value, 'Treasury name', MAX_BOX_NAME_CHARS);
}

export function normalizeAuditCredentialLabel(value: unknown): string {
  return normalizedText(value, 'Audit credential label', MAX_KEY_LABEL_CHARS);
}

export function normalizeIdempotencyKey(value: unknown): string {
  return normalizedText(value, 'Idempotency key', MAX_IDEMPOTENCY_CHARS);
}

export function normalizeExternalReference(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return normalizedText(value, 'External reference', MAX_EXTERNAL_REFERENCE_CHARS);
}

export function idempotencyHash(value: string): string {
  return sha256(value);
}

/**
 * Low-level single-Treasury XDR assertion retained for resource-specific uses.
 * Signer Agent access does not use this restriction; it verifies the principal
 * against every transaction source through current Stellar signer state.
 */
export function assertTreasuryProposalBound(
  box: TreasuryBoxRef,
  network: StellarNetwork,
  xdr: string,
): void {
  if (network !== box.network) {
    throw new BoxServiceError('Transaction network does not match this Treasury.', 403, 'box_network_mismatch');
  }
  let inspection;
  try {
    inspection = inspectTransactionXdr(xdr, network);
  } catch (cause) {
    throw new BoxServiceError(cause instanceof Error ? cause.message : 'Invalid transaction envelope XDR.', 400, 'invalid_xdr');
  }
  if (inspection.transactionSourceAccount !== box.accountId) {
    throw new BoxServiceError('Transaction source does not match this Treasury.', 403, 'box_source_mismatch');
  }
  const foreignSource = inspection.sourceRequirements.find((requirement) => requirement.accountId !== box.accountId);
  if (foreignSource) {
    throw new BoxServiceError('This Treasury-specific operation does not accept another source account.', 403, 'box_multi_source_denied');
  }
}

export function auditKeySummary(key: StoredTreasuryAuditKey): TreasuryAuditKeySummary {
  return {
    keyId: key.keyId,
    label: key.label,
    prefix: key.prefix,
    createdAt: key.createdAt,
    createdBy: key.createdBy,
    ...(key.lastUsedAt ? { lastUsedAt: key.lastUsedAt } : {}),
    ...(key.revokedAt ? { revokedAt: key.revokedAt } : {}),
    ...(key.revokedBy ? { revokedBy: key.revokedBy } : {}),
  };
}

function auditKeyIdFromValue(apiKeyValue: string): string {
  const apiKey = apiKeyValue.trim();
  const marker = `${AUDIT_KEY_PREFIX}_`;
  const separatorIndex = marker.length + API_KEY_ID_CHARS;
  const expectedLength = separatorIndex + 1 + API_KEY_SECRET_CHARS;
  if (!apiKey.startsWith(marker) || apiKey.length !== expectedLength || apiKey[separatorIndex] !== '_') {
    throw new BoxServiceError('Invalid Treasury Audit credential.', 401, 'invalid_audit_credential');
  }
  const keyId = apiKey.slice(marker.length, separatorIndex);
  const secret = apiKey.slice(separatorIndex + 1);
  if (!API_KEY_PART_PATTERN.test(keyId) || !API_KEY_PART_PATTERN.test(secret)) {
    throw new BoxServiceError('Invalid Treasury Audit credential.', 401, 'invalid_audit_credential');
  }
  return keyId;
}

export function looksLikeTreasuryAuditCredential(value: string): boolean {
  return value.trim().startsWith(`${AUDIT_KEY_PREFIX}_`);
}

export async function authenticateTreasuryAuditKey(
  store: BoxStore,
  apiKeyValue: string,
): Promise<StoredTreasuryAuditKey> {
  const apiKey = apiKeyValue.trim();
  const keyId = auditKeyIdFromValue(apiKey);
  const stored = await store.getAuditKey(keyId);
  if (!stored) throw new BoxServiceError('Invalid Treasury Audit credential.', 401, 'invalid_audit_credential');
  const expected = Buffer.from(stored.secretHash, 'hex');
  const actual = Buffer.from(sha256(apiKey), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new BoxServiceError('Invalid Treasury Audit credential.', 401, 'invalid_audit_credential');
  }
  if (stored.revokedAt) throw new BoxServiceError('This Treasury Audit credential has been revoked.', 401, 'audit_credential_revoked');
  return stored;
}

function auditHash(event: Omit<BoxAuditEvent, 'integrityHash'>): string {
  return sha256(JSON.stringify(event));
}

export function createBoxAuditEvent(
  box: TreasuryBoxRef,
  actor: BoxAuditActor,
  action: BoxAuditAction,
  options: {
    now?: Date;
    eventId?: string;
    detail?: string;
    metadata?: Record<string, string | number | boolean>;
  } = {},
): BoxAuditEvent {
  const base: Omit<BoxAuditEvent, 'integrityHash'> = {
    version: 1,
    eventId: options.eventId ?? randomUUID(),
    box,
    occurredAt: (options.now ?? new Date()).toISOString(),
    actor,
    action,
    ...(options.detail ? { detail: options.detail } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
  };
  return { ...base, integrityHash: auditHash(base) };
}

export async function recordBoxAudit(
  store: BoxStore,
  box: TreasuryBoxRef,
  actor: BoxAuditActor,
  action: BoxAuditAction,
  options: Parameters<typeof createBoxAuditEvent>[3] = {},
): Promise<BoxAuditEvent> {
  const event = createBoxAuditEvent(box, actor, action, options);
  await store.putAuditEvent(event);
  return event;
}

export async function renameTreasuryBox(
  store: BoxStore,
  box: TreasuryBoxRef,
  nameValue: unknown,
  actorAddress: string,
  now = new Date(),
): Promise<TreasuryBoxMetadata> {
  const name = normalizeTreasuryName(nameValue);
  const previous = await store.getMetadata(box);
  if (previous?.name === name) return previous;
  const metadata: TreasuryBoxMetadata = {
    version: 1,
    box,
    name,
    updatedAt: now.toISOString(),
    updatedBy: actorAddress,
  };
  await store.putMetadata(metadata);
  await recordBoxAudit(store, box, { type: 'stellar', id: actorAddress }, 'box_name_changed', {
    now,
    detail: previous?.name ? `Renamed treasury from ${previous.name} to ${name}.` : `Named treasury ${name}.`,
    metadata: { name, ...(previous?.name ? { previousName: previous.name } : {}) },
  });
  return metadata;
}

export async function createTreasuryAuditKey(
  store: BoxStore,
  box: TreasuryBoxRef,
  labelValue: unknown,
  actorAddress: string,
  now = new Date(),
): Promise<{ auditKey: string; key: TreasuryAuditKeySummary }> {
  const activeKeyCount = (await store.listAuditKeys(box)).filter((key) => !key.revokedAt).length;
  if (activeKeyCount >= MAX_ACTIVE_TREASURY_AUDIT_KEYS) {
    throw new BoxServiceError(
      `This Treasury already has ${MAX_ACTIVE_TREASURY_AUDIT_KEYS} active Audit credentials. Revoke one before creating another.`,
      409,
      'audit_credential_limit_reached',
    );
  }
  const label = normalizeAuditCredentialLabel(labelValue);
  const keyId = randomBytes(API_KEY_ID_BYTES).toString('base64url');
  const secret = randomBytes(API_KEY_SECRET_BYTES).toString('base64url');
  const auditKey = `${AUDIT_KEY_PREFIX}_${keyId}_${secret}`;
  const record: StoredTreasuryAuditKey = {
    version: 1,
    keyId,
    box,
    label,
    prefix: `${AUDIT_KEY_PREFIX}_${keyId}`,
    secretHash: sha256(auditKey),
    createdAt: now.toISOString(),
    createdBy: actorAddress,
  };
  await store.putAuditKey(record);
  await recordBoxAudit(store, box, { type: 'stellar', id: actorAddress }, 'audit_credential_created', {
    now,
    detail: `Created Treasury Audit credential ${record.label}.`,
    metadata: { keyId: record.keyId, label: record.label, prefix: record.prefix },
  });
  return { auditKey, key: auditKeySummary(record) };
}

export async function revokeTreasuryAuditKey(
  store: BoxStore,
  box: TreasuryBoxRef,
  keyIdValue: string,
  actorAddress: string,
  now = new Date(),
): Promise<TreasuryAuditKeySummary> {
  const keyId = keyIdValue.trim();
  const key = await store.getAuditKey(keyId);
  if (!key || !sameTreasuryBox(key.box, box)) {
    throw new BoxServiceError('Audit credential not found for this Treasury.', 404, 'audit_credential_not_found');
  }
  if (key.revokedAt) return auditKeySummary(key);
  const revoked: StoredTreasuryAuditKey = {
    ...key,
    revokedAt: now.toISOString(),
    revokedBy: actorAddress,
  };
  await store.putAuditKey(revoked);
  await recordBoxAudit(store, box, { type: 'stellar', id: actorAddress }, 'audit_credential_revoked', {
    now,
    detail: `Revoked Treasury Audit credential ${key.label}.`,
    metadata: { keyId: key.keyId, label: key.label, prefix: key.prefix },
  });
  return auditKeySummary(revoked);
}
