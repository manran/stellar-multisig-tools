import type { StellarNetwork } from './types.js';

export const MAX_ACTIVE_TREASURY_AUDIT_KEYS = 10;

export interface TreasuryBoxRef {
  type: 'treasury';
  network: StellarNetwork;
  accountId: string;
}

export interface TreasuryBoxMetadata {
  version: 1;
  box: TreasuryBoxRef;
  name?: string;
  updatedAt: string;
  updatedBy?: string;
}

export interface TreasuryAuditKeySummary {
  keyId: string;
  label: string;
  prefix: string;
  createdAt: string;
  createdBy: string;
  lastUsedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
}

export type BoxAuditAction =
  | 'box_name_changed'
  | 'audit_credential_created'
  | 'audit_credentials_viewed'
  | 'audit_credential_revoked';

export type BoxAuditActor =
  | { type: 'stellar'; id: string }
  | { type: 'treasury_audit'; id: string; label?: string };

export interface BoxAuditEvent {
  version: 1;
  eventId: string;
  box: TreasuryBoxRef;
  occurredAt: string;
  actor: BoxAuditActor;
  action: BoxAuditAction;
  detail?: string;
  metadata?: Record<string, string | number | boolean>;
  integrityHash: string;
}
