import { blobAuthStore } from '../server/blobAuthStore.js';
import { authConfigForRequest } from '../server/authConfig.js';
import { AuthServiceError, requirePrivateWorkspaceSession } from '../server/authService.js';
import { assertDeploymentNetwork, DeploymentNetworkPolicyError } from '../server/deploymentNetworkPolicy.js';
import { noStoreJson } from '../server/httpResponse.js';
import { readJsonObjectBody, RequestBodyError } from '../server/requestBody.js';
import {
  ReusableTemplateServiceError,
  createReusableTemplate,
  listReusableTemplates,
} from '../server/reusableTemplateService.js';
import {
  ReusableTemplateStorageUnavailableError,
  runtimeReusableTemplateStore,
} from '../server/coordinationStores.js';

const MAX_BODY_BYTES = 32 * 1024;

function errorResponse(cause: unknown): Response {
  if (
    cause instanceof RequestBodyError
    || cause instanceof AuthServiceError
    || cause instanceof DeploymentNetworkPolicyError
    || cause instanceof ReusableTemplateServiceError
    || cause instanceof ReusableTemplateStorageUnavailableError
  ) {
    return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
  }
  console.error('Reusable template API error', cause);
  return noStoreJson({ error: 'Templates are temporarily unavailable.', code: 'internal_error' }, 500);
}

async function ownerAddress(request: Request): Promise<string> {
  const session = await requirePrivateWorkspaceSession(
    blobAuthStore,
    request,
    authConfigForRequest(request),
    'Sign in to use your templates.',
  );
  return session.address;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const network = url.searchParams.get('network');
    if (network !== 'public' && network !== 'testnet') {
      throw new ReusableTemplateServiceError('Network must be public or testnet.', 400, 'invalid_network');
    }
    assertDeploymentNetwork(network);
    const owner = await ownerAddress(request);
    const templates = await listReusableTemplates(runtimeReusableTemplateStore(), owner, network);
    return noStoreJson({ address: owner, templates });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const ownerPromise = ownerAddress(request);
    const bodyPromise = readJsonObjectBody(request, MAX_BODY_BYTES);
    const [owner, body] = await Promise.all([ownerPromise, bodyPromise]);
    if (body.network !== 'public' && body.network !== 'testnet') {
      throw new ReusableTemplateServiceError('Network must be public or testnet.', 400, 'invalid_network');
    }
    assertDeploymentNetwork(body.network);
    const template = await createReusableTemplate(runtimeReusableTemplateStore(), owner, {
      network: body.network,
      name: body.name,
      kind: body.kind,
      definition: body.definition,
    });
    return noStoreJson({ template }, 201);
  } catch (cause) {
    return errorResponse(cause);
  }
}
