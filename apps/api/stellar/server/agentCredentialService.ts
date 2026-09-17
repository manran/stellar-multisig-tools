import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  MAX_ACTIVE_SIGNER_AGENT_CREDENTIALS,
  type AgentAccessLevel,
  type AgentActorProvenance,
  type SignerAgentCredentialSummary,
  type SignerPrincipalRef,
} from '../../../../src/stellar/agentAccessTypes.js';
import type { AgentCredentialStore, StoredSignerAgentCredential } from './agentCredentialStore.js';

const AGENT_KEY_PREFIX = 'msa';
const CREDENTIAL_ID_BYTES = 9;
const CREDENTIAL_SECRET_BYTES = 32;
const CREDENTIAL_ID_CHARS = Math.ceil((CREDENTIAL_ID_BYTES * 4) / 3);
const CREDENTIAL_SECRET_CHARS = Math.ceil((CREDENTIAL_SECRET_BYTES * 4) / 3);
const KEY_PART_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_LABEL_CHARS = 80;
const ACCESS_RANK: Record<AgentAccessLevel, number> = { read: 1, write: 2, sign: 3 };

export class AgentCredentialServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'AgentCredentialServiceError';
    this.status = status;
    this.code = code;
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeLabel(value: unknown): string {
  if (typeof value !== 'string') throw new AgentCredentialServiceError('Credential label must be text.', 400, 'invalid_credential_label');
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new AgentCredentialServiceError('Credential label is required.', 400, 'invalid_credential_label');
  if ([...normalized].length > MAX_LABEL_CHARS) throw new AgentCredentialServiceError('Credential label is too long.', 400, 'invalid_credential_label');
  if (/\p{Cc}/u.test(normalized)) throw new AgentCredentialServiceError('Credential label contains control characters.', 400, 'invalid_credential_label');
  return normalized;
}

export function normalizeAgentAccess(value: unknown): AgentAccessLevel {
  if (value === 'read' || value === 'write' || value === 'sign') return value;
  throw new AgentCredentialServiceError('Access must be read, write, or sign.', 400, 'invalid_agent_access');
}

export function sameSignerPrincipal(a: SignerPrincipalRef, b: SignerPrincipalRef): boolean {
  return a.type === b.type && a.network === b.network && a.address === b.address;
}

export function requireAgentAccess(credential: StoredSignerAgentCredential, required: AgentAccessLevel): void {
  if (ACCESS_RANK[credential.access] < ACCESS_RANK[required]) {
    throw new AgentCredentialServiceError(`This Agent credential requires ${required} access.`, 403, 'agent_access_denied');
  }
}

export function agentActorForCredential(credential: StoredSignerAgentCredential): AgentActorProvenance {
  return {
    type: 'agent',
    id: credential.credentialId,
    label: credential.label,
    principalAddress: credential.principal.address,
  };
}

export function agentCredentialSummary(credential: StoredSignerAgentCredential): SignerAgentCredentialSummary {
  return {
    credentialId: credential.credentialId,
    label: credential.label,
    prefix: credential.prefix,
    principal: credential.principal,
    access: credential.access,
    createdAt: credential.createdAt,
    createdBy: credential.createdBy,
    ...(credential.lastUsedAt ? { lastUsedAt: credential.lastUsedAt } : {}),
    ...(credential.revokedAt ? { revokedAt: credential.revokedAt } : {}),
    ...(credential.revokedBy ? { revokedBy: credential.revokedBy } : {}),
  };
}

