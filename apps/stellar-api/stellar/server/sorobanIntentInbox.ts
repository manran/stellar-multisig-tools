import { sorobanIntentCallTitle } from '../../../../packages/stellar-core/src/sorobanInspection.js';
import type { AgentAccessLevel } from '../../../../packages/stellar-core/src/agentAccessTypes.js';
import { projectSorobanAgentTask } from './agentTaskProjection.js';
import type { InboxSorobanIntentSnapshot } from '../../../../packages/stellar-core/src/sorobanIntentApiTypes.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';
import { loadAccount, loadNetworkParameters } from '../../../../packages/stellar-core/src/horizon.js';
import { getSorobanIntentAuthorization } from './sorobanIntentAuthorizationService.js';
import { compareInboxPageKeys, type InboxPageKey } from './inboxPage.js';
import { unresolvedSorobanPreparations } from './sorobanIntentStore.js';
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
  sourceAccountIds?: string[];
  after?: InboxPageKey;
  limit?: number;
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
  executionUnresolved = false,
): InboxSorobanIntentSnapshot['viewerAction'] {
  if (executionUnresolved) return 'reconcile_execution';
  if (authorization.status === 'cancelled') return 'cancelled';
  if (authorization.status === 'blocked' || authorization.status === 'expired') return 'attention';
  if (authorization.status === 'authorization_ready' && executionFailed) return 'execution_failed';
  if (authorization.status === 'authorization_ready') return integrationOwnedExecution ? 'waiting_execution' : 'route_execution';
  return authorization.authorizers.some((authorizer) =>
    !authorizer.ready
    && authorizer.activeSigners.some((signer) => signer.publicKey === address)
    && !authorizer.signerEvidence.some((signer) => signer.publicKey === address),
  ) ? 'sign' : 'waiting';
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
  unresolvedTransactionHashes: string[] = [],
): InboxSorobanIntentSnapshot {
  return {
    id: stored.id,
    callTitle: sorobanIntentCallTitle(stored.intent.hostFunctionXdr, stored.network, stored.reviewTokenMetadata),
    network: stored.network,
    createdAt: stored.createdAt,
    ...(stored.creatorAddress ? { creatorAddress: stored.creatorAddress } : {}),
    ...(stored.creatorActor ? { creatorActor: stored.creatorActor } : {}),
    status: authorization.status,
    ...(authorization.statusDetail ? { statusDetail: authorization.statusDetail } : {}),
    contributionCount: authorization.contributionCount,
    authorizers: authorization.authorizers,
    ...(unresolvedTransactionHashes.length ? { unresolvedTransactionHashes } : {}),
    viewerAction: projectSorobanIntentViewerAction(
      authorization,
      address,
      Boolean(stored.integration),
      executionFailed,
      unresolvedTransactionHashes.length > 0,
    ),
  };
}

async function pendingSorobanIntents(
  store: SorobanIntentStore,
  address: string,
  network: StellarNetwork,
  options: IntentInboxOptions,
) {
  if (!store.listIntentsBySigner) return [];
  const records = (await store.listIntentsBySigner(network, address, options.sourceAccountIds ?? []))
    .filter((stored) => stored.network === network && (!options.after
      || compareInboxPageKeys({ ...stored, kind: 'intent' }, options.after) > 0))
    .sort((a, b) => compareInboxPageKeys({ ...a, kind: 'intent' }, { ...b, kind: 'intent' }));
  const inspect = async (stored: StoredSorobanIntent) => {
    const [observations, preparations] = await Promise.all([
      store.listExecutionObservations?.(stored.id) ?? Promise.resolve([]),
      store.listExecutionPreparations?.(stored.id) ?? Promise.resolve([]),
    ]);
    const unresolvedTransactionHashes = unresolvedSorobanPreparations(preparations, observations).map((item) => item.transactionHash);
    if (observations.some((item) => item.successful) || (stored.cancellation && !unresolvedTransactionHashes.length)) return null;
    const authorization = await getSorobanIntentAuthorization(store, stored.id, options);
    if (!isLiveParticipant(stored, address, authorization)) return null;
    const executionState = executionEvidenceState(preparations, observations);
    if (executionState === 'confirmed' || (authorization.status === 'cancelled' && !unresolvedTransactionHashes.length)) return null;
    return { stored, authorization, preparations, observations, executionFailed: executionState === 'failed', unresolvedTransactionHashes };
  };
  const values: NonNullable<Awaited<ReturnType<typeof inspect>>>[] = [];
  const limit = options.limit ?? Infinity;
  for (let index = 0; index < records.length && values.length < limit; index += 6) {
    const batch = await Promise.all(records.slice(index, index + 6).map(inspect));
    for (const value of batch) {
      if (value) values.push(value);
      if (values.length >= limit) break;
    }
  }
  return values;
}

export async function listSorobanIntentInbox(
  store: SorobanIntentStore,
  address: string,
  network: StellarNetwork,
  options: IntentInboxOptions = {},
): Promise<InboxSorobanIntentSnapshot[]> {
  return (await pendingSorobanIntents(store, address, network, options)).map((item) =>
    snapshot(item.stored, item.authorization, address, item.executionFailed, item.unresolvedTransactionHashes));
}

export async function listAgentSorobanInbox(
  store: SorobanIntentStore,
  address: string,
  network: StellarNetwork,
  access: AgentAccessLevel,
  options: IntentInboxOptions = {},
) {
  const pending = await pendingSorobanIntents(store, address, network, options);
  return {
    intents: pending.map((item) => snapshot(item.stored, item.authorization, address, item.executionFailed, item.unresolvedTransactionHashes)),
    tasks: pending.map((item) => projectSorobanAgentTask({ ...item, principalAddress: address, credentialAccess: access })),
  };
}
