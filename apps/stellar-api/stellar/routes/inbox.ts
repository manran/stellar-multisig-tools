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

const signingRequestStore = runtimeSigningRequestStore();
const sorobanIntentStore = runtimeSorobanIntentStore();

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await signerWorkspaceCallerFromRequest(blobAgentCredentialStore, blobAuthStore, request, 'read', 'Sign in with a Stellar wallet to view this inbox.');
    const requests = await listSignerInbox(signingRequestStore, context.address, { network: context.network, includeProposed: context.actor === 'human' });
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
    // Separate the signer's pending signatures from actions the current
    // Agent credential can perform. Read Agents can notify their signer.
    const [classicTasks, soroban] = await Promise.all([Promise.all(requests.map(async (item) => {
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
    })), listAgentSorobanInbox(sorobanIntentStore, context.address, context.network, context.access)]);
    const tasks = [...classicTasks, ...soroban.tasks];
    return noStoreJson({
      address: context.address,
      network: context.network,
      actor: context.actor,
      pending_count: tasks.length,
      action_count: tasks.filter((task) => task.nextActions.some((action) => action.available)).length,
      signature_required_count: tasks.filter((task) => task.signatureRequired).length,
      requests,
      intents: soroban.intents,
      tasks,
    });
  } catch (cause) {
    if (cause instanceof AgentCredentialServiceError) return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
    if (cause instanceof AuthServiceError || cause instanceof CallerAuthenticationError || cause instanceof DeploymentNetworkPolicyError) return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
    if (cause instanceof RequestStorageUnavailableError) return noStoreJson({ error: cause.message, code: 'storage_not_configured' }, 503);
    console.error('Inbox API error', cause);
    return noStoreJson({ error: 'Signer inbox is temporarily unavailable.', code: 'internal_error' }, 500);
  }
}
