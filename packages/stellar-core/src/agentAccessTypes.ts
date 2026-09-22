import type { StellarNetwork } from './types.js';

export const MAX_ACTIVE_SIGNER_AGENT_CREDENTIALS = 10;

export type AgentAccessLevel = 'read' | 'write' | 'sign';

export interface SignerPrincipalRef {
  type: 'signer';
  network: StellarNetwork;
  address: string;
}

export interface SignerAgentCredentialSummary {
  credentialId: string;
  label: string;
  prefix: string;
  principal: SignerPrincipalRef;
  access: AgentAccessLevel;
  createdAt: string;
  createdBy: string;
  lastUsedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
}

export interface AgentActorProvenance {
  type: 'agent';
  id: string;
  label?: string;
  principalAddress: string;
}
