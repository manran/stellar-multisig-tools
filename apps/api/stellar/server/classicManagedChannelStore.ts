import type { StellarNetwork } from '../../../../src/stellar/types.js';

export interface StoredClassicManagedChannelLease {
  network: StellarNetwork;
  channelAccount: string;
  channelIndex?: number;
  requestId: string;
  leasedAt: string;
  expiresAt: string;
}

export interface ClassicManagedChannelLeaseStore {
  getLeaseForRequest(requestId: string): Promise<StoredClassicManagedChannelLease | null>;
  claimLease(record: StoredClassicManagedChannelLease): Promise<boolean>;
  releaseRequest(requestId: string): Promise<void>;
  listLeases(network: StellarNetwork): Promise<StoredClassicManagedChannelLease[]>;
}
