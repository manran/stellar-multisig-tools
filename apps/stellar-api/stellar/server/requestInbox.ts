import { AccountNotFoundError, loadAccount, loadNetworkParameters } from '../../../../packages/stellar-core/src/horizon.js';
import type { StellarNetworkParameters } from '../../../../packages/stellar-core/src/horizon.js';
import type { ActivityCoordinationEvent } from '../../../../packages/stellar-core/src/activityTypes.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';
import type { InboxRequestSnapshot } from '../../../../packages/stellar-core/src/inboxPresentation.js';
import { projectInboxViewerAction } from '../../../../packages/stellar-core/src/inboxPresentation.js';
import { isClassicExecutionUnresolved, type SigningRequestSnapshot } from '../../../../packages/stellar-core/src/requestTypes.js';
import { isValidSigningRequestId } from './requestLocator.js';
import { compareInboxPageKeys, type InboxPageKey } from './inboxPage.js';
import { isExternalClassicRequest, type SigningRequestStore, type StoredSigningRequest } from './requestStore.js';
import { getSigningRequestForStoredRequest } from './requestService.js';
import { signerCanAccessTransaction, signerHasSignedTransaction } from './requestAccess.js';
import { inspectTransactionXdr } from '../../../../packages/stellar-core/src/transactionXdr.js';

interface InboxOptions {
  now?: Date;
  network?: StellarNetwork;
  accountLoader?: (accountId: string, network: StellarNetwork) => ReturnType<typeof loadAccount>;
  networkParametersLoader?: (network: StellarNetwork) => Promise<StellarNetworkParameters>;
  limit?: number;
  includeProposed?: boolean;
  sourceAccountIds?: string[];
  after?: InboxPageKey;
}

const REQUEST_SCAN_BATCH_SIZE = 6;

async function discoveryCandidates(
  store: SigningRequestStore,
  address: string,
  network: StellarNetwork | undefined,
  includeProposed: boolean,
  sourceAccountIds: string[],
): Promise<StoredSigningRequest[]> {
  const proposer = network && includeProposed ? await store.listRequestsByProposer?.(network, address) ?? [] : [];
  let signers: StoredSigningRequest[];
  if (!network || !store.listRequestsByDiscoverySubjects) {
    signers = store.listRequests ? await store.listRequests() : [];
  } else {
    try {
      signers = await store.listRequestsByDiscoverySubjects(network, sourceAccountIds, address);
    } catch (cause) {
      if (!store.listRequests) throw cause;
      signers = await store.listRequests();
    }
  }
  return [...new Map([...signers, ...proposer].map((item) => [item.id, item])).values()];
}

export async function listSignerInbox(
  store: SigningRequestStore,
  address: string,
  options: InboxOptions = {},
): Promise<SigningRequestSnapshot[]> {
  if (!store.listRequests && !store.listRequestsByDiscoverySubjects) return [];
  const now = options.now ?? new Date();
  const accountLoader = options.accountLoader ?? loadAccount;
  const networkParametersLoader = options.networkParametersLoader ?? loadNetworkParameters;
  const limit = Math.max(1, Math.min(options.limit ?? 50, 501));
  const accountCache = new Map<string, ReturnType<typeof loadAccount>>();
  const cachedAccountLoader: typeof loadAccount = (accountId, network) => {
    const key = `${network}:${accountId}`;
    const cached = accountCache.get(key);
    if (cached) return cached;
    const pending = accountLoader(accountId, network);
    accountCache.set(key, pending);
    return pending;
  };

  const requests = (await discoveryCandidates(store, address, options.network, options.includeProposed !== false, options.sourceAccountIds ?? []))
    .filter((request) => isValidSigningRequestId(request.id))
    .filter((request) => (!options.network || request.network === options.network))
    .filter((request) => isExternalClassicRequest(request) || new Date(request.expiresAt).getTime() > now.getTime())
    .filter((item) => !options.after || compareInboxPageKeys({ kind: 'request', id: item.id, createdAt: item.createdAt }, options.after) > 0)
    .sort((a, b) => compareInboxPageKeys({ ...a, kind: 'request' }, { ...b, kind: 'request' }));

  const visible: SigningRequestSnapshot[] = [];
  for (let index = 0; index < requests.length && visible.length < limit; index += REQUEST_SCAN_BATCH_SIZE) {
    const batch = requests.slice(index, index + REQUEST_SCAN_BATCH_SIZE);
    const snapshots = await Promise.all(batch.map(async (request): Promise<SigningRequestSnapshot | null> => {
      let authorized = options.includeProposed !== false && request.proposerAddress === address;
      try {
        if (!authorized) authorized = await signerCanAccessTransaction(
          address,
          request.baseXdr,
          request.network,
          cachedAccountLoader,
        );
      } catch (cause) {
        // A deleted source account is not a live authorization subject. A
        // failed dependency lookup is not evidence that no task exists.
        if (cause instanceof AccountNotFoundError) return null;
        throw cause;
      }
      if (!authorized) return null;

      const snapshot = await getSigningRequestForStoredRequest(store, request, {
        now,
        accountLoader: cachedAccountLoader,
        networkParametersLoader,
        ...(isExternalClassicRequest(request) ? { observeClosedExecution: false } : {}),
      });
      if (snapshot.status === 'submitted' || snapshot.executionOutcome?.outcome === 'failed' || snapshot.executionOutcome?.outcome === 'not_included' || (['expired', 'stale'].includes(snapshot.status) && !isClassicExecutionUnresolved(snapshot))) return null;
      return snapshot;
    }));

    for (const snapshot of snapshots) {
      if (!snapshot) continue;
      visible.push(snapshot);
      if (visible.length >= limit) break;
    }
  }
  return visible;
}


