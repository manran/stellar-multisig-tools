import { sorobanIntentCallTitle } from '../../../../packages/stellar-core/src/sorobanInspection.js';
import type { SorobanIntentWorkActivityItem } from '../../../../packages/stellar-core/src/workActivityTypes.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';
import { projectSorobanIntentEvidence } from './sorobanIntentEvidence.js';
import type { SorobanIntentStore, StoredSorobanIntent } from './sorobanIntentStore.js';

function provenParticipant(
  stored: StoredSorobanIntent,
  address: string,
  signerAddresses: readonly string[],
): boolean {
  return stored.creatorAddress === address || signerAddresses.includes(address);
}

export async function listSorobanIntentActivityItems(
  store: SorobanIntentStore,
  address: string,
  network: StellarNetwork,
): Promise<SorobanIntentWorkActivityItem[]> {
  const lookup = store.listIntentsByActivitySigner ?? store.listIntentsBySigner;
  if (!lookup) return [];
  const candidates = await lookup.call(store, network, address);
  const items = await Promise.all(candidates.map(async (stored) => {
    if (stored.network !== network) return null;
    const [contributions, preparations, observations] = await Promise.all([
      store.listContributions(stored.id),
      store.listExecutionPreparations?.(stored.id) ?? Promise.resolve([]),
      store.listExecutionObservations?.(stored.id) ?? Promise.resolve([]),
    ]);
    if (!provenParticipant(stored, address, contributions.map((item) => item.signerAddress))) return null;
    const evidence = projectSorobanIntentEvidence(stored, contributions, preparations, observations);
    const activityAt = evidence.at(-1)?.occurredAt ?? stored.createdAt;
    return {
      kind: 'soroban_intent' as const,
      callTitle: sorobanIntentCallTitle(stored.intent.hostFunctionXdr, stored.network, stored.reviewTokenMetadata),
      workId: stored.id,
      activityAt,
      intentId: stored.id,
      network: stored.network,
      createdAt: stored.createdAt,
      intentDigest: stored.intent.intentDigest,
      evidence,
    };
  }));
  return items.filter((item): item is SorobanIntentWorkActivityItem => Boolean(item));
}
