import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { authConfigForRequest } from '../server/authConfig.js';
import { AuthServiceError } from '../server/authService.js';
import { DeploymentNetworkPolicyError, assertDeploymentNetwork } from '../server/deploymentNetworkPolicy.js';
import { IdentityError, PostgresIdentityStore } from '../server/identityStore.js';
import {
  availableInvitation,
  clearIdentityCookie,
  createTemplateInvitation,
  currentUserIdentity,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  identityCookie,
  linkVerifiedWallet,
  requireUserIdentity,
  requireTemplateInviter,
  startPasskeyAuthentication,
  startPasskeyRegistration,
} from '../server/identityService.js';
import { ReusableTemplateServiceError } from '../server/reusableTemplateService.js';
import { readJsonObjectBody, RequestBodyError } from '../server/requestBody.js';
import { noStoreJson } from '../server/httpResponse.js';
import { runtimeSigningRequestStore } from '../server/coordinationStores.js';
import { getSigningRequest } from '../server/requestService.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';

const BODY_LIMIT = 48 * 1024;

function store(): PostgresIdentityStore { return new PostgresIdentityStore(); }

function network(value: unknown): StellarNetwork {
  if (value !== 'testnet' && value !== 'public') {
    throw new IdentityError('Select Testnet or Mainnet.', 400, 'invalid_network');
  }
  assertDeploymentNetwork(value);
  return value;
}

function assertSameOrigin(request: Request): void {
  const expected = authConfigForRequest(request).issuer.replace(/\/api\/auth$/, '');
  const origin = request.headers.get('origin');
  if (origin && origin !== expected) throw new IdentityError('This action must come from the MST website.', 403, 'invalid_origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new IdentityError('Cross-site authentication is not allowed.', 403, 'invalid_origin');
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new IdentityError('JSON request body is required.', 415, 'invalid_content_type');
  }
}

function errorResponse(cause: unknown): Response {
  if (cause instanceof IdentityError || cause instanceof AuthServiceError || cause instanceof RequestBodyError
    || cause instanceof DeploymentNetworkPolicyError || cause instanceof ReusableTemplateServiceError) {
    return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
  }
  console.error('Identity API error', cause);
  return noStoreJson({ error: 'Identity service is temporarily unavailable.', code: 'identity_service_unavailable' }, 503);
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const identityStore = store();
    const n = network(url.searchParams.get('network'));
    const identity = await currentUserIdentity(request, identityStore, n);
    if (!identity) return noStoreJson({ authenticated: false });
    if (url.searchParams.get('view') === 'activity') {
      const stored = await runtimeSigningRequestStore().listRequestsByProposerUser?.(n, identity.userId) ?? [];
      // Personal history is strictly scoped by the verified User ID, not by a G-address guess.
      const requests = await Promise.all(stored.filter((item) => item.proposerUserId === identity.userId)
        .slice(0, 30).map(async (item) => {
          const snapshot = await getSigningRequest(runtimeSigningRequestStore(), item.id);
          return { id: snapshot.id, network: snapshot.network, createdAt: snapshot.createdAt,
            status: snapshot.status, submission: snapshot.submission ?? null,
            mergedXdr: snapshot.mergedXdr,
            template: snapshot.template, transactionHash: snapshot.transactionHash };
        }));
      return noStoreJson({ userId: identity.userId, network: n, requests });
    }
    const credentials = await identityStore.listCredentials(identity.userId);
    return noStoreJson({ authenticated: true, identity, credentials: credentials.map((c) => ({
      kind: c.kind,
      ...(c.kind === 'stellar_wallet' ? { address: c.subject } : { id: c.id }),
    })) });
  } catch (cause) { return errorResponse(cause); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const body = await readJsonObjectBody(request, BODY_LIMIT);
    const action = body.action;
    const n = network(body.network);
    const identityStore = store();
    if (action === 'invitation_preview') {
      const invite = await availableInvitation(identityStore, typeof body.token === 'string' ? body.token : '');
      if (invite.network !== n) throw new IdentityError('Invitation belongs to another network.', 403, 'invitation_network_mismatch');
      return noStoreJson({ invitation: {
        templateName: invite.templateName, templateId: invite.templateId,
        network: invite.network, expiresIn: '24 hours',
      } });
    }
    if (action === 'create_invitation') {
      if (typeof body.templateId !== 'string') throw new IdentityError('Template id is required.', 400, 'invalid_template');
      return noStoreJson(await createTemplateInvitation(request, identityStore, body.templateId, n), 201);
    }
    if (action === 'revoke_user_grant' || action === 'revoke_invitation') {
      if (typeof body.templateId !== 'string') throw new IdentityError('Template is required.', 400, 'invalid_template');
      const { owner } = await requireTemplateInviter(request, identityStore, body.templateId, n);
      if (action === 'revoke_user_grant') {
        if (typeof body.userId !== 'string') throw new IdentityError('User ID is required.', 400, 'invalid_user');
        await identityStore.revokeUserGrant(body.templateId, body.userId, owner);
      } else {
        if (typeof body.invitationId !== 'string') throw new IdentityError('Invitation ID is required.', 400, 'invalid_invitation');
        await identityStore.revokeInvitation(body.templateId, body.invitationId, owner);
      }
      return noStoreJson({ revoked: true });
    }
    if (action === 'invitation_accept') {
      const identity = await requireUserIdentity(request, identityStore, n);
      const invitation = await availableInvitation(identityStore, typeof body.token === 'string' ? body.token : '');
      if (invitation.network !== n) throw new IdentityError('Invitation network differs from your login.', 403, 'invitation_network_mismatch');
      await identityStore.acceptInvitation(invitation.id, identity.userId);
      return noStoreJson({ accepted: true, userId: identity.userId });
    }
    if (action === 'registration_options') {
      return noStoreJson(await startPasskeyRegistration(request, identityStore, n,
        typeof body.token === 'string' ? body.token : undefined));
    }
    if (action === 'registration_verify') {
      if (typeof body.challengeId !== 'string' || typeof body.response !== 'object' || !body.response) {
        throw new IdentityError('Registration result is invalid.', 400, 'invalid_registration');
      }
      const result = await finishPasskeyRegistration(request, identityStore,
        body.challengeId, body.response as RegistrationResponseJSON);
      return noStoreJson({ authenticated: true, userId: result.userId, network: result.network }, 200,
        { 'Set-Cookie': identityCookie(result.token) });
    }
    if (action === 'authentication_options') {
      return noStoreJson(await startPasskeyAuthentication(request, identityStore, n));
    }
    if (action === 'authentication_verify') {
      if (typeof body.challengeId !== 'string' || typeof body.response !== 'object' || !body.response) {
        throw new IdentityError('Authentication result is invalid.', 400, 'invalid_authentication');
      }
      const result = await finishPasskeyAuthentication(request, identityStore,
        body.challengeId, body.response as AuthenticationResponseJSON);
      return noStoreJson({ authenticated: true, userId: result.userId, network: result.network }, 200,
        { 'Set-Cookie': identityCookie(result.token) });
    }
    if (action === 'link_wallet') {
      const identity = await linkVerifiedWallet(request, identityStore, n);
      return noStoreJson({ linked: true, userId: identity.userId, walletAddress: identity.address });
    }
    throw new IdentityError('Unsupported identity operation.', 400, 'identity_action_unknown');
  } catch (cause) { return errorResponse(cause); }
}

export async function DELETE(): Promise<Response> {
  return noStoreJson({ authenticated: false }, 200, { 'Set-Cookie': clearIdentityCookie() });
}
