import { blobAuthStore } from '../server/blobAuthStore.js';
import { blobBoxStore } from '../server/blobBoxStore.js';
import { RequestStorageUnavailableError } from '../server/blobRequestStore.js';
import { authConfigForRequest } from '../server/authConfig.js';
import { AuthServiceError, requirePrivateWorkspaceSession } from '../server/authService.js';
import {
  auditKeySummary,
  BoxServiceError,
  createTreasuryAuditKey,
  recordBoxAudit,
  renameTreasuryBox,
  revokeTreasuryAuditKey,
  treasuryBoxRef,
} from '../server/boxService.js';
import { readJsonObjectBody, RequestBodyError } from '../server/requestBody.js';
import { noStoreJson } from '../server/httpResponse.js';
import {
  beforeFirstDurableWrite,
  enforceSemanticRateLimit,
  SEMANTIC_RATE_LIMIT_IDS,
  SemanticRateLimitError,
  semanticRateLimitKey,
} from '../server/semanticRateLimit.js';
import { canViewTreasuryActivity } from '../server/treasuryActivityAccess.js';
import { AccountNotFoundError, isValidStellarAccountId, loadAccount } from '../src/stellar/horizon.js';
import { privateSessionAddressFromRequest } from '../src/stellar/privateSessionTransport.js';
import { loadAccountsForSigner } from '../src/stellar/signerAccounts.js';

const MAX_BODY_BYTES = 32 * 1024;
const MAX_BATCH_TREASURY_ACCOUNTS = 50;

function errorResponse(cause: unknown): Response {
  if (cause instanceof RequestBodyError) return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
  if (cause instanceof AuthServiceError) return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
  if (cause instanceof BoxServiceError) return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
  if (cause instanceof SemanticRateLimitError) return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
  if (cause instanceof RequestStorageUnavailableError) return noStoreJson({ error: cause.message, code: 'storage_not_configured' }, 503);
  console.error('Treasury Box API error', cause);
  return noStoreJson({ error: 'Treasury service is temporarily unavailable.', code: 'internal_error' }, 500);
}

async function authorizedSession(request: Request) {
  const session = await requirePrivateWorkspaceSession(
    blobAuthStore,
    request,
    authConfigForRequest(request),
    'Unlock this wallet to manage Treasury settings.',
  );
  const url = new URL(request.url);
  const selectedAddress = privateSessionAddressFromRequest(request);
  if (!selectedAddress || selectedAddress !== session.address) {
    throw new BoxServiceError('Treasury settings session does not match the selected wallet.', 401, 'session_identity_mismatch');
  }
  const requestedNetwork = url.searchParams.get('network');
  if ((requestedNetwork !== 'public' && requestedNetwork !== 'testnet') || requestedNetwork !== session.network) {
    throw new BoxServiceError('Treasury settings session does not match the selected network.', 401, 'session_network_mismatch');
  }
  return session;
}

async function authorizedBox(request: Request) {
  const session = await authorizedSession(request);
  const url = new URL(request.url);
  const accountId = url.searchParams.get('account')?.trim() ?? '';
  if (!isValidStellarAccountId(accountId)) throw new BoxServiceError('Enter a valid Treasury account.', 400, 'invalid_account');
  let account;
  try {
    account = await loadAccount(accountId, session.network);
  } catch (cause) {
    if (cause instanceof AccountNotFoundError) throw new BoxServiceError(cause.message, 404, 'treasury_not_found');
    throw cause;
  }
  if (!canViewTreasuryActivity(account, session.address)) {
    throw new BoxServiceError('This wallet is not a current signer for this Treasury.', 403, 'treasury_access_denied');
  }
  return { session, box: treasuryBoxRef(session.network, accountId) };
}

