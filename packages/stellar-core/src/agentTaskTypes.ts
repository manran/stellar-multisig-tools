import type { AgentAccessLevel } from './agentAccessTypes.js';
import type { StellarNetwork } from './types.js';

export type AgentTaskState =
  | 'action_required'
  | 'waiting'
  | 'completed'
  | 'expired'
  | 'failed'
  | 'cancelled';

export type AgentTaskActionCode =
  | 'contribute_signature'
  | 'contribute_authorization'
  | 'decline'
  | 'prepare_execution'
  | 'refresh_execution'
  | 'replan'
  | 'cancel';

export interface AgentTaskAction {
  code: AgentTaskActionCode;
  requiredAccess: Exclude<AgentAccessLevel, 'read'>;
  available: boolean;
}

export interface AgentTaskProjection {
  version: 1;
  id: string;
  kind: 'classic_transaction' | 'soroban_contract';
  network: StellarNetwork;
  state: AgentTaskState;
  nextActions: AgentTaskAction[];
  waitingFor?: string[];
  expiresAt?: string;
  expiresAtLedger?: number;
  result?: {
    transactionHash: string;
    ledger: number;
    successful: boolean;
  };
}