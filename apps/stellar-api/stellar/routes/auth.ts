import { blobAuthStore } from '../server/blobAuthStore.js';
import { RequestStorageUnavailableError } from '../server/blobRequestStore.js';
import { assertDeploymentNetwork, DeploymentNetworkPolicyError } from '../server/deploymentNetworkPolicy.js';
import { authConfigForRequest } from '../server/authConfig.js';
import {
  AuthServiceError,
  authCookie,
  authTokenFromRequest,
  clearAuthCookie,
  createAuthChallenge,
  exchangeAuthChallenge,
  exchangeAuthMessageChallenge,
  resolveUnlockTtlSeconds,
  verifyAuthToken,
} from '../server/authService.js';
import { readJsonObjectBody, RequestBodyError } from '../server/requestBody.js';
import { publicCorsHeaders, publicCorsJson } from '../server/httpResponse.js';

const MAX_BODY_BYTES = 300 * 1024;
const CORS_METHODS = 'GET, POST, DELETE, OPTIONS';

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return publicCorsJson(data, CORS_METHODS, status, headers);
}

function errorResponse(cause: unknown): Response {
  if (cause instanceof RequestBodyError || cause instanceof DeploymentNetworkPolicyError) return json({ error: cause.message, code: cause.code }, cause.status);
  if (cause instanceof AuthServiceError) return json({ error: cause.message, code: cause.code }, cause.status);
  if (cause instanceof RequestStorageUnavailableError) return json({ error: cause.message, code: 'storage_not_configured' }, 503);
  console.error('Authentication API error', cause);
  return json({ error: 'Private workspace service is temporarily unavailable.', code: 'internal_error' }, 500);
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: publicCorsHeaders(CORS_METHODS) });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const account = url.searchParams.get('account')?.trim();
    const config = authConfigForRequest(request);
    if (account) {
      const network = url.searchParams.get('network') ?? 'public';
      if (network === 'public' || network === 'testnet') assertDeploymentNetwork(network);
      const sessionTtlSeconds = resolveUnlockTtlSeconds(url.searchParams.get('unlock_seconds'));
      const challenge = await createAuthChallenge(blobAuthStore, account, network, {
        ...config,
        sessionTtlSeconds,
      });
      return json({
        message: challenge.message,
        transaction: challenge.transaction,
        network: challenge.network,
        network_passphrase: challenge.networkPassphrase,
        signing_key: challenge.signingKey,
        unlock_seconds: sessionTtlSeconds,
      });
    }

    const token = authTokenFromRequest(request);
    if (!token) return json({ unlocked: false, authenticated: false });
    try {
      const session = await verifyAuthToken(blobAuthStore, token, config);
      assertDeploymentNetwork(session.network);
      return json({
        unlocked: true,
        authenticated: true,
        address: session.address,
        network: session.network,
        expires_at: session.expiresAt,
      });
    } catch (cause) {
      if (cause instanceof AuthServiceError && cause.status === 401) return json({ unlocked: false, authenticated: false });
      throw cause;
    }
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonObjectBody(request, MAX_BODY_BYTES);
    const network = typeof body.network === 'string' ? body.network : 'public';
    if (network === 'public' || network === 'testnet') assertDeploymentNetwork(network);
    const sessionTtlSeconds = resolveUnlockTtlSeconds(body.unlock_seconds);
    const config = { ...authConfigForRequest(request), sessionTtlSeconds };
    const result = body.mode === 'sep53'
      ? await exchangeAuthMessageChallenge(
        blobAuthStore,
        typeof body.challenge === 'string' ? body.challenge : '',
        typeof body.signature === 'string' ? body.signature : '',
        network,
        config,
      )
      : await exchangeAuthChallenge(
        blobAuthStore,
        typeof body.transaction === 'string' ? body.transaction : '',
        network,
        config,
      );
    const maxAgeSeconds = result.session.expiresAt - result.session.issuedAt;
    return json(
      {
        token: result.token,
        address: result.session.address,
        network: result.session.network,
        expires_at: result.session.expiresAt,
      },
      200,
      { 'Set-Cookie': authCookie(result.token, maxAgeSeconds) },
    );
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function DELETE(): Promise<Response> {
  return json({ unlocked: false, authenticated: false }, 200, { 'Set-Cookie': clearAuthCookie() });
}
