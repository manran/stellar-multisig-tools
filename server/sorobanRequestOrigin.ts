import type { SorobanRequestOrigin } from '../src/stellar/requestTypes.js';
import type { StellarNetwork } from '../src/stellar/types.js';
import { isValidSigningRequestId } from './requestLocator.js';
import type { SorobanIntentStore } from './sorobanIntentStore.js';

export class SorobanRequestOriginError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'SorobanRequestOriginError';
  }
}

export async function verifySorobanRequestOrigin(
  store: SorobanIntentStore,
  input: { intentId: string; network: StellarNetwork; transactionHash: string },
): Promise<SorobanRequestOrigin> {
  const intentId = input.intentId.trim();
  if (!isValidSigningRequestId(intentId)) {
    throw new SorobanRequestOriginError('Invalid Soroban Intent id.', 400, 'invalid_soroban_intent_id');
  }
  const intent = await store.getIntent(intentId);
  if (!intent || intent.network !== input.network) {
    throw new SorobanRequestOriginError('No matching Soroban Intent exists on this network.', 409, 'soroban_intent_origin_mismatch');
  }
  if (intent.executionPolicy?.mode === 'external') {
    throw new SorobanRequestOriginError('This Soroban Intent is reserved for external execution and cannot enter a MultiSigTools Proposal.', 409, 'external_executor_required');
  }
  if (!store.listExecutionPreparations) {
    throw new SorobanRequestOriginError('Soroban execution evidence storage is unavailable.', 503, 'intent_execution_evidence_unavailable');
  }
  const preparations = await store.listExecutionPreparations(intentId);
  const currentRevision = intent.authorizationPlanRevision ?? 1;
  const match = [...preparations].reverse().find((item) =>
    item.transactionHash === input.transactionHash
    && item.authorizationPlanDigest === intent.authorizationPlan.authorizationPlanDigest
    && item.authorizationPlanRevision === currentRevision,
  );
  if (!match) {
    throw new SorobanRequestOriginError('This transaction was not produced by the current durable execution preparation for the supplied Soroban Intent.', 409, 'soroban_intent_origin_mismatch');
  }
  return {
    version: 1,
    intentId,
    authorizationPlanDigest: match.authorizationPlanDigest,
    authorizationPlanRevision: match.authorizationPlanRevision,
    executionPreparedAt: match.preparedAt,
    effectsDigest: match.effectsDigest,
  };
}
