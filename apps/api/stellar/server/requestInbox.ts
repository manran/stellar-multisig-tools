import { loadAccount, loadNetworkParameters } from '../../../../src/stellar/horizon.js';
import type { StellarNetworkParameters } from '../../../../src/stellar/horizon.js';
import type { StellarNetwork } from '../../../../src/stellar/types.js';
import type { InboxRequestSnapshot } from '../../../../src/stellar/inboxPresentation.js';
import { projectInboxViewerAction } from '../../../../src/stellar/inboxPresentation.js';
import type { SigningRequestSnapshot } from '../../../../src/stellar/requestTypes.js';
import { isValidSigningRequestId } from './requestLocator.js';
import type { SigningRequestStore, StoredSigningRequest } from './requestStore.js';
import { getSigningRequest } from './requestService.js';
import { signerCanAccessTransaction, signerHasSignedTransaction } from './requestAccess.js';
import { inspectTransactionXdr } from '../../../../src/stellar/transactionXdr.js';

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
  if (!network || !store.listRequestsByDiscoverySubjects) {
    return store.listRequests ? store.listRequests() : [];
  }

  try {
    return await store.listRequestsByDiscoverySubjects(network, [], address);
  } catch {
    // Discovery is an optimization, not authorization or availability truth.
    // Fall back to the legacy Request scan; live authorization below still
    // prevents stale index data from exposing private Request content.
    return store.listRequests ? store.listRequests() : [];
  }
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
      let authorized = false;
      try {
        authorized = await signerCanAccessTransaction(
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

export async function projectHumanInboxRequests(
  store: SigningRequestStore,
  address: string,
  requests: readonly SigningRequestSnapshot[],
): Promise<InboxRequestSnapshot[]> {
  return Promise.all(requests.map(async (snapshot) => {
    const declined = snapshot.status === 'awaiting_signatures' && store.listActivityEvents
      ? (await store.listActivityEvents(snapshot.id)).some((event) =>
          event.type === 'approval_declined' && event.actorAddress === address,
        )
      : false;
    return {
      ...snapshot,
      viewerAction: projectInboxViewerAction(snapshot.status, {
        hasSigned: signerHasSignedTransaction(address, snapshot.mergedXdr, snapshot.network),
        declined,
        executionMode: projectedRequestExecutionMode(snapshot),
      }),
    };
  }));
}
