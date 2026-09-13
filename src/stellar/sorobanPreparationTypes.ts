import type { SorobanGAccountAuthorizerStatus } from './sorobanAuthorization.js';
import type { SigningRequestSnapshot } from './requestTypes.js';
import type { StellarNetwork } from './types.js';

export type SorobanPreparationStatus =
  | 'awaiting_authorization'
  | 'ready_to_freeze'
  | 'frozen'
  | 'expired'
  | 'blocked';

export type SorobanPreparationViewerAction = 'authorize' | 'freeze' | 'waiting';

export interface SorobanPreparationSnapshot {
  id: string;
  network: StellarNetwork;
  preparedXdr: string;
  createdAt: string;
  expiresAt: string;
  transactionSourceAccount: string;
  transactionSignerKeys: string[];
  contributionCount: number;
  status: SorobanPreparationStatus;
  authorizers: SorobanGAccountAuthorizerStatus[];
  statusDetail?: string;
  proposalId?: string;
}

export interface InboxSorobanPreparationSnapshot extends SorobanPreparationSnapshot {
  viewerAction: SorobanPreparationViewerAction;
}

export interface SorobanPreparationAccess {
  shareable: boolean;
  viewerAction?: SorobanPreparationViewerAction;
}

export interface SorobanPreparationResponse {
  preparation: SorobanPreparationSnapshot;
  capability?: string;
  access?: SorobanPreparationAccess;
}

export interface SorobanPreparationContributionResponse {
  preparation: SorobanPreparationSnapshot;
  added: boolean;
  access?: SorobanPreparationAccess;
}

export interface FreezeSorobanPreparationResponse {
  proposal: SigningRequestSnapshot;
  capability?: string;
}

export interface SorobanPreparationApiError {
  error: string;
  code: string;
}
