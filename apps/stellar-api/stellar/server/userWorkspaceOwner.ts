import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';
import { fixedStellarDeploymentNetwork } from '../../../../packages/stellar-core/src/deploymentNetwork.js';
import { configuredDeploymentNetwork, assertDeploymentNetwork } from './deploymentNetworkPolicy.js';
import { authConfigForRequest } from './authConfig.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class UserWorkspaceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'UserWorkspaceError';
  }
}

export function userWorkspaceOwner(network: StellarNetwork, userId: string): string {
  if (!UUID.test(userId) || (network !== 'testnet' && network !== 'public')) {
    throw new UserWorkspaceError('Invalid user workspace.', 400, 'invalid_workspace');
  }
  return `user:${network}:${userId.toLowerCase()}`;
}

export function isUserWorkspaceOwner(value: string): boolean {
  const match = /^user:(testnet|public):(.+)$/.exec(value);
  return Boolean(match && UUID.test(match[2]));
}

export function requestedUserNetwork(request: Request, body?: Record<string, unknown>): StellarNetwork {
  const url = new URL(request.url);
  const query = url.searchParams.get('network');
  const provided = query ?? body?.network;
  const fixed = fixedStellarDeploymentNetwork(configuredDeploymentNetwork());
  const value = provided ?? fixed;
  if (query !== null && body?.network !== undefined && query !== body.network) {
    throw new UserWorkspaceError('Network mismatch.', 400, 'workspace_network_mismatch');
  }
  if (value !== 'testnet' && value !== 'public') {
    throw new UserWorkspaceError('Choose a Stellar network.', 400, 'workspace_network_required');
  }
  assertDeploymentNetwork(value);
  return value;
}

export function assertUserWorkspaceWriteOrigin(request: Request): void {
  // Machine credentials are explicit bearer capabilities, not browser cookies.
  if (/^Bearer\\s+/i.test(request.headers.get('authorization') ?? '')) return;
  const origin = request.headers.get('origin');
  const host = authConfigForRequest(request).issuer.replace(/\/api\/auth$/, '');
  const fetchSite = request.headers.get('sec-fetch-site');
  if ((origin && origin !== host) || (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none')) {
    throw new UserWorkspaceError('This action must come from the MST website.', 403, 'workspace_origin_invalid');
  }
}
