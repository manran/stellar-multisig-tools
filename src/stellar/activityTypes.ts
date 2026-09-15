import type { RequestActorProvenance } from './integrationTypes.js';
import type { StellarNetwork } from './types.js';

export type ActivityFactType =
  | 'request_created'
  | 'private_note_added'
  | 'private_note_revised'
  | 'private_commitment_created'
  | 'approval_added'
  | 'approval_declined'
  | 'transaction_submitted'
  | 'transaction_confirmed';

export type LegacyActivityProjectionType =
  | 'approvals_ready'
  | 'request_expired'
  | 'request_stale'
  | 'request_blocked';

export type ActivityEventType = ActivityFactType | LegacyActivityProjectionType;

interface ActivityEventBase {
  version: 1;
  eventId: string;
  requestId: string;
  occurredAt: string;
  /** Cryptographic Stellar signer identity when one is known. */
  actorAddress?: string;
  /** Actual delegated Agent or Integration service that performed the API action, when applicable. */
  actor?: RequestActorProvenance;
  detail?: string;
  ledger?: number;
}

/** Read compatibility for Activity rows written before facts/projections were separated. */
export interface ActivityEvent extends ActivityEventBase {
  type: ActivityEventType;
}

/** Durable audit fact exposed by Activity and accepted for new Activity writes. */
export interface ActivityFactEvent extends ActivityEventBase {
  type: ActivityFactType;
}

export interface ActivityRequestItem {
  requestId: string;
  network: StellarNetwork;
  transactionHash: string;
  baseXdr: string;
  createdAt: string;
  expiresAt: string;
  accountIds: string[];
  events: ActivityFactEvent[];
}

export interface ActivityResponse {
  address: string;
  network: StellarNetwork;
  accountId?: string;
  items: ActivityRequestItem[];
  item?: ActivityRequestItem;
  nextCursor?: string;
}
