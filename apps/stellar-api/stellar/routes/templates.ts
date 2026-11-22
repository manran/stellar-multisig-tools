import { blobAuthStore } from '../server/blobAuthStore.js';
import { PostgresIdentityStore } from '../server/identityStore.js';
import { currentUserIdentity } from '../server/identityService.js';
import { authConfigForRequest } from '../server/authConfig.js';
import { AuthServiceError, requirePrivateWorkspaceSession } from '../server/authService.js';
import { assertDeploymentNetwork, DeploymentNetworkPolicyError } from '../server/deploymentNetworkPolicy.js';
import { noStoreJson } from '../server/httpResponse.js';
import { readJsonObjectBody, RequestBodyError } from '../server/requestBody.js';
import type { ReusableTemplateSummary } from '../../../../packages/stellar-core/src/reusableTemplate.js';
import {
  ReusableTemplateServiceError,
  createReusableTemplate,
  listWalletTemplates,
  updateTemplateProposer,
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
    const identities = new PostgresIdentityStore();
    const identity = await currentUserIdentity(request, identities, network);
    if (!identity) throw new AuthServiceError('Sign in with a Passkey or wallet to view Templates.', 401, 'authentication_required');
    const templatesStore = runtimeReusableTemplateStore();
    const walletTemplates = identity.address
      ? await listWalletTemplates(templatesStore, identity.address, network) : [];
    const userIds = await identities.grantedTemplateIds(identity.userId, network);
    const known = new Set(walletTemplates.map((item) => item.id));
    const extra: ReusableTemplateSummary[] = [];
    for (const templateId of userIds) {
      if (known.has(templateId)) continue;
      const first = await templatesStore.getTemplateVersion(templateId, 1);
      if (!first) continue;
      const value = await templatesStore.getTemplateVersion(templateId, first.template.currentVersion);
      if (!value || value.template.archivedAt || value.template.kind !== 'payment') continue;
      extra.push({
        id: value.template.id, ownerAddress: value.template.ownerAddress,
        network: value.template.network, kind: value.template.kind, name: value.template.name,
        currentVersion: value.template.currentVersion, definition: value.definition,
        createdAt: value.template.createdAt, updatedAt: value.template.updatedAt,
      });
    }
    const templates = await Promise.all([...walletTemplates, ...extra].map(async (item) =>
      identity.address && item.ownerAddress === identity.address
        ? { ...item, proposerUserIds: await identities.grantUsers(item.id),
          pendingInvitations: await identities.listPendingInvitations(item.id) }
        : item));
    return noStoreJson({ address: identity.address ?? null, userId: identity.userId, templates });
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

/** Only the Template's owning verified signer may grant or revoke a proposer. */
export async function PATCH(request: Request): Promise<Response> {
  try {
    const owner = await ownerAddress(request);
    const body = await readJsonObjectBody(request, MAX_BODY_BYTES);
    if (body.network !== 'public' && body.network !== 'testnet') {
      throw new ReusableTemplateServiceError('Network must be public or testnet.', 400, 'invalid_network');
    }
    assertDeploymentNetwork(body.network);
    const proposerAddresses = await updateTemplateProposer(
      runtimeReusableTemplateStore(), owner, body.network,
      body.templateId, body.proposerAddress, body.action,
    );
    return noStoreJson({ proposerAddresses });
  } catch (cause) {
    return errorResponse(cause);
  }
}
