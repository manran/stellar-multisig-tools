import { FeeBumpTransaction, Networks, TransactionBuilder, xdr } from '@stellar/stellar-sdk/base';
import {
  AccountNotFoundError,
  isValidStellarAccountId,
  loadAccount,
  loadNetworkParameters,
} from '../src/stellar/horizon.js';
import { materializeSorobanIntent } from '../src/stellar/sorobanIntent.js';
import { compareSorobanEffects, type SorobanEffectsDiff, type SorobanEffectsSnapshot } from '../src/stellar/sorobanEffects.js';
import {
  prepareEnforcedSorobanTransaction,
  SorobanSimulationError,
} from '../src/stellar/sorobanRpc.js';
import {
  getSorobanIntentAuthorization,
  type SorobanIntentAuthorizationSnapshot,
} from './sorobanIntentAuthorizationService.js';
import type { SorobanIntentStore } from './sorobanIntentStore.js';

export class SorobanIntentExecutionServiceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly details?: unknown) {
    super(message);
    this.name = 'SorobanIntentExecutionServiceError';
  }
}

type AccountLoader = typeof loadAccount;
type NetworkParametersLoader = typeof loadNetworkParameters;
type Enforcer = typeof prepareEnforcedSorobanTransaction;
interface ExecutionOptions {
  authorization?: SorobanIntentAuthorizationSnapshot;
  accountLoader?: AccountLoader;
  networkParametersLoader?: NetworkParametersLoader;
  enforcer?: Enforcer;
  lifetimeSeconds?: number;
  acceptedEffectsDigest?: string;
}

export interface SorobanIntentExecutionPreparation {
  version: 1;
  intentId: string;
  network: 'public' | 'testnet';
  intentDigest: string;
  authorizationPlanDigest: string;
  executionSource: string;
  transactionSequence: string;
  transactionHash: string;
  validUntil: string | null;
  latestLedger: number;
  effectsDiff: SorobanEffectsDiff;
  effects: SorobanEffectsSnapshot;
  effectsAccepted: boolean;
  xdr: string;
}

export async function prepareSorobanIntentExecution(
  store: SorobanIntentStore,
  id: string,
  executionSource: string,
  options: ExecutionOptions = {},
): Promise<SorobanIntentExecutionPreparation> {
  const sourceAddress = executionSource.trim();
  if (!isValidStellarAccountId(sourceAddress)) {
    throw new SorobanIntentExecutionServiceError('A valid Stellar execution source is required.', 400, 'invalid_execution_source');
  }
  const stored = await store.getIntent(id);
  if (!stored) {
    throw new SorobanIntentExecutionServiceError('Soroban Intent not found.', 404, 'intent_not_found');
  }
  const authorization = options.authorization ?? await getSorobanIntentAuthorization(store, id);
  if (authorization.status !== 'authorization_ready') {
    throw new SorobanIntentExecutionServiceError(
      'Soroban Intent authorization is not ready for execution.',
      409,
      'intent_authorization_not_ready',
    );
  }

  let source;
  try {
    source = await (options.accountLoader ?? loadAccount)(sourceAddress, stored.network);
  } catch (cause) {
    if (cause instanceof AccountNotFoundError) {
      throw new SorobanIntentExecutionServiceError(cause.message, 404, 'execution_source_not_found');
    }
    throw cause;
  }
  const parameters = await (options.networkParametersLoader ?? loadNetworkParameters)(stored.network);
  const authEntries = authorization.authorizationEntriesXdr.map((value) =>
    xdr.SorobanAuthorizationEntry.fromXdr(value, 'base64'));
  const candidate = materializeSorobanIntent({
    intent: stored.intent,
    sourceAccount: source.accountId,
    sourceSequence: source.sequence,
    fee: String(parameters.baseFeeInStroops),
    lifetimeSeconds: options.lifetimeSeconds ?? 300,
    authorizationEntries: authEntries,
  });
  let enforced;
  try {
    enforced = await (options.enforcer ?? prepareEnforcedSorobanTransaction)({
      envelopeXdr: candidate.toXDR(),
      network: stored.network,
    });
  } catch (cause) {
    if (cause instanceof SorobanSimulationError) {
      const invalid = cause.kind === 'invalid' || cause.kind === 'unsupported';
      throw new SorobanIntentExecutionServiceError(
        cause.message,
        invalid ? 400 : 503,
        invalid ? 'intent_execution_invalid' : 'intent_execution_unavailable',
      );
    }
    throw cause;
  }

  const expectedEffects = stored.authorizationPlan.effects;
  if (!expectedEffects?.digest) {
    throw new SorobanIntentExecutionServiceError(
      'This Soroban Intent has no reviewed simulation-effects baseline. Refresh authorization before preparing execution.',
      409,
      'intent_effects_unavailable',
    );
  }
  const effectsDiff = compareSorobanEffects(expectedEffects, enforced.effects);
  if (effectsDiff.requiresReauthorization) {
    throw new SorobanIntentExecutionServiceError(
      'Final simulation changed the structure of the reviewed effects. Refresh the authorization plan, review the new effects, and collect fresh AUTH before preparing the transaction.',
      409,
      'intent_execution_effects_reauthorization_required',
      { effectsDiff },
    );
  }
  const acceptedEffectsDigest = options.acceptedEffectsDigest?.trim() ?? '';
  const effectsAccepted = effectsDiff.requiresExplicitReview
    && acceptedEffectsDigest === enforced.effects.digest;
  if (effectsDiff.requiresExplicitReview && !effectsAccepted) {
    throw new SorobanIntentExecutionServiceError(
      'Final simulation numeric effects changed materially. Review the percentage differences and explicitly accept the current effects before preparing the transaction.',
      409,
      'intent_execution_effects_review_required',
      { effectsDiff },
    );
  }

  const prepared = TransactionBuilder.fromXdr(
    enforced.assembledXdr,
    stored.network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC,
  );
  if (prepared instanceof FeeBumpTransaction || prepared.source !== source.accountId) {
    throw new SorobanIntentExecutionServiceError('Prepared execution changed its transaction source.', 503, 'intent_execution_unavailable');
  }
  return {
    version: 1,
    intentId: stored.id,
    network: stored.network,
    intentDigest: stored.intent.intentDigest,
    authorizationPlanDigest: stored.authorizationPlan.authorizationPlanDigest,
    executionSource: source.accountId,
    transactionSequence: prepared.sequence,
    transactionHash: Buffer.from(prepared.hash()).toString('hex'),
    validUntil: prepared.timeBounds?.maxTime ? new Date(Number(prepared.timeBounds.maxTime) * 1000).toISOString() : null,
    latestLedger: enforced.latestLedger,
    effectsDiff,
    effects: enforced.effects,
    effectsAccepted,
    xdr: enforced.assembledXdr,
  };
}
