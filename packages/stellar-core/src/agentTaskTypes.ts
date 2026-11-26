import type { AgentAccessLevel } from './agentAccessTypes.js';
import type { StellarNetwork } from './types.js';
import type { ClassicExecutionEvidence } from './requestTypes.js';

export type AgentTaskState =
  | 'action_required'
  | 'waiting'
  | 'completed'
  | 'execution_unknown'
  | 'expired'
  | 'failed'
  | 'cancelled';

export type AgentTaskActionCode =
  | 'contribute_signature'
  | 'contribute_authorization'
  | 'decline'
  | 'prepare_execution'
  | 'refresh_execution'
  | 'resume_execution'
  | 'reconcile_execution'
  | 'replan'
  | 'cancel';

export interface AgentTaskAction {
  code: AgentTaskActionCode;
  operationId: string;
  bodyDefaults?: Record<string, string>;
  requiredInputs?: string[];
  requiredAccess: Exclude<AgentAccessLevel, 'read'>;
  available: boolean;
  /** Review the resolved prior attempt before continuing this same Intent. Not a new authorization grant. */
  reviewRequired?: true;
}

export interface AgentTaskProjection {
  version: 1;
  id: string;
  kind: 'classic_transaction' | 'soroban_contract';
  network: StellarNetwork;
  /** Work the current credential can act on; read-only pending work is waiting. */
  state: AgentTaskState;
  /** The represented signer has not yet authorized this pending work, irrespective of Agent scope. */
  signatureRequired: boolean;
  nextActions: AgentTaskAction[];
  waitingFor?: string[];
  unresolvedTransactionHashes?: string[];
  expiresAt?: string;
  expiresAtLedger?: number;
  /** External Classic payment evidence, separate from the signer task state. */
  executionOutcome?: ClassicExecutionEvidence;
  result?: {
    transactionHash: string;
    ledger: number;
    successful: boolean;
  };
}