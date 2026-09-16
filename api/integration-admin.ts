import { blobIntegrationCredentialStore } from '../server/blobIntegrationCredentialStore.js';
import {
  authenticateIntegrationAdminSecret,
  createIntegrationAdminService,
  IntegrationAdminServiceError,
  listIntegrationAdminServices,
  rotateIntegrationAdminCredential,
  updateIntegrationAdminService,
} from '../server/integrationAdminService.js';
import { RequestBodyError, readJsonObjectBody } from '../server/requestBody.js';
import { noStoreJson } from '../server/httpResponse.js';
import { RequestStorageUnavailableError } from '../server/blobRequestStore.js';

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
  if (cause instanceof IntegrationAdminServiceError || cause instanceof RequestBodyError) {
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
    if (body.action !== undefined) {
      throw new IntegrationAdminServiceError('Unsupported Integration administration action.', 400, 'invalid_integration_admin_action');
    }
    return noStoreJson({ service: await updateIntegrationAdminService(blobIntegrationCredentialStore, serviceId, body) });
  } catch (cause) { return errorResponse(cause); }
}
