import { blobAgentCredentialStore } from '../server/blobAgentCredentialStore.js';
import { blobAuthStore } from '../server/blobAuthStore.js';
import { AuthServiceError } from '../server/authService.js';
import { CallerAuthenticationError, signerWorkspaceCallerFromRequest } from '../server/callerAuthentication.js';
import {
  AgentCredentialServiceError,
} from '../server/agentCredentialService.js';
import { configuredDeploymentNetwork, DeploymentNetworkPolicyError } from '../server/deploymentNetworkPolicy.js';
import { noStoreJson } from '../server/httpResponse.js';
import { discoverSaintSignerResources, SaintConsumerError } from '../server/saintSignerDiscovery.js';

export async function GET(request: Request): Promise<Response> {
  try {
    const { address, network } = await signerWorkspaceCallerFromRequest(
      blobAgentCredentialStore, blobAuthStore, request, 'read',
      'Confirm the signer wallet before exploring SAINT relationships.',
    );

    // This first consumer is explicitly Testnet-only. No Mainnet fallback.
    const base = process.env.SAINT_TESTNET_CONSUMER_URL?.trim();
    if (network !== 'testnet' || configuredDeploymentNetwork() !== 'testnet' || !base) {
      return noStoreJson({ error: 'SAINT discovery is not enabled for this network.', code: 'saint_not_configured' }, 503);
    }
    return noStoreJson(await discoverSaintSignerResources(address, base));
  } catch (cause) {
    if (cause instanceof AuthServiceError || cause instanceof AgentCredentialServiceError || cause instanceof CallerAuthenticationError || cause instanceof DeploymentNetworkPolicyError) {
      return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
    }
    if (cause instanceof SaintConsumerError) {
      return noStoreJson({ error: 'SAINT relationship data is temporarily unavailable.', code: cause.code }, 503);
    }
    console.error('SAINT signer discovery API error', cause instanceof Error ? cause.name : 'unknown');
    return noStoreJson({ error: 'SAINT relationship data is temporarily unavailable.', code: 'saint_unavailable' }, 503);
  }
}
