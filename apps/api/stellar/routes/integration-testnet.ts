import { blobIntegrationCredentialStore } from '../server/blobIntegrationCredentialStore.js';
import {
  configuredDeploymentNetwork,
  DeploymentNetworkPolicyError,
} from '../server/deploymentNetworkPolicy.js';
import { noStoreJson } from '../server/httpResponse.js';
import {
  IntegrationAdminServiceError,
} from '../server/integrationAdminService.js';
import {
  RequestBodyError,
  readJsonObjectBody,
} from '../server/requestBody.js';
import { RequestStorageUnavailableError } from '../server/blobRequestStore.js';
import { createTestnetIntegration } from '../server/testnetIntegrationService.js';

const MAX_BODY_BYTES = 64 * 1024;

function errorResponse(cause: unknown): Response {
  if (
    cause instanceof IntegrationAdminServiceError
    || cause instanceof RequestBodyError
    || cause instanceof DeploymentNetworkPolicyError
  ) {
    return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
  }
  if (cause instanceof RequestStorageUnavailableError) {
    return noStoreJson({ error: cause.message, code: 'integration_self_service_storage_unavailable' }, 503);
  }
  console.error('Testnet Integration self-service failed', cause);
  return noStoreJson({ error: 'Testnet Integration self-service failed.', code: 'integration_self_service_failed' }, 500);
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (configuredDeploymentNetwork() !== 'testnet') {
      throw new DeploymentNetworkPolicyError(
        'Testnet Integration self-service is available only on the fixed Testnet deployment.',
        409,
        'testnet_integration_self_service_unavailable',
      );
    }
    const body = await readJsonObjectBody(request, MAX_BODY_BYTES);
    const result = await createTestnetIntegration(blobIntegrationCredentialStore, body);
    return noStoreJson({ operation: 'integration.testnet.create', version: 1, ...result }, 201);
  } catch (cause) {
    return errorResponse(cause);
  }
}
