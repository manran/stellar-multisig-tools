import { blobAgentCredentialStore } from '../server/blobAgentCredentialStore.js';
import { blobAuthStore } from '../server/blobAuthStore.js';
import { RequestStorageUnavailableError } from '../server/blobRequestStore.js';
import {
  runtimeSigningRequestStore,
  runtimeSorobanIntentStore,
} from '../server/coordinationStores.js';
import { AuthServiceError } from '../server/authService.js';
import { CallerAuthenticationError, signerWorkspaceCallerFromRequest } from '../server/callerAuthentication.js';
import {
  AgentCredentialServiceError,
} from '../server/agentCredentialService.js';
import { listSignerInbox, projectHumanInboxRequests } from '../server/requestInbox.js';
import { projectClassicAgentTask } from '../server/agentTaskProjection.js';
import { signerHasSignedTransaction } from '../server/requestAccess.js';
import { listAgentSorobanInbox, listSorobanIntentInbox } from '../server/sorobanIntentInbox.js';
import { noStoreJson } from '../server/httpResponse.js';
import { DeploymentNetworkPolicyError } from '../server/deploymentNetworkPolicy.js';
import { summarizeInboxActions } from '../../../../packages/stellar-core/src/inboxPresentation.js';
import { loadAccountsForSigner } from '../../../../packages/stellar-core/src/signerAccounts.js';
import { inboxPageParameters, mergeInboxPage, InvalidInboxPageError } from '../server/inboxPage.js';

const signingRequestStore = runtimeSigningRequestStore();
const sorobanIntentStore = runtimeSorobanIntentStore();

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await signerWorkspaceCallerFromRequest(blobAgentCredentialStore, blobAuthStore, request, 'read', 'Sign in with a Stellar wallet to view this inbox.');
    const { limit, after } = inboxPageParameters(new URL(request.url));
    // Reverse lookup is discovery, not authorization. Do not return a stale
    // cached account set as a complete Inbox after signer rotation.
    const accounts = await loadAccountsForSigner(context.address, context.network, AbortSignal.timeout(30000), fetch, { fresh: true });
    const options = { sourceAccountIds: accounts.map((item) => item.accountId), after, limit: limit + 1 };
    const candidates = await listSignerInbox(signingRequestStore, context.address, { ...options, network: context.network, includeProposed: context.actor === 'human' });
    if (context.actor === 'human') {
      const page = mergeInboxPage(candidates, await listSorobanIntentInbox(sorobanIntentStore, context.address, context.network, options), limit);
      const { intents, complete, nextCursor } = page;
      const humanRequests = await projectHumanInboxRequests(signingRequestStore, context.address, page.requests);
      const actionCounts = summarizeInboxActions(humanRequests, intents);
      return noStoreJson({
        address: context.address,
        network: context.network,
        actor: context.actor,
        complete,
        ...(nextCursor ? { nextCursor } : {}),
        pending_count: humanRequests.length + intents.length,
        action_count: actionCounts.actionRequired,
        action_counts: actionCounts,
        requests: humanRequests,
        intents,
      });
    }
    // Separate the signer's pending signatures from actions the current
    // Agent credential can perform. Read Agents can notify their signer.
    const soroban = await listAgentSorobanInbox(sorobanIntentStore, context.address, context.network, context.access, options);
    const { requests, intents, complete, nextCursor } = mergeInboxPage(candidates, soroban.intents, limit);
    const classicTasks = await Promise.all(requests.map(async (item) => {
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
    const intentIds = new Set(intents.map((item) => item.id));
    const tasks = [...classicTasks, ...soroban.tasks.filter((item) => intentIds.has(item.id))];
    return noStoreJson({
      address: context.address,
      network: context.network,
      actor: context.actor,
      complete,
      ...(nextCursor ? { nextCursor } : {}),
      pending_count: tasks.length,
      action_count: tasks.filter((task) => task.nextActions.some((action) => action.available)).length,
      signature_required_count: tasks.filter((task) => task.signatureRequired).length,
      requests,
      intents,
      tasks,
    });
  } catch (cause) {
    if (cause instanceof InvalidInboxPageError) return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
    if (cause instanceof AgentCredentialServiceError) return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
    if (cause instanceof AuthServiceError || cause instanceof CallerAuthenticationError || cause instanceof DeploymentNetworkPolicyError) return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
    if (cause instanceof RequestStorageUnavailableError) return noStoreJson({ error: cause.message, code: 'storage_not_configured' }, 503);
    console.error('Inbox API error', cause);
    return noStoreJson({ error: 'Unable to establish the current Inbox state. Retry before treating any tasks as cleared.', code: 'inbox_unavailable' }, 503);
  }
}
