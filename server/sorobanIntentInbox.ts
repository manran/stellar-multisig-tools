import type { InboxSorobanIntentSnapshot } from '../src/stellar/sorobanIntentApiTypes.js';
import type { StellarNetwork } from '../src/stellar/types.js';
import { loadAccount, loadNetworkParameters } from '../src/stellar/horizon.js';
import { getSorobanIntentAuthorization } from './sorobanIntentAuthorizationService.js';
import type { SorobanIntentStore, StoredSorobanIntent } from './sorobanIntentStore.js';

type AccountLoader = typeof loadAccount;
type NetworkParametersLoader = typeof loadNetworkParameters;

interface IntentInboxOptions {
  accountLoader?: AccountLoader;
  networkParametersLoader?: NetworkParametersLoader;
}

function isLiveParticipant(
  stored: StoredSorobanIntent,
  address: string,
  authorization: Awaited<ReturnType<typeof getSorobanIntentAuthorization>>,
): boolean {
  return stored.creatorAddress === address || authorization.authorizers.some((authorizer) =>
    authorizer.activeSigners.some((signer) => signer.publicKey === address),
  );
}

export function projectSorobanIntentViewerAction(
  authorization: Awaited<ReturnType<typeof getSorobanIntentAuthorization>>,
  address: string,
  externalExecution = false,
): InboxSorobanIntentSnapshot['viewerAction'] {
  if (authorization.status === 'blocked' || authorization.status === 'expired') return 'attention';
  if (authorization.status === 'authorization_ready') return externalExecution ? 'waiting' : 'execute';
  return authorization.authorizers.some((authorizer) =>
    !authorizer.ready
    && authorizer.activeSigners.some((signer) => signer.publicKey === address)
    && !authorizer.signerEvidence.some((signer) => signer.publicKey === address),
  ) ? 'authorize' : 'waiting';
}

function snapshot(
  stored: StoredSorobanIntent,
  authorization: Awaited<ReturnType<typeof getSorobanIntentAuthorization>>,
  address: string,
): InboxSorobanIntentSnapshot {
  return {
    id: stored.id,
    network: stored.network,
    createdAt: stored.createdAt,
    ...(stored.creatorAddress ? { creatorAddress: stored.creatorAddress } : {}),
    ...(stored.creatorActor ? { creatorActor: stored.creatorActor } : {}),
    status: authorization.status,
    ...(authorization.statusDetail ? { statusDetail: authorization.statusDetail } : {}),
    contributionCount: authorization.contributionCount,
    authorizers: authorization.authorizers,
    viewerAction: projectSorobanIntentViewerAction(
      authorization,
      address,
      stored.executionPolicy?.mode === 'external',
    ),
  };
}

export async function listSorobanIntentInbox(
  store: SorobanIntentStore,
  address: string,
  network: StellarNetwork,
  options: IntentInboxOptions = {},
): Promise<InboxSorobanIntentSnapshot[]> {
  if (!store.listIntentsBySigner) return [];
  const records = await store.listIntentsBySigner(network, address);
  const values = await Promise.all(records.map(async (stored) => {
    try {
      const authorization = await getSorobanIntentAuthorization(store, stored.id, options);
      if (!isLiveParticipant(stored, address, authorization)) return null;
      return snapshot(stored, authorization, address);
    } catch {
      return null;
    }
  }));
  return values
    .filter((value): value is InboxSorobanIntentSnapshot => Boolean(value))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
