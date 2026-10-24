import type { ActivityRequestItem } from './activityTypes.js';
import type { SorobanIntentEvidenceEvent } from './sorobanIntentApiTypes.js';
import type { StellarNetwork } from './types.js';

export interface RequestWorkActivityItem {
  kind: 'request';
  workId: string;
  activityAt: string;
  request: ActivityRequestItem;
}

export interface SorobanIntentWorkActivityItem {
  kind: 'soroban_intent';
  workId: string;
  activityAt: string;
  intentId: string;
  network: StellarNetwork;
  createdAt: string;
  intentDigest: string;
  evidence: SorobanIntentEvidenceEvent[];
}

export type WorkActivityItem = RequestWorkActivityItem | SorobanIntentWorkActivityItem;

export interface WorkActivityResponse {
  address: string;
  network: StellarNetwork;
  actor: 'human' | 'agent';
  workItems: WorkActivityItem[];
  nextCursor?: string;
}
