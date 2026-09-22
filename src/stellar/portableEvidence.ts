import type { ActivityFactType, ActivityRequestItem } from '../../packages/stellar-core/src/activityTypes';
import type { SigningRequestSnapshot } from '../../packages/stellar-core/src/requestTypes';
import type { SourceAnalysis } from '../../packages/stellar-core/src/transactionReviewAnalysis';
import type { TransactionXdrInspection } from '../../packages/stellar-core/src/transactionXdr';

export type PortableEvidenceSignerRole = 'account_key' | 'signer';
export type PortableEvidenceDecision = 'signed' | 'declined' | 'none';

export interface PortableEvidenceSigner {
  address: string;
  role: PortableEvidenceSignerRole;
  weight: number;
  decision: PortableEvidenceDecision;
}

export interface PortableEvidenceAccount {
  address: string;
  signers: PortableEvidenceSigner[];
}

export interface PortableEvidenceHistoryEvent {
  eventId: string;
  type: ActivityFactType;
  occurredAt: string;
  actorAddress?: string;
  ledger?: number;
}

export interface PortableEvidenceRecord {
  requestId: string;
  network: SigningRequestSnapshot['network'];
  transactionHash: string;
  createdAt: string;
  expiresAt: string;
  signatureCount: number;
  submission: SigningRequestSnapshot['submission'];
  transactionSourceAddress: string;
  accounts: PortableEvidenceAccount[];
  history: PortableEvidenceHistoryEvent[];
}

const PORTABLE_HISTORY_TYPES = new Set<ActivityFactType>([
  'request_created',
  'approval_added',
  'approval_declined',
  'transaction_submitted',
  'transaction_confirmed',
]);

export function buildPortableEvidenceRecord({
  snapshot,
  activity,
  inspection,
  sourceAnalyses,
}: {
  snapshot: SigningRequestSnapshot;
  activity: ActivityRequestItem;
  inspection: TransactionXdrInspection;
  sourceAnalyses: SourceAnalysis[];
}): PortableEvidenceRecord {
  const signedActors = new Set(
    activity.events
      .filter((event) => event.type === 'approval_added' && event.actorAddress)
      .map((event) => event.actorAddress!),
  );
  const declinedActors = new Set(
    activity.events
      .filter((event) => event.type === 'approval_declined' && event.actorAddress)
      .map((event) => event.actorAddress!),
  );

  const accounts = sourceAnalyses.flatMap((analysis) => {
    const account = analysis.account;
    if (!account) return [];
    return [{
      address: account.accountId,
      signers: account.signers
        .filter((signer) => signer.type === 'ed25519_public_key' && signer.weight > 0)
        .map((signer) => ({
          address: signer.key,
          role: signer.key === account.accountId ? 'account_key' as const : 'signer' as const,
          weight: signer.weight,
          decision: signedActors.has(signer.key)
            ? 'signed' as const
            : declinedActors.has(signer.key)
              ? 'declined' as const
              : 'none' as const,
        })),
    }];
  });

  return {
    requestId: snapshot.id,
    network: snapshot.network,
    transactionHash: snapshot.transactionHash,
    createdAt: snapshot.createdAt,
    expiresAt: snapshot.expiresAt,
    signatureCount: snapshot.signatureCount,
    submission: snapshot.submission,
    transactionSourceAddress: inspection.transactionSourceAccount,
    accounts,
    history: activity.events
      .filter((event) => PORTABLE_HISTORY_TYPES.has(event.type))
      .map((event) => ({
        eventId: event.eventId,
        type: event.type,
        occurredAt: event.occurredAt,
        actorAddress: event.actorAddress,
        ledger: event.ledger,
      })),
  };
}
