import type { StellarNetwork } from '../../../../src/stellar/types.js';
import { blobAgentCredentialStore } from '../server/blobAgentCredentialStore.js';
import {
  CallerAuthenticationError,
  machineCallerFromRequest,
} from '../server/callerAuthentication.js';
import {
  ClassicManagedChannelConfigurationError,
  configuredClassicManagedChannels,
} from '../server/classicManagedChannelConfig.js';
import {
  AgentCredentialServiceError,
} from '../server/agentCredentialService.js';
import {
  IntegrationCredentialServiceError,
} from '../server/integrationCredentialService.js';
import {
  assertDeploymentNetwork,
  DeploymentNetworkPolicyError,
} from '../server/deploymentNetworkPolicy.js';
import { noStoreJson } from '../server/httpResponse.js';

function errorResponse(cause: unknown): Response {
  if (
    cause instanceof CallerAuthenticationError
    || cause instanceof AgentCredentialServiceError
    || cause instanceof IntegrationCredentialServiceError
    || cause instanceof ClassicManagedChannelConfigurationError
    || cause instanceof DeploymentNetworkPolicyError
  ) {
    return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
  }
  console.error('Integration execution inspection failed', cause);
  return noStoreJson({
    error: 'Integration execution inspection failed.',
    code: 'integration_execution_inspect_failed',
  }, 500);
}

export async function GET(request: Request): Promise<Response> {
  try {
    const caller = await machineCallerFromRequest(blobAgentCredentialStore, request);
    if (!caller || caller.kind !== 'service') {
      throw new CallerAuthenticationError(
        'Integration Service credential is required.',
        401,
        'integration_credential_required',
      );
    }

    const rawNetwork = new URL(request.url).searchParams.get('network');
    if (rawNetwork !== 'testnet' && rawNetwork !== 'public') {
      throw new IntegrationCredentialServiceError(
        'A valid Stellar network is required.',
        400,
        'invalid_integration_execution_network',
      );
    }
    const network = rawNetwork as StellarNetwork;
    assertDeploymentNetwork(network);
    if (!caller.credential.networks.includes(network)) {
      throw new IntegrationCredentialServiceError(
        'This Integration credential is not allowed on this Stellar network.',
        403,
        'integration_network_not_allowed',
      );
    }

    const channels = configuredClassicManagedChannels(network);
    const externalSources = new Set(caller.credential.classicExternalExecutionSourceAccounts);
    const managedSourceAccountCount = caller.credential.classicSourceAccounts
      .filter((accountId) => !externalSources.has(accountId)).length;
    return noStoreJson({
      operation: 'integration.execution.inspect',
      version: 1,
      serviceId: caller.credential.serviceId,
      network,
      classic: {
        scopeConfigured: caller.credential.classicSourceAccounts.length > 0,
        managedAvailable: managedSourceAccountCount > 0 && channels.length > 0,
        managedSourceAccountCount,
        externalSourceAccountCount: externalSources.size,
        channelCount: channels.length,
        channelAccounts: channels.map((channel) => channel.publicKey()),
      },
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}
