import { blobIntegrationCredentialStore } from '../server/blobIntegrationCredentialStore.js';
import {
  authenticateIntegrationAdminSecret,
  configureIntegrationAdminWebhook,
  createIntegrationAdminService,
  IntegrationAdminServiceError,
  listIntegrationAdminServices,
  rotateIntegrationAdminCredential,
  rotateIntegrationAdminWebhookSecret,
  updateIntegrationAdminService,
} from '../server/integrationAdminService.js';
import { RequestBodyError, readJsonObjectBody } from '../server/requestBody.js';
import { noStoreJson } from '../server/httpResponse.js';
import { RequestStorageUnavailableError } from '../server/blobRequestStore.js';
import {
  ClassicManagedChannelConfigurationError,
  configuredClassicManagedChannels,
  MAX_CHANNELS_PER_NETWORK,
} from '../server/classicManagedChannelConfig.js';
import { inspectManagedClassicChannels } from '../server/classicManagedChannelStatus.js';
import {
  ClassicManagedExecutionStorageUnavailableError,
  runtimeClassicManagedChannelStore,
} from '../server/coordinationStores.js';
import {
  assertDeploymentNetwork,
  DeploymentNetworkPolicyError,
} from '../server/deploymentNetworkPolicy.js';
import type { StellarNetwork } from '../../../../src/stellar/types.js';

const MAX_BODY_BYTES = 64 * 1024;

function bearer(request: Request): string {
  const value = request.headers.get('authorization')?.trim() ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(value);
  if (!match) throw new IntegrationAdminServiceError('Integration administrator credential is required.', 401, 'integration_admin_credential_required');
  return match[1].trim();
}

function authorize(request: Request): void {
  authenticateIntegrationAdminSecret(bearer(request));
}

function errorResponse(cause: unknown): Response {
  if (
    cause instanceof IntegrationAdminServiceError
    || cause instanceof RequestBodyError
    || cause instanceof ClassicManagedChannelConfigurationError
    || cause instanceof DeploymentNetworkPolicyError
  ) {
    return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
  }
  if (cause instanceof RequestStorageUnavailableError) {
    return noStoreJson({ error: cause.message, code: 'integration_admin_storage_unavailable' }, 503);
  }
  console.error('Integration administration failed', cause);
  return noStoreJson({ error: 'Integration administration failed.', code: 'integration_admin_failed' }, 500);
}

export async function GET(request: Request): Promise<Response> {
  try {
    authorize(request);
    const url = new URL(request.url);
    if (url.searchParams.get('view') === 'managed_classic_execution') {
      const rawNetwork = url.searchParams.get('network');
      if (rawNetwork !== 'testnet' && rawNetwork !== 'public') {
        throw new IntegrationAdminServiceError(
          'A valid Stellar network is required for managed Classic execution status.',
          400,
          'invalid_managed_classic_network',
        );
      }
      const network = rawNetwork as StellarNetwork;
      assertDeploymentNetwork(network);
      const channels = configuredClassicManagedChannels(network);
      const channelAccounts = channels.map((channel) => channel.publicKey());
      const basic = {
        network,
        configured: channels.length > 0,
        channelAccounts,
      };
      if (url.searchParams.get('details') !== 'channels') {
        return noStoreJson({ managedClassicExecution: basic });
      }
      let leaseStore: ReturnType<typeof runtimeClassicManagedChannelStore> | undefined;
      try {
        leaseStore = runtimeClassicManagedChannelStore();
      } catch (cause) {
        if (!(cause instanceof ClassicManagedExecutionStorageUnavailableError)) throw cause;
      }
      return noStoreJson({
        managedClassicExecution: {
          ...basic,
          operationalStatus: await inspectManagedClassicChannels({
            network,
            channelAccounts,
            elasticLimit: network === 'testnet' ? MAX_CHANNELS_PER_NETWORK : channelAccounts.length,
            ...(leaseStore ? { leaseStore } : {}),
          }),
        },
      });
    }
    return noStoreJson({ services: await listIntegrationAdminServices(blobIntegrationCredentialStore) });
  } catch (cause) { return errorResponse(cause); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    authorize(request);
    const body = await readJsonObjectBody(request, MAX_BODY_BYTES);
    const result = await createIntegrationAdminService(blobIntegrationCredentialStore, body);
    return noStoreJson(result, 201);
  } catch (cause) { return errorResponse(cause); }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    authorize(request);
    const body = await readJsonObjectBody(request, MAX_BODY_BYTES);
    const serviceId = typeof body.serviceId === 'string' ? body.serviceId : '';
    if (body.action === 'rotate') {
      return noStoreJson(await rotateIntegrationAdminCredential(blobIntegrationCredentialStore, serviceId));
    }
    if (body.action === 'configure_webhook') {
      return noStoreJson(await configureIntegrationAdminWebhook(
        blobIntegrationCredentialStore,
        serviceId,
        body.webhook,
      ));
    }
    if (body.action === 'rotate_webhook_secret') {
      return noStoreJson(await rotateIntegrationAdminWebhookSecret(
        blobIntegrationCredentialStore,
        serviceId,
      ));
    }
    if (body.action !== undefined) {
      throw new IntegrationAdminServiceError('Unsupported Integration administration action.', 400, 'invalid_integration_admin_action');
    }
    return noStoreJson({ service: await updateIntegrationAdminService(blobIntegrationCredentialStore, serviceId, body) });
  } catch (cause) { return errorResponse(cause); }
}