function boxStoreWithAdminQuota(request: Request, box: ReturnType<typeof treasuryBoxRef>) {
  const beforeWrite = beforeFirstDurableWrite(async () => {
    await enforceSemanticRateLimit(request, {
      rateLimitId: SEMANTIC_RATE_LIMIT_IDS.treasuryAdmin,
      rateLimitKey: semanticRateLimitKey(box.network, box.accountId),
      errorCode: 'treasury_admin_rate_limited',
      errorMessage: 'This Treasury has had too many administration changes recently. Try again later.',
    });
  });
  return {
    ...blobBoxStore,
    putMetadata: async (...args: Parameters<typeof blobBoxStore.putMetadata>) => {
      await beforeWrite();
      return blobBoxStore.putMetadata(...args);
    },
    putAuditKey: async (...args: Parameters<typeof blobBoxStore.putAuditKey>) => {
      await beforeWrite();
      return blobBoxStore.putAuditKey(...args);
    },
    touchAuditKey: async (...args: Parameters<typeof blobBoxStore.touchAuditKey>) => {
      await beforeWrite();
      return blobBoxStore.touchAuditKey(...args);
    },
    putAuditEvent: async (...args: Parameters<typeof blobBoxStore.putAuditEvent>) => {
      await beforeWrite();
      return blobBoxStore.putAuditEvent(...args);
    },
  };
}

function requestedBatchAccounts(url: URL): string[] | null {
  const value = url.searchParams.get('accounts');
  if (value === null) return null;
  const ids = [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
  if (ids.length === 0) throw new BoxServiceError('Choose at least one Treasury account.', 400, 'invalid_accounts');
  if (ids.length > MAX_BATCH_TREASURY_ACCOUNTS) {
    throw new BoxServiceError(`Request at most ${MAX_BATCH_TREASURY_ACCOUNTS} Treasury accounts at a time.`, 400, 'too_many_accounts');
  }
  if (ids.some((id) => !isValidStellarAccountId(id))) {
    throw new BoxServiceError('Treasury account list contains an invalid Stellar account.', 400, 'invalid_accounts');
  }
  return ids;
}

async function batchMetadata(request: Request, accountIds: string[]): Promise<Response> {
  const session = await authorizedSession(request);
  const signerAccounts = await loadAccountsForSigner(session.address, session.network);
  const byId = new Map(signerAccounts.map((account) => [account.accountId, account] as const));
  for (const accountId of accountIds) {
    const account = byId.get(accountId);
    if (!account || !canViewTreasuryActivity(account, session.address)) {
      throw new BoxServiceError('This wallet is not a current signer for every requested Treasury.', 403, 'treasury_access_denied');
    }
  }
  const metadata = await Promise.all(accountIds.map(async (accountId) => {
    const value = await blobBoxStore.getMetadata(treasuryBoxRef(session.network, accountId));
    return [accountId, value] as const;
  }));
  return noStoreJson({ metadataByAccount: Object.fromEntries(metadata) });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const batchAccounts = requestedBatchAccounts(url);
    if (batchAccounts) return await batchMetadata(request, batchAccounts);

    const { session, box } = await authorizedBox(request);
    const include = url.searchParams.get('include');
    const metadata = await blobBoxStore.getMetadata(box);
    const keys = include === 'audit-keys' ? (await blobBoxStore.listAuditKeys(box)).map(auditKeySummary) : undefined;
    const audit = include === 'audit' ? await blobBoxStore.listAuditEvents(box) : undefined;
    if (include === 'audit-keys') {
      await recordBoxAudit(blobBoxStore, box, { type: 'stellar', id: session.address }, 'audit_credentials_viewed', {
        detail: 'Viewed Treasury Audit credential metadata.',
        metadata: { keyCount: keys?.length ?? 0 },
      });
    }
    return noStoreJson({
      box,
      metadata,
      ...(keys ? { keys } : {}),
      ...(audit ? { audit } : {}),
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const { session, box } = await authorizedBox(request);
    const body = await readJsonObjectBody(request, MAX_BODY_BYTES);
    const metadata = await renameTreasuryBox(boxStoreWithAdminQuota(request, box), box, body.name, session.address);
    return noStoreJson({ box, metadata });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { session, box } = await authorizedBox(request);
    const body = await readJsonObjectBody(request, MAX_BODY_BYTES);
    const created = await createTreasuryAuditKey(boxStoreWithAdminQuota(request, box), box, body.label, session.address);
    return noStoreJson({ box, ...created }, 201);
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const { session, box } = await authorizedBox(request);
    const body = await readJsonObjectBody(request, MAX_BODY_BYTES);
    if (typeof body.keyId !== 'string' || !body.keyId.trim()) throw new BoxServiceError('Audit credential id is required.', 400, 'invalid_audit_credential_id');
    const key = await revokeTreasuryAuditKey(boxStoreWithAdminQuota(request, box), box, body.keyId, session.address);
    return noStoreJson({ box, key });
  } catch (cause) {
    return errorResponse(cause);
  }
}
