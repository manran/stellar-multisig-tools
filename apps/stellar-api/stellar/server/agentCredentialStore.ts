import type {
  AgentAccessLevel,
  SignerPrincipalRef,
} from '../../../../packages/stellar-core/src/agentAccessTypes.js';

export interface StoredSignerAgentCredential {
  version: 1;
  credentialId: string;
  principal: SignerPrincipalRef;
  label: string;
  access: AgentAccessLevel;
  prefix: string;
  secretHash: string;
  createdAt: string;
  createdBy: string;
  lastUsedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
}

export interface StoredAgentIdempotencyClaim {
  version: 1;
  credentialId: string;
  operation?: 'proposal.create' | 'intent.create';
  /** Reserved durable resource id; legacy field name retained for stored-claim compatibility. */
  requestId: string;
  principal: SignerPrincipalRef;
  idempotencyHash: string;
  payloadHash: string;
  externalReference?: string;
  createdAt: string;
}

export interface AgentCredentialStore {
  listCredentials(principal: SignerPrincipalRef): Promise<StoredSignerAgentCredential[]>;
  getCredential(credentialId: string): Promise<StoredSignerAgentCredential | null>;
  putCredential(credential: StoredSignerAgentCredential): Promise<void>;
  touchCredential(credentialId: string, usedAt: string): Promise<void>;
  claimIdempotency(claim: StoredAgentIdempotencyClaim): Promise<{ claimed: boolean; claim: StoredAgentIdempotencyClaim }>;
  releaseIdempotency(claim: StoredAgentIdempotencyClaim): Promise<void>;
}
