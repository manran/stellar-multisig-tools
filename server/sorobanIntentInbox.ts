import type { InboxSorobanIntentSnapshot } from '../src/stellar/sorobanIntentApiTypes.js';
import type { StellarNetwork } from '../src/stellar/types.js';
import { loadAccount, loadNetworkParameters } from '../src/stellar/horizon.js';
import { getSorobanIntentAuthorization } from './sorobanIntentAuthorizationService.js';
import type {
  SorobanIntentStore,
  StoredSorobanIntent,
  StoredSorobanIntentExecutionObservation,
  StoredSorobanIntentExecutionPreparation,
} from './sorobanIntentStore.js';

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
  integrationOwnedExecution = false,
  executionFailed = false,
): InboxSorobanIntentSnapshot['viewerAction'] {
  if (authorization.status === 'blocked' || authorization.status === 'expired') return 'attention';
  if (authorization.status === 'authorization_ready' && executionFailed) return 'execution_failed';
  if (authorization.status === 'authorization_ready') return integrationOwnedExecution ? 'waiting_execution' : 'route_execution';
  return authorization.authorizers.some((authorizer) =>
    !authorizer.ready
    && authorizer.activeSigners.some((signer) => signer.publicKey === address)
    && !authorizer.signerEvidence.some((signer) => signer.publicKey === address),
  ) ? 'authorize' : 'waiting';
}

function latestPreparation(
  preparations: readonly StoredSorobanIntentExecutionPreparation[],
): StoredSorobanIntentExecutionPreparation | undefined {
  const ordered = [...preparations].sort((left, right) =>
    left.preparedAt.localeCompare(right.preparedAt)
    || left.transactionHash.localeCompare(right.transactionHash));
  return ordered[ordered.length - 1];
}

function executionEvidenceState(
  preparations: readonly StoredSorobanIntentExecutionPreparation[],
  observations: readonly StoredSorobanIntentExecutionObservation[],
): 'confirmed' | 'failed' | 'pending' {
  if (observations.some((item) => item.successful)) return 'confirmed';
  const latest = latestPreparation(preparations);
  if (!latest) return 'pending';
  return observations.some((item) => item.transactionHash === latest.transactionHash && !item.successful)
    ? 'failed'
    : 'pending';
}

function snapshot(
  stored: StoredSorobanIntent,
  authorization: Awaited<ReturnType<typeof getSorobanIntentAuthorization>>,
  address: string,
  executionFailed = false,
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
      Boolean(stored.integration),
      executionFailed,
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
      const [authorization, preparations, observations] = await Promise.all([
        getSorobanIntentAuthorization(store, stored.id, options),
        store.listExecutionPreparations?.(stored.id) ?? Promise.resolve([]),
        store.listExecutionObservations?.(stored.id) ?? Promise.resolve([]),
      ]);
      if (!isLiveParticipant(stored, address, authorization)) return null;
      const executionState = executionEvidenceState(preparations, observations);
      if (executionState === 'confirmed') return null;
      return snapshot(stored, authorization, address, executionState === 'failed');
    } catch {
      return null;
    }
  }));
  return values
    .filter((value): value is InboxSorobanIntentSnapshot => Boolean(value))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