function projectedRequestExecutionMode(snapshot: SigningRequestSnapshot): 'multisigtools' | 'external' | undefined {
  if (snapshot.execution?.mode) return snapshot.execution.mode;
  try {
    return inspectTransactionXdr(snapshot.mergedXdr, snapshot.network).operations.some((operation) => operation.type === 'invokeHostFunction')
      ? 'multisigtools'
      : undefined;
  } catch {
    return undefined;
  }
}

function outgoingCoordinationEvents(
  events: readonly ActivityCoordinationEvent[],
  viewerAddress: string,
): ActivityCoordinationEvent[] {
  const requestedSigners = new Set(
    events
      .filter((event) => event.type === 'signer_requested' && event.actorAddress === viewerAddress)
      .map((event) => event.subjectAddress),
  );
  if (requestedSigners.size === 0) return [];
  return events.filter((event) =>
    requestedSigners.has(event.subjectAddress)
    && (
      event.type === 'proposal_viewed'
      || event.actorAddress === viewerAddress
    ));
}

export async function projectHumanInboxRequests(
  store: SigningRequestStore,
  address: string,
  requests: readonly SigningRequestSnapshot[],
): Promise<InboxRequestSnapshot[]> {
  return Promise.all(requests.map(async (snapshot) => {
    const declined = snapshot.declines?.some(item => item.signerAddress === address) ?? false;
    const viewerAction = isClassicExecutionUnresolved(snapshot) ? 'execution_unknown' as const : snapshot.proposerAddress === address
      ? snapshot.status === 'awaiting_signatures' ? (snapshot.statusReason === 'quorum_unreachable' ? 'quorum_unreachable' as const : 'proposer_waiting' as const)
        : snapshot.status === 'ready' ? 'proposer_ready' as const
          : projectInboxViewerAction(snapshot.status, { hasSigned: true,
              executionMode: projectedRequestExecutionMode(snapshot) })
      : projectInboxViewerAction(snapshot.status, {
      hasSigned: signerHasSignedTransaction(address, snapshot.mergedXdr, snapshot.network),
      declined,
      quorumUnreachable: snapshot.statusReason === 'quorum_unreachable',
      executionMode: projectedRequestExecutionMode(snapshot),
    });
    const coordinationEvents = (viewerAction === 'waiting_for_others' || viewerAction === 'proposer_waiting') && store.listRequestCoordinationEvents
      ? outgoingCoordinationEvents(await store.listRequestCoordinationEvents(snapshot.id), address)
      : [];
    return {
      ...snapshot,
      viewerAction,
      ...(coordinationEvents.length > 0 ? { coordinationEvents } : {}),
    };
  }));
}
