import { blobAgentCredentialStore } from '../server/blobAgentCredentialStore.js';
import { blobAuthStore } from '../server/blobAuthStore.js';
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
  requireAgentAccess,
} from '../server/agentCredentialService.js';
import { listSignerInbox, projectHumanInboxRequests } from '../server/requestInbox.js';
import { listSorobanIntentInbox } from '../server/sorobanIntentInbox.js';
import { noStoreJson } from '../server/httpResponse.js';
import { summarizeInboxActions } from '../../../../packages/stellar-core/src/inboxPresentation.js';

const signingRequestStore = runtimeSigningRequestStore();
const sorobanIntentStore = runtimeSorobanIntentStore();

async function signerContext(request: Request) {
  const authorization = request.headers.get('authorization') ?? '';
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization);
  if (bearer) {
    const credential = await authenticateAgentCredential(blobAgentCredentialStore, bearer[1].trim());
    requireAgentAccess(credential, 'read');
    await blobAgentCredentialStore.touchCredential(credential.credentialId, new Date().toISOString());
    return { address: credential.principal.address, network: credential.principal.network, actor: 'agent' as const };
  }
  const session = await requirePrivateWorkspaceSession(
    blobAuthStore,
    request,
    authConfigForRequest(request),
    'Sign in with a Stellar wallet to view this inbox.',
  );
  return { address: session.address, network: session.network, actor: 'human' as const };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await signerContext(request);
    const requests = await listSignerInbox(signingRequestStore, context.address, { network: context.network });
    if (context.actor === 'human') {
      const [humanRequests, intents] = await Promise.all([
        projectHumanInboxRequests(signingRequestStore, context.address, requests),
        listSorobanIntentInbox(sorobanIntentStore, context.address, context.network),
      ]);
      const actionCounts = summarizeInboxActions(humanRequests, intents);
      return noStoreJson({
        address: context.address,
        network: context.network,
        actor: context.actor,
        pending_count: humanRequests.length + intents.length,
        action_count: actionCounts.actionRequired,
        action_counts: actionCounts,
        requests: humanRequests,
        intents,
      });
    }
    return noStoreJson({
      address: context.address,
      network: context.network,
      actor: context.actor,
      pending_count: requests.length,
      requests,
    });
  } catch (cause) {
    if (cause instanceof AgentCredentialServiceError) return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
    if (cause instanceof AuthServiceError) return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
    if (cause instanceof RequestStorageUnavailableError) return noStoreJson({ error: cause.message, code: 'storage_not_configured' }, 503);
    console.error('Inbox API error', cause);
    return noStoreJson({ error: 'Signer inbox is temporarily unavailable.', code: 'internal_error' }, 500);
  }
}
