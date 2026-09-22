import { blobAgentCredentialStore } from '../server/blobAgentCredentialStore.js';
import { blobAuthStore } from '../server/blobAuthStore.js';
import { blobBoxStore } from '../server/blobBoxStore.js';
import { RequestStorageUnavailableError } from '../server/blobRequestStore.js';
import {
  runtimeSigningRequestStore,
  runtimeSorobanIntentStore,
} from '../server/coordinationStores.js';
import { authConfigForRequest } from '../server/authConfig.js';
import { AuthServiceError, requirePrivateWorkspaceSession } from '../server/authService.js';
import {
  AgentCredentialServiceError,
  authenticateAgentCredential,
  looksLikeAgentCredential,
  requireAgentAccess,
} from '../server/agentCredentialService.js';
import {
  BoxServiceError,
  authenticateTreasuryAuditKey,
  looksLikeTreasuryAuditCredential,
} from '../server/boxService.js';
import {
  getSignerActivityItem,
  getTreasuryActivityItem,
  listSignerActivityPage,
  listTreasuryActivityPage,
} from '../server/requestActivity.js';
import { canViewTreasuryActivity } from '../server/treasuryActivityAccess.js';
import { listWorkActivityPage } from '../server/workActivity.js';
import { noStoreJson } from '../server/httpResponse.js';
import { AccountNotFoundError, isValidStellarAccountId, loadAccount } from '../../../../packages/stellar-core/src/horizon.js';
import { isValidSigningRequestId } from '../server/requestLocator.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';

const signingRequestStore = runtimeSigningRequestStore();
const sorobanIntentStore = runtimeSorobanIntentStore();

interface ActivityViewer {
  address: string;
  network: StellarNetwork;
  kind: 'human' | 'agent' | 'treasury_audit';
  auditAccountId?: string;
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1].trim() || null;
}

async function activityViewer(request: Request): Promise<ActivityViewer> {
  const bearer = bearerToken(request);
  if (bearer && looksLikeAgentCredential(bearer)) {
    const credential = await authenticateAgentCredential(blobAgentCredentialStore, bearer);
    requireAgentAccess(credential, 'read');
    await blobAgentCredentialStore.touchCredential(credential.credentialId, new Date().toISOString());
    return { address: credential.principal.address, network: credential.principal.network, kind: 'agent' };
  }
  if (bearer && looksLikeTreasuryAuditCredential(bearer)) {
    const credential = await authenticateTreasuryAuditKey(blobBoxStore, bearer);
    await blobBoxStore.touchAuditKey(credential.keyId, new Date().toISOString());
    return {
      address: '',
      network: credential.box.network,
      kind: 'treasury_audit',
      auditAccountId: credential.box.accountId,
    };
  }
  if (bearer) throw new BoxServiceError('Invalid API credential.', 401, 'invalid_api_credential');
  const session = await requirePrivateWorkspaceSession(
    blobAuthStore,
    request,
    authConfigForRequest(request),
    'Unlock private data to view Activity.',
  );
  return { address: session.address, network: session.network, kind: 'human' };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const viewer = await activityViewer(request);
    const url = new URL(request.url);
    let accountId = url.searchParams.get('account')?.trim() || undefined;
    const requestId = url.searchParams.get('request')?.trim() || undefined;
    const cursor = url.searchParams.get('cursor')?.trim() || undefined;
    const view = url.searchParams.get('view')?.trim() || undefined;

    if (viewer.kind === 'treasury_audit') {
      if (accountId && accountId !== viewer.auditAccountId) {
        return noStoreJson({ error: 'This Audit credential is bound to another Treasury.', code: 'treasury_audit_scope_denied' }, 403);
      }
      accountId = viewer.auditAccountId;
    }
    if (accountId && !isValidStellarAccountId(accountId)) {
      return noStoreJson({ error: 'Enter a valid Stellar account.', code: 'invalid_account' }, 400);
    }
    if (requestId && !isValidSigningRequestId(requestId)) {
      return noStoreJson({ error: 'Enter a valid signing request id.', code: 'invalid_request_id' }, 400);
    }
    if (viewer.kind === 'treasury_audit' && !accountId) {
      return noStoreJson({ error: 'Treasury Audit credentials can read Treasury Activity only.', code: 'treasury_audit_scope_denied' }, 403);
    }

    if (view === 'work') {
      if (viewer.kind === 'treasury_audit' || accountId || requestId) {
        return noStoreJson({
          error: 'Unified Work Activity is available only for personal Human or Agent history.',
          code: 'work_activity_scope_denied',
        }, 400);
      }
      const page = await listWorkActivityPage(
        signingRequestStore,
        sorobanIntentStore,
        viewer.address,
        { network: viewer.network, limit: 25, cursor },
      );
      return noStoreJson({
        address: viewer.address,
        network: viewer.network,
        actor: viewer.kind,
        workItems: page.items,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      });
    }

    let account;
    if (accountId) {
      try {
        account = await loadAccount(accountId, viewer.network);
      } catch (cause) {
        if (cause instanceof AccountNotFoundError) {
          return noStoreJson({ error: cause.message, code: 'treasury_not_found' }, 404);
        }
        throw cause;
      }
      if (viewer.kind !== 'treasury_audit' && !canViewTreasuryActivity(account, viewer.address)) {
        return noStoreJson({
          error: 'This signer is not a current signer for this treasury.',
          code: 'treasury_access_denied',
        }, 403);
      }
    }

    const knownSignerAddresses = account?.signers
      .filter((signer) => signer.weight > 0)
      .map((signer) => signer.key) ?? [];

    if (requestId) {
      const item = accountId
        ? await getTreasuryActivityItem(signingRequestStore, viewer.address, requestId, accountId, {
            network: viewer.network,
            knownSignerAddresses,
          })
        : await getSignerActivityItem(signingRequestStore, viewer.address, requestId, {
            network: viewer.network,
          });
      if (!item) return noStoreJson({ error: 'Activity item not found.', code: 'activity_not_found' }, 404);
      return noStoreJson({
        ...(viewer.address ? { address: viewer.address } : {}),
        network: viewer.network,
        actor: viewer.kind,
        ...(accountId ? { accountId } : {}),
        item,
        items: [item],
      });
    }

    const page = accountId
      ? await listTreasuryActivityPage(signingRequestStore, viewer.address, accountId, {
          network: viewer.network,
          limit: 25,
          cursor,
          knownSignerAddresses,
        })
      : await listSignerActivityPage(signingRequestStore, viewer.address, {
          network: viewer.network,
          limit: 25,
          cursor,
        });

    return noStoreJson({
      ...(viewer.address ? { address: viewer.address } : {}),
      network: viewer.network,
      actor: viewer.kind,
      ...(accountId ? { accountId } : {}),
      items: page.items,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    });
  } catch (cause) {
    if (cause instanceof AgentCredentialServiceError) return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
    if (cause instanceof BoxServiceError) return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
    if (cause instanceof AuthServiceError) return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
    if (cause instanceof RequestStorageUnavailableError) return noStoreJson({ error: cause.message, code: 'storage_not_configured' }, 503);
    console.error('Activity API error', cause);
    return noStoreJson({ error: 'Activity is temporarily unavailable.', code: 'internal_error' }, 500);
  }
}