export async function createSignerAgentCredential(
  store: AgentCredentialStore,
  principal: SignerPrincipalRef,
  labelValue: unknown,
  accessValue: unknown,
  createdBy: string,
  now = new Date(),
): Promise<{ apiKey: string; credential: SignerAgentCredentialSummary }> {
  const activeCount = (await store.listCredentials(principal)).filter((item) => !item.revokedAt).length;
  if (activeCount >= MAX_ACTIVE_SIGNER_AGENT_CREDENTIALS) {
    throw new AgentCredentialServiceError(
      `This signer already has ${MAX_ACTIVE_SIGNER_AGENT_CREDENTIALS} active Agent credentials. Revoke one before creating another.`,
      409,
      'agent_credential_limit_reached',
    );
  }
  const label = normalizeLabel(labelValue);
  const access = normalizeAgentAccess(accessValue);
  const credentialId = randomBytes(CREDENTIAL_ID_BYTES).toString('base64url');
  const secret = randomBytes(CREDENTIAL_SECRET_BYTES).toString('base64url');
  const apiKey = `${AGENT_KEY_PREFIX}_${credentialId}_${secret}`;
  const credential: StoredSignerAgentCredential = {
    version: 1,
    credentialId,
    principal,
    label,
    access,
    prefix: `${AGENT_KEY_PREFIX}_${credentialId}`,
    secretHash: sha256(apiKey),
    createdAt: now.toISOString(),
    createdBy,
  };
  await store.putCredential(credential);
  return { apiKey, credential: agentCredentialSummary(credential) };
}

function credentialIdFromApiKey(value: string): string {
  const apiKey = value.trim();
  const marker = `${AGENT_KEY_PREFIX}_`;
  const separatorIndex = marker.length + CREDENTIAL_ID_CHARS;
  const expectedLength = separatorIndex + 1 + CREDENTIAL_SECRET_CHARS;
  if (!apiKey.startsWith(marker) || apiKey.length !== expectedLength || apiKey[separatorIndex] !== '_') {
    throw new AgentCredentialServiceError('Invalid Agent credential.', 401, 'invalid_agent_credential');
  }
  const credentialId = apiKey.slice(marker.length, separatorIndex);
  const secret = apiKey.slice(separatorIndex + 1);
  if (!KEY_PART_PATTERN.test(credentialId) || !KEY_PART_PATTERN.test(secret)) {
    throw new AgentCredentialServiceError('Invalid Agent credential.', 401, 'invalid_agent_credential');
  }
  return credentialId;
}

export function looksLikeAgentCredential(value: string): boolean {
  return value.trim().startsWith(`${AGENT_KEY_PREFIX}_`);
}

export async function authenticateAgentCredential(
  store: AgentCredentialStore,
  value: string,
): Promise<StoredSignerAgentCredential> {
  const apiKey = value.trim();
  const credentialId = credentialIdFromApiKey(apiKey);
  const stored = await store.getCredential(credentialId);
  if (!stored) throw new AgentCredentialServiceError('Invalid Agent credential.', 401, 'invalid_agent_credential');
  const expected = Buffer.from(stored.secretHash, 'hex');
  const actual = Buffer.from(sha256(apiKey), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new AgentCredentialServiceError('Invalid Agent credential.', 401, 'invalid_agent_credential');
  }
  if (stored.revokedAt) throw new AgentCredentialServiceError('This Agent credential has been revoked.', 401, 'agent_credential_revoked');
  return stored;
}

export async function revokeSignerAgentCredential(
  store: AgentCredentialStore,
  principal: SignerPrincipalRef,
  credentialIdValue: string,
  revokedBy: string,
  now = new Date(),
): Promise<SignerAgentCredentialSummary> {
  const credentialId = credentialIdValue.trim();
  const stored = await store.getCredential(credentialId);
  if (!stored || !sameSignerPrincipal(stored.principal, principal)) {
    throw new AgentCredentialServiceError('Agent credential not found for this signer.', 404, 'agent_credential_not_found');
  }
  if (stored.revokedAt) return agentCredentialSummary(stored);
  const revoked: StoredSignerAgentCredential = {
    ...stored,
    revokedAt: now.toISOString(),
    revokedBy,
  };
  await store.putCredential(revoked);
  return agentCredentialSummary(revoked);
}
