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
import { listSignerInbox, listUserProposerInbox, projectHumanInboxRequests } from '../server/requestInbox.js';
import { IdentityError, PostgresIdentityStore } from '../server/identityStore.js';
import { passkeyIdentityFromRequest } from '../server/identityService.js';
import { privateSessionAddressFromRequest } from '../../../../packages/stellar-core/src/privateSessionTransport.js';
import { projectClassicAgentTask } from '../server/agentTaskProjection.js';
import { signerHasSignedTransaction } from '../server/requestAccess.js';
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
    return { address: credential.principal.address, network: credential.principal.network, actor: 'agent' as const, access: credential.access };
  }
  const identities = new PostgresIdentityStore();
  // An explicit verified wallet selection takes precedence over a Passkey cookie.
  const walletSelected = Boolean(privateSessionAddressFromRequest(request));
  if (!walletSelected) {
    const passkey = await passkeyIdentityFromRequest(request, identities);
    if (passkey) return { address: '', userId: passkey.userId,
      network: passkey.network, actor: 'human' as const };
  }
  const session = await requirePrivateWorkspaceSession(
    blobAuthStore, request, authConfigForRequest(request),
    'Sign in with a Stellar wallet or Passkey to view this Inbox.',
  );
  return { address: session.address, userId: await identities.walletUser(session.address),
    network: session.network, actor: 'human' as const };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await signerContext(request);
    const signerRequests = context.address
      ? await listSignerInbox(signingRequestStore, context.address, { network: context.network }) : [];
    if (context.actor === 'human') {
      const owned = await listUserProposerInbox(signingRequestStore, context.userId, context.network);
      const requests = [...new Map([...signerRequests, ...owned].map((item) => [item.id, item])).values()];
      const [humanRequests, intents] = await Promise.all([
        projectHumanInboxRequests(signingRequestStore, context.address, requests, context.userId),
        context.address ? listSorobanIntentInbox(sorobanIntentStore, context.address, context.network) : Promise.resolve([]),
      ]);
      const actionCounts = summarizeInboxActions(humanRequests, intents);
      return noStoreJson({
        address: context.address || null,
        userId: context.userId,
        network: context.network,
        actor: context.actor,
        pending_count: humanRequests.length + intents.length,
        action_count: actionCounts.actionRequired,
        action_counts: actionCounts,
        requests: humanRequests,
        intents,
      });
    }
    // Machine callers receive the same verified Request list plus typed next tasks.
    // A task action can be unavailable to a Read/Write credential without
    // implying a different on-chain signer or permission.
    const requests = signerRequests;
    const tasks = await Promise.all(requests.map(async (item) => {
      const declined = item.status === 'awaiting_signatures' && signingRequestStore.listActivityEvents
        ? (await signingRequestStore.listActivityEvents(item.id)).some((event) =>
          event.type === 'approval_declined' && event.actorAddress === context.address)
        : false;
      return projectClassicAgentTask({
        request: item,
        credentialAccess: context.access,
        hasSigned: signerHasSignedTransaction(context.address, item.mergedXdr, item.network),
        declined,
      });
    }));
    return noStoreJson({
      address: context.address,
      network: context.network,
      actor: context.actor,
      pending_count: requests.length,
      action_count: tasks.filter((task) => task.state === 'action_required').length,
      requests,
      tasks,
    });
  } catch (cause) {
    if (cause instanceof AgentCredentialServiceError) return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
    if (cause instanceof AuthServiceError || cause instanceof IdentityError) return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
    if (cause instanceof RequestStorageUnavailableError) return noStoreJson({ error: cause.message, code: 'storage_not_configured' }, 503);
    console.error('Inbox API error', cause);
    return noStoreJson({ error: 'Signer inbox is temporarily unavailable.', code: 'internal_error' }, 500);
  }
}
