import { createHash } from 'node:crypto';
import { isValidStellarAccountId } from '../../../../src/stellar/horizon.js';
import type { SorobanExecutorBinding, SorobanExecutionPolicy } from '../../../../src/stellar/executionPolicy.js';
import type { StellarNetwork } from '../../../../src/stellar/types.js';
import { buildContractIntent } from './contractIntentService.js';
import type { ConfiguredIntegrationCredential } from './integrationCredentialService.js';
import { integrationCallerForCredential } from './integrationCredentialService.js';
import { BoxServiceError, normalizeExternalReference, normalizeIdempotencyKey } from './boxService.js';
import { encodeSigningRequestId } from './requestLocator.js';
import { planSorobanIntentForStorage } from './sorobanIntentPlanningService.js';
import { createStoredSorobanIntent } from './sorobanIntentService.js';
import type { SorobanIntentStore, StoredSorobanIntent } from './sorobanIntentStore.js';

interface IntegrationSorobanIntentOptions {
  planningSource: string;
  now?: Date;
  contractDependencies?: Parameters<typeof buildContractIntent>[1];
  planningDependencies?: Parameters<typeof planSorobanIntentForStorage>[2];
  intentIdFactory?: (serviceId: string, idempotencyKey: string) => string;
}

export interface IntegrationSorobanIntentCreationResult {
  replayed: boolean;
  intent: StoredSorobanIntent;
  externalReference?: string;
}

function deterministicIntentId(serviceId: string, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update('multisigtools/integration-intent/v1\0')
    .update(serviceId)
    .update('\0')
    .update(idempotencyKey)
    .digest();
  return encodeSigningRequestId(digest.subarray(0, 10));
}

function assertNetworkAllowed(
  credential: ConfiguredIntegrationCredential,
  network: StellarNetwork,
): void {
  if (!credential.networks.includes(network)) {
    throw new BoxServiceError(
      'This Integration credential is not allowed on this Stellar network.',
      403,
      'integration_network_not_allowed',
    );
  }
}

function assertContractAllowed(
  credential: ConfiguredIntegrationCredential,
  contractId: string,
  method: string,
): void {
  const contract = credential.sorobanContracts.find((item) => item.contractId === contractId);
  if (!contract || !contract.methods.includes(method)) {
    throw new BoxServiceError(
      'This Integration credential is not allowed to create this Soroban contract call.',
      403,
      'integration_contract_call_not_allowed',
    );
  }
}

export function assertIntegrationSorobanExecutionAccount(
  credential: ConfiguredIntegrationCredential,
  network: StellarNetwork,
  executionSource: string,
): void {
  assertNetworkAllowed(credential, network);
  if (!credential.sorobanExecutionAccounts.includes(executionSource)) {
    throw new BoxServiceError(
      'This Integration credential is not allowed to use that Soroban execution account.',
      403,
      'integration_execution_account_not_allowed',
    );
  }
}

function optionalExecutor(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const executor = typeof value === 'string' ? value.trim() : '';
  if (!isValidStellarAccountId(executor)) {
    throw new BoxServiceError('Executor must be a valid Stellar G... account.', 400, 'invalid_execution_account');
  }
  return executor;
}

export function integrationSorobanExecutionPolicyForCreation(
  credential: ConfiguredIntegrationCredential,
  network: StellarNetwork,
  requestedExecutor: unknown,
): SorobanExecutionPolicy {
  const executor = optionalExecutor(requestedExecutor);
  if (executor) {
    assertIntegrationSorobanExecutionAccount(credential, network, executor);
    return { mode: 'external', executor: { address: executor, source: 'intent' } };
  }
  if (credential.sorobanDefaultExecutor) {
    assertIntegrationSorobanExecutionAccount(credential, network, credential.sorobanDefaultExecutor);
    return { mode: 'external', executor: { address: credential.sorobanDefaultExecutor, source: 'service_default' } };
  }
  return { mode: 'external', fallback: 'multisigtools_managed' };
}

function assertReplayMatches(
  stored: StoredSorobanIntent,
  credential: ConfiguredIntegrationCredential,
  input: { network: StellarNetwork; intentDigest: string; externalReference?: string; requestedExecutor?: string },
): void {
  const storedRequestedExecutor = stored.executionPolicy?.executor?.source === 'intent'
    ? stored.executionPolicy.executor.address
    : undefined;
  if (
    stored.network !== input.network
    || stored.intent.intentDigest !== input.intentDigest
    || stored.integration?.serviceId !== credential.serviceId
    || stored.integration.correlationId !== input.externalReference
    || storedRequestedExecutor !== input.requestedExecutor
  ) {
    throw new BoxServiceError(
      'Idempotency key is already bound to a different Integration Intent.',
      409,
      'idempotency_conflict',
    );
  }
}

