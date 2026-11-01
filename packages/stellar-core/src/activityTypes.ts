import type { MachineCallerProvenance } from './coordinationActorTypes.js';
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

export type ActivityCoordinationEventType =
  | 'signer_requested'
  | 'proposal_viewed'
  | 'notification_accepted'
  | 'notification_delivered'
  | 'notification_bounced'
  | 'notification_failed';

export type ActivityNotificationKind = 'signature_requested' | 'signature_reminder';

interface ActivityEventBase {
  version: 1;
  eventId: string;
  requestId: string;
  occurredAt: string;
  /** Cryptographic Stellar signer identity when one is known. */
  actorAddress?: string;
  /** Actual delegated Agent or Integration service that performed the API action, when applicable. */
  actor?: MachineCallerProvenance;
  detail?: string;
  ledger?: number;
}

/** Read compatibility for Activity rows written before facts/projections were separated. */
export interface ActivityEvent extends ActivityEventBase {
  type: ActivityEventType;
}

/** Durable transaction/authorization fact exposed by Activity and accepted for new Activity writes. */
export interface ActivityFactEvent extends ActivityEventBase {
  type: ActivityFactType;
}

/**
 * Human coordination fact projected from existing Assignment / notification records.
 * These events are Activity-only context, not transaction receipt or portable evidence.
 */
export interface ActivityCoordinationEvent extends ActivityEventBase {
  type: ActivityCoordinationEventType;
  subjectAddress: string;
  notificationKind?: ActivityNotificationKind;
}

export type ActivityTimelineEvent = ActivityFactEvent | ActivityCoordinationEvent;

export interface ActivityRequestItem {
  requestId: string;
  network: StellarNetwork;
  transactionHash: string;
  baseXdr: string;
  createdAt: string;
  expiresAt: string;
  accountIds: string[];
  events: ActivityFactEvent[];
  coordinationEvents?: ActivityCoordinationEvent[];
}

export interface ActivityResponse {
  address: string;
  network: StellarNetwork;
  accountId?: string;
  items: ActivityRequestItem[];
  item?: ActivityRequestItem;
  nextCursor?: string;
}
