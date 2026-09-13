import { blobAddressBookStore } from '../server/blobAddressBookStore.js';
import { blobAgentCredentialStore } from '../server/blobAgentCredentialStore.js';
import { blobAuthStore } from '../server/blobAuthStore.js';
import { RequestStorageUnavailableError } from '../server/blobRequestStore.js';
import { authConfigForRequest } from '../server/authConfig.js';
import { AuthServiceError, requirePrivateWorkspaceSession } from '../server/authService.js';
import {
  AgentCredentialServiceError,
  authenticateAgentCredential,
  requireAgentAccess,
} from '../server/agentCredentialService.js';
import {
  AddressBookServiceError,
  deleteAddressAlias,
  listAddressAliases,
  upsertAddressAlias,
} from '../server/addressBookService.js';
import type { StoredAddressAlias } from '../server/addressBookStore.js';
import { readJsonObjectBody, RequestBodyError } from '../server/requestBody.js';
import { publicCorsHeaders, publicCorsJson } from '../server/httpResponse.js';
import type { AgentAccessLevel } from '../src/stellar/agentAccessTypes.js';

const MAX_BODY_BYTES = 8 * 1024;
const CORS_METHODS = 'GET, PUT, DELETE, OPTIONS';

function json(data: unknown, status = 200): Response {
  return publicCorsJson(data, CORS_METHODS, status);
}

function publicEntry(entry: StoredAddressAlias) {
  return {
    address: entry.address,
    subject_type: entry.subjectType,
    label: entry.label,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

function errorResponse(cause: unknown): Response {
  if (cause instanceof RequestBodyError) return json({ error: cause.message, code: cause.code }, cause.status);
  if (cause instanceof AuthServiceError) return json({ error: cause.message, code: cause.code }, cause.status);
  if (cause instanceof AgentCredentialServiceError) return json({ error: cause.message, code: cause.code }, cause.status);
  if (cause instanceof AddressBookServiceError) return json({ error: cause.message, code: cause.code }, cause.status);
  if (cause instanceof RequestStorageUnavailableError) return json({ error: cause.message, code: 'storage_not_configured' }, 503);
  console.error('Address book API error', cause);
  return json({ error: 'Address book is temporarily unavailable.', code: 'internal_error' }, 500);
}

async function ownerAddress(request: Request, requiredAccess: AgentAccessLevel): Promise<string> {
  const authorization = request.headers.get('authorization') ?? '';
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization);
  if (bearer) {
    const credential = await authenticateAgentCredential(blobAgentCredentialStore, bearer[1].trim());
    requireAgentAccess(credential, requiredAccess);
    await blobAgentCredentialStore.touchCredential(credential.credentialId, new Date().toISOString());
    return credential.principal.address;
  }
  const session = await requirePrivateWorkspaceSession(
    blobAuthStore,
    request,
    authConfigForRequest(request),
    'Sign in to use your private address book.',
  );
  return session.address;
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: publicCorsHeaders(CORS_METHODS) });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const owner = await ownerAddress(request, 'read');
    const entries = await listAddressAliases(blobAddressBookStore, owner);
    return json({ address: owner, entries: entries.map(publicEntry) });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const ownerPromise = ownerAddress(request, 'write');
    const bodyPromise = readJsonObjectBody(request, MAX_BODY_BYTES);
    const [owner, body] = await Promise.all([ownerPromise, bodyPromise]);
    const entry = await upsertAddressAlias(blobAddressBookStore, owner, {
      address: typeof body.address === 'string' ? body.address : '',
      subjectType: typeof body.subject_type === 'string' ? body.subject_type : '',
      label: typeof body.label === 'string' ? body.label : '',
    });
    return json({ entry: publicEntry(entry) });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const ownerPromise = ownerAddress(request, 'write');
    const bodyPromise = readJsonObjectBody(request, MAX_BODY_BYTES);
    const [owner, body] = await Promise.all([ownerPromise, bodyPromise]);
    await deleteAddressAlias(blobAddressBookStore, owner, {
      address: typeof body.address === 'string' ? body.address : '',
      subjectType: typeof body.subject_type === 'string' ? body.subject_type : '',
    });
    return json({ deleted: true });
  } catch (cause) {
    return errorResponse(cause);
  }
}