export async function resolveAndBindIntegrationSorobanExecutor(
  store: SorobanIntentStore,
  stored: StoredSorobanIntent,
  credential: ConfiguredIntegrationCredential,
  requestedExecutor: unknown,
  managedExecutor: string | null,
): Promise<{ intent: StoredSorobanIntent; executor: SorobanExecutorBinding }> {
  const requested = optionalExecutor(requestedExecutor);
  const existing = stored.executionPolicy?.executor;
  if (existing) {
    if (requested && requested !== existing.address) {
      throw new BoxServiceError(
        'This Soroban Intent already has a bound executor. Refresh must reuse the same executor.',
        409,
        'intent_executor_locked',
      );
    }
    if (existing.source !== 'multisigtools_managed') {
      assertIntegrationSorobanExecutionAccount(credential, stored.network, existing.address);
    }
    return { intent: stored, executor: existing };
  }

  let executor: SorobanExecutorBinding;
  let executionPolicy: SorobanExecutionPolicy;
  if (requested) {
    assertIntegrationSorobanExecutionAccount(credential, stored.network, requested);
    executor = { address: requested, source: 'service_prepare' };
    executionPolicy = { mode: 'external', executor };
  } else {
    if (!managedExecutor || !isValidStellarAccountId(managedExecutor)) {
      throw new BoxServiceError(
        'No Service executor is bound and MultiSigTools managed execution is not configured for this network.',
        503,
        'managed_executor_not_configured',
      );
    }
    executor = { address: managedExecutor, source: 'multisigtools_managed' };
    executionPolicy = { mode: 'multisigtools', executor };
  }
  if (!store.bindExecutionPolicy) {
    throw new BoxServiceError(
      'Soroban executor binding storage is unavailable.',
      503,
      'intent_executor_binding_unavailable',
    );
  }
  const boundPolicy = await store.bindExecutionPolicy(stored.id, executionPolicy);
  const boundExecutor = boundPolicy.executor;
  if (!boundExecutor) {
    throw new BoxServiceError('Soroban executor binding is invalid.', 503, 'intent_executor_binding_unavailable');
  }
  if (requested && requested !== boundExecutor.address) {
    throw new BoxServiceError(
      'This Soroban Intent already has a bound executor. Refresh must reuse the same executor.',
      409,
      'intent_executor_locked',
    );
  }
  if (boundExecutor.source !== 'multisigtools_managed') {
    assertIntegrationSorobanExecutionAccount(credential, stored.network, boundExecutor.address);
  }
  const updated = { ...stored, executionPolicy: boundPolicy };
  return { intent: updated, executor: boundExecutor };
}

export async function createIntegrationSorobanIntent(
  store: SorobanIntentStore,
  credential: ConfiguredIntegrationCredential,
  input: {
    network: StellarNetwork;
    contractId: unknown;
    method: unknown;
    arguments: unknown;
    idempotencyKey: string;
    externalReference?: unknown;
    executor?: unknown;
  },
  options: IntegrationSorobanIntentOptions,
): Promise<IntegrationSorobanIntentCreationResult> {
  assertNetworkAllowed(credential, input.network);
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const externalReference = normalizeExternalReference(input.externalReference);
  const requestedExecutor = optionalExecutor(input.executor);
  const built = await buildContractIntent({
    network: input.network,
    contractId: input.contractId,
    method: input.method,
    arguments: input.arguments,
  }, options.contractDependencies);
  assertContractAllowed(credential, built.contractId, built.method);

  const id = options.intentIdFactory?.(credential.serviceId, idempotencyKey)
    ?? deterministicIntentId(credential.serviceId, idempotencyKey);
  const replayInput = {
    network: input.network,
    intentDigest: built.intent.intentDigest,
    ...(externalReference ? { externalReference } : {}),
    ...(requestedExecutor ? { requestedExecutor } : {}),
  };
  const existing = await store.getIntent(id);
  if (existing) {
    assertReplayMatches(existing, credential, replayInput);
    return { replayed: true, intent: existing, ...(externalReference ? { externalReference } : {}) };
  }

  const executionPolicy = integrationSorobanExecutionPolicyForCreation(credential, input.network, requestedExecutor);
  const planned = await planSorobanIntentForStorage(
    built.intent,
    options.planningSource,
    options.planningDependencies,
  );
  let durableWriteAttempted = false;
  const guardedStore: SorobanIntentStore = {
    ...store,
    createIntent: async (value) => {
      durableWriteAttempted = true;
      await store.createIntent(value);
    },
  };
  try {
    const intent = await createStoredSorobanIntent(guardedStore, {
      intent: built.intent,
      authorizationPlan: planned.authorizationPlan,
      creatorActor: integrationCallerForCredential(credential),
      discoverySignerKeys: planned.discoverySignerKeys,
      integration: {
        version: 1,
        serviceId: credential.serviceId,
        serviceLabel: credential.label,
        ...(externalReference ? { correlationId: externalReference } : {}),
      },
      executionPolicy,
      externalReference,
    }, {
      now: options.now,
      idFactory: () => id,
    });
    return { replayed: false, intent, ...(externalReference ? { externalReference } : {}) };
  } catch (cause) {
    if (!durableWriteAttempted) throw cause;
    const recovered = await store.getIntent(id);
    if (!recovered) throw cause;
    assertReplayMatches(recovered, credential, replayInput);
    return { replayed: true, intent: recovered, ...(externalReference ? { externalReference } : {}) };
  }
}
