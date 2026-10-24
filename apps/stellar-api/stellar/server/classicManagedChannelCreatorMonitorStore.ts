import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';
import type { ClassicManagedChannelCreatorState } from './classicManagedChannelCapacity.js';

export interface StoredClassicManagedChannelCreatorMonitor {
  network: StellarNetwork;
  state: ClassicManagedChannelCreatorState;
  nativeBalanceStroops: bigint;
  observedAt: string;
  alertedAt?: string;
}

export interface ClassicManagedChannelCreatorMonitorStore {
  get(network: StellarNetwork): Promise<StoredClassicManagedChannelCreatorMonitor | null>;
  observe(
    record: StoredClassicManagedChannelCreatorMonitor,
  ): Promise<{ previousState: ClassicManagedChannelCreatorState | null; changed: boolean }>;
  claimAlert(network: StellarNetwork, state: ClassicManagedChannelCreatorState, claimedAt: string): Promise<boolean>;
  releaseAlertClaim(network: StellarNetwork, state: ClassicManagedChannelCreatorState, claimedAt: string): Promise<void>;
}
