import type { StellarNetwork } from '../../../../src/stellar/types.js';
import { privateSessionAddressFromRequest } from '../../../../src/stellar/privateSessionTransport.js';
import { authConfigForRequest } from './authConfig.js';
import { AuthServiceError, privateWorkspaceSessionFromRequest, type AuthSession } from './authService.js';
import type { AuthStore } from './authStore.js';
import {
  AgentCredentialServiceError,
  authenticateAgentCredential,
  looksLikeAgentCredential,
} from './agentCredentialService.js';
import type { AgentCredentialStore, StoredSignerAgentCredential } from './agentCredentialStore.js';
import { blobIntegrationCredentialStore } from './blobIntegrationCredentialStore.js';
import { resolveRuntimeIntegrationCredential } from './integrationCredentialRegistry.js';
import type { IntegrationCredentialStore } from './integrationCredentialStore.js';
import {
  authenticateIntegrationCredentialWithResolver,
  looksLikeIntegrationCredential,
  type ConfiguredIntegrationCredential,
} from './integrationCredentialService.js';

export type MachineCaller =
  | { kind: 'agent'; credential: StoredSignerAgentCredential }
  | { kind: 'service'; credential: ConfiguredIntegrationCredential };

export class CallerAuthenticationError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'CallerAuthenticationError';
  }
}

function bearerTokenFromRequest(request: Request): string | null {
  const authorization = request.headers.get('authorization')?.trim() ?? '';
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) throw new CallerAuthenticationError('Invalid authorization header.', 401, 'invalid_credential');
  return match[1].trim();
}

function looksLikeHumanSessionToken(value: string): boolean {
  return value.split('.').length === 3;
}

export async function machineCallerFromRequest(
  agentStore: AgentCredentialStore,
  request: Request,
  integrationStore: IntegrationCredentialStore = blobIntegrationCredentialStore,
): Promise<MachineCaller | null> {
  const value = bearerTokenFromRequest(request);
  if (!value) return null;
  if (looksLikeIntegrationCredential(value)) {
    return { kind: 'service', credential: await authenticateIntegrationCredentialWithResolver(
      value,
      (serviceId) => resolveRuntimeIntegrationCredential(integrationStore, serviceId),
    ) };
  }
  if (looksLikeAgentCredential(value)) {
    return { kind: 'agent', credential: await authenticateAgentCredential(agentStore, value) };
  }
  if (looksLikeHumanSessionToken(value)) return null;
  throw new AgentCredentialServiceError('Invalid Agent credential.', 401, 'invalid_agent_credential');
}

export async function verifiedSignerSessionFromRequest(
  authStore: AuthStore,
  request: Request,
  network: StellarNetwork,
): Promise<AuthSession | null> {
  const selectedAddress = privateSessionAddressFromRequest(request);
  if (!selectedAddress) return null;
  try {
    const session = await privateWorkspaceSessionFromRequest(
      authStore,
      request,
      authConfigForRequest(request),
    );
    return session && session.network === network && session.address === selectedAddress ? session : null;
  } catch (cause) {
    if (cause instanceof AuthServiceError) return null;
    throw cause;
  }
}
