import { blobAgentCredentialStore } from '../server/blobAgentCredentialStore.js';
import { blobAuthStore } from '../server/blobAuthStore.js';
import { authConfigForRequest } from '../server/authConfig.js';
import { AuthServiceError, requirePrivateWorkspaceSession } from '../server/authService.js';
import {
  AgentCredentialServiceError,
  authenticateAgentCredential,
  requireAgentAccess,
} from '../server/agentCredentialService.js';
import { configuredDeploymentNetwork } from '../server/deploymentNetworkPolicy.js';
import { noStoreJson } from '../server/httpResponse.js';
import { discoverSaintSignerResources, SaintConsumerError } from '../server/saintSignerDiscovery.js';

export async function GET(request: Request): Promise<Response> {
  try {
    const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '');
    let address: string;
    let network: string;
    if (match) {
      const credential = await authenticateAgentCredential(blobAgentCredentialStore, match[1].trim());
      requireAgentAccess(credential, 'read');
      address = credential.principal.address;
      network = credential.principal.network;
      await blobAgentCredentialStore.touchCredential(credential.credentialId, new Date().toISOString());
    } else {
      const session = await requirePrivateWorkspaceSession(
        blobAuthStore,
        request,
        authConfigForRequest(request),
        'Confirm the signer wallet before exploring SAINT relationships.',
      );
      address = session.address;
      network = session.network;
    }

    // This first consumer is explicitly Testnet-only. No Mainnet fallback.
    const base = process.env.SAINT_TESTNET_CONSUMER_URL?.trim();
    if (network !== 'testnet' || configuredDeploymentNetwork() !== 'testnet' || !base) {
      return noStoreJson({ error: 'SAINT discovery is not enabled for this network.', code: 'saint_not_configured' }, 503);
    }
    return noStoreJson(await discoverSaintSignerResources(address, base));
  } catch (cause) {
    if (cause instanceof AuthServiceError || cause instanceof AgentCredentialServiceError) {
      return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
    }
    if (cause instanceof SaintConsumerError) {
      return noStoreJson({ error: 'SAINT relationship data is temporarily unavailable.', code: cause.code }, 503);
    }
    console.error('SAINT signer discovery API error', cause instanceof Error ? cause.name : 'unknown');
    return noStoreJson({ error: 'SAINT relationship data is temporarily unavailable.', code: 'saint_unavailable' }, 503);
  }
}
