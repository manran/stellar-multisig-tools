import type {
  BoxAuditEvent,
  TreasuryBoxMetadata,
  TreasuryBoxRef,
} from '../src/stellar/boxTypes.js';

export interface StoredTreasuryAuditKey {
  version: 1;
  keyId: string;
  box: TreasuryBoxRef;
  label: string;
  prefix: string;
  secretHash: string;
  createdAt: string;
  createdBy: string;
  lastUsedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
}

export interface BoxStore {
  getMetadata(box: TreasuryBoxRef): Promise<TreasuryBoxMetadata | null>;
  putMetadata(metadata: TreasuryBoxMetadata): Promise<void>;
  listAuditKeys(box: TreasuryBoxRef): Promise<StoredTreasuryAuditKey[]>;
  getAuditKey(keyId: string): Promise<StoredTreasuryAuditKey | null>;
  putAuditKey(key: StoredTreasuryAuditKey): Promise<void>;
  touchAuditKey(keyId: string, usedAt: string): Promise<void>;
  listAuditEvents(box: TreasuryBoxRef): Promise<BoxAuditEvent[]>;
  putAuditEvent(event: BoxAuditEvent): Promise<void>;
}
