import type { StellarNetwork } from '../../../../src/stellar/types.js';
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
  markAlerted(network: StellarNetwork, state: ClassicManagedChannelCreatorState, alertedAt: string): Promise<void>;
}
