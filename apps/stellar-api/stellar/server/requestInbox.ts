import { loadAccount, loadNetworkParameters } from '../../../../packages/stellar-core/src/horizon.js';
import type { StellarNetworkParameters } from '../../../../packages/stellar-core/src/horizon.js';
import type { ActivityCoordinationEvent } from '../../../../packages/stellar-core/src/activityTypes.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';
import type { InboxRequestSnapshot } from '../../../../packages/stellar-core/src/inboxPresentation.js';
import { projectInboxViewerAction } from '../../../../packages/stellar-core/src/inboxPresentation.js';
import type { SigningRequestSnapshot } from '../../../../packages/stellar-core/src/requestTypes.js';
import { isValidSigningRequestId } from './requestLocator.js';
import type { SigningRequestStore, StoredSigningRequest } from './requestStore.js';
import { getSigningRequest } from './requestService.js';
import { signerCanAccessTransaction, signerHasSignedTransaction } from './requestAccess.js';
import { inspectTransactionXdr } from '../../../../packages/stellar-core/src/transactionXdr.js';

interface InboxOptions {
  now?: Date;
  network?: StellarNetwork;
  accountLoader?: (accountId: string, network: StellarNetwork) => ReturnType<typeof loadAccount>;
  networkParametersLoader?: (network: StellarNetwork) => Promise<StellarNetworkParameters>;
  limit?: number;
}

const REQUEST_SCAN_BATCH_SIZE = 6;

async function discoveryCandidates(
  store: SigningRequestStore,
  address: string,
  network: StellarNetwork | undefined,
): Promise<StoredSigningRequest[]> {
  const proposer = network ? await store.listRequestsByProposer?.(network, address) ?? [] : [];
  let signers: StoredSigningRequest[];
  if (!network || !store.listRequestsByDiscoverySubjects) {
    signers = store.listRequests ? await store.listRequests() : [];
  } else {
    try {
      signers = await store.listRequestsByDiscoverySubjects(network, [], address);
    } catch {
      signers = store.listRequests ? await store.listRequests() : [];
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
  const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
  const accountCache = new Map<string, ReturnType<typeof loadAccount>>();
  const cachedAccountLoader: typeof loadAccount = (accountId, network) => {
    const key = `${network}:${accountId}`;
    const cached = accountCache.get(key);
    if (cached) return cached;
    const pending = accountLoader(accountId, network);
    accountCache.set(key, pending);
    return pending;
  };

  const requests = (await discoveryCandidates(store, address, options.network))
    .filter((request) => isValidSigningRequestId(request.id))
    .filter((request) => (!options.network || request.network === options.network))
    .filter((request) => new Date(request.expiresAt).getTime() > now.getTime())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const visible: SigningRequestSnapshot[] = [];
  for (let index = 0; index < requests.length && visible.length < limit; index += REQUEST_SCAN_BATCH_SIZE) {
    const batch = requests.slice(index, index + REQUEST_SCAN_BATCH_SIZE);
    const snapshots = await Promise.all(batch.map(async (request): Promise<SigningRequestSnapshot | null> => {
      let authorized = request.proposerAddress === address;
      try {
        if (!authorized) authorized = await signerCanAccessTransaction(
          address,
          request.baseXdr,
          request.network,
          cachedAccountLoader,
        );
      } catch {
        return null;
      }
      if (!authorized) return null;

      const snapshot = await getSigningRequest(store, request.id, {
        now,
        accountLoader: cachedAccountLoader,
        networkParametersLoader,
      });
      if (snapshot.status === 'submitted' || snapshot.status === 'expired') return null;
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


/** Personal work for a User ID is independent of any wallet signer rights. */
export async function listUserProposerInbox(
  store: SigningRequestStore,
  userId: string,
  network: StellarNetwork,
  options: InboxOptions = {},
): Promise<SigningRequestSnapshot[]> {
  const requests = await store.listRequestsByProposerUser?.(network, userId) ?? [];
  const now = options.now ?? new Date();
  const active = requests.filter((request) => request.proposerUserId === userId && request.network === network
    && new Date(request.expiresAt).getTime() > now.getTime())
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 100);
  const values = await Promise.all(active.map((item) => getSigningRequest(store, item.id, {
    now, accountLoader: options.accountLoader ?? loadAccount,
    networkParametersLoader: options.networkParametersLoader ?? loadNetworkParameters,
  })));
  return values.filter((item) => item.status !== 'submitted' && item.status !== 'expired');
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
  viewerUserId?: string,
): Promise<InboxRequestSnapshot[]> {
  return Promise.all(requests.map(async (snapshot) => {
    const declined = snapshot.status === 'awaiting_signatures' && store.listActivityEvents
      ? (await store.listActivityEvents(snapshot.id)).some((event) =>
          event.type === 'approval_declined' && event.actorAddress === address,
        )
      : false;
    const viewerIsProposer = (viewerUserId && snapshot.proposerUserId === viewerUserId)
      || (address && snapshot.proposerAddress === address);
    const viewerAction = viewerIsProposer
      ? snapshot.status === 'awaiting_signatures' ? 'proposer_waiting' as const
        : snapshot.status === 'ready' ? 'proposer_ready' as const
          : projectInboxViewerAction(snapshot.status, { hasSigned: true,
              executionMode: projectedRequestExecutionMode(snapshot) })
      : projectInboxViewerAction(snapshot.status, {
      hasSigned: signerHasSignedTransaction(address, snapshot.mergedXdr, snapshot.network),
      declined,
      executionMode: projectedRequestExecutionMode(snapshot),
    });
    const coordinationEvents = address && (viewerAction === 'waiting_for_others' || viewerAction === 'proposer_waiting') && store.listRequestCoordinationEvents
      ? outgoingCoordinationEvents(await store.listRequestCoordinationEvents(snapshot.id), address)
      : [];
    return {
      ...snapshot,
      viewerAction,
      ...(coordinationEvents.length > 0 ? { coordinationEvents } : {}),
    };
  }));
}
