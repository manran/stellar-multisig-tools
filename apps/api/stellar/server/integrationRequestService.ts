import { createHash } from 'node:crypto';
import type { Keypair } from '@stellar/stellar-sdk/base';
import type { PrivateCommitmentRecord } from '../../../../src/stellar/privateCommitment.js';
import { loadNetworkParameters } from '../../../../src/stellar/horizon.js';
import { normalizeClassicPaymentInstruction, prepareClassicPayment, type ClassicPaymentInstruction } from '../../../../src/stellar/classicPaymentPrepare.js';
import type { SigningRequestSnapshot } from '../../../../src/stellar/requestTypes.js';
import type { StellarNetwork } from '../../../../src/stellar/types.js';
import { inspectTransactionXdr } from '../../../../src/stellar/transactionXdr.js';
import type { ConfiguredIntegrationCredential } from './integrationCredentialService.js';
import { integrationCallerForCredential } from './integrationCredentialService.js';
import {
  BoxServiceError,
  normalizeExternalReference,
  normalizeIdempotencyKey,
} from './boxService.js';
import { encodeSigningRequestId } from './requestLocator.js';
import {
  createSigningRequest,
  getSigningRequest,
  type AccountLoader,
  type NetworkParametersLoader,
} from './requestService.js';
import type { SigningRequestStore, StoredSigningRequest } from './requestStore.js';
import type { ClassicManagedChannelLeaseStore } from './classicManagedChannelStore.js';
import {
  ClassicManagedChannelServiceError,
  reserveClassicManagedChannel,
  signClassicManagedTransaction,
} from './classicManagedChannelService.js';

const MANAGED_CLASSIC_FEE_MULTIPLIER = 50;

interface IntegrationRequestOptions {
  now?: Date;
  accountLoader?: AccountLoader;
  networkParametersLoader?: NetworkParametersLoader;
  requestIdFactory?: (serviceId: string, idempotencyKey: string) => string;
  managedChannelStoreFactory?: () => ClassicManagedChannelLeaseStore;
  managedChannels?: Keypair[];
}

export interface IntegrationRequestCreationResult {
  replayed: boolean;
  request: SigningRequestSnapshot;
  externalReference?: string;
}

function deterministicRequestId(serviceId: string, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update('multisigtools/integration-request/v1\0')
    .update(serviceId)
    .update('\0')
    .update(idempotencyKey)
    .digest();
  return encodeSigningRequestId(digest.subarray(0, 10));
}

function integrationClassicExecutionMode(
  credential: ConfiguredIntegrationCredential,
  network: StellarNetwork,
  xdr: string,
  managedTransactionSource?: string,
): 'multisigtools' | 'external' {
  let inspection;
  try { inspection = inspectTransactionXdr(xdr, network); } catch (cause) {
    throw new BoxServiceError(cause instanceof Error ? cause.message : 'Invalid transaction envelope XDR.', 400, 'invalid_xdr');
  }
  if (!credential.networks.includes(network)) {
    throw new BoxServiceError(
      'This Integration credential is not allowed on this Stellar network.',
      403,
      'integration_network_not_allowed',
    );
  }
  if (managedTransactionSource) {
    if (
      inspection.envelopeType !== 'transaction'
      || inspection.transactionSourceAccount !== managedTransactionSource
      || inspection.innerSignatureCount !== 1
      || inspection.outerSignatureCount !== 0
    ) {
      throw new BoxServiceError(
        'Managed Classic semantic input must contain exactly the reserved MultiSigTools transaction-source signature.',
        500,
        'managed_classic_signature_invalid',
      );
    }
  } else if (inspection.innerSignatureCount > 0 || inspection.outerSignatureCount > 0) {
    throw new BoxServiceError(
      'Integration-created Requests must start from unsigned transaction XDR.',
      400,
      'integration_signed_xdr_unsupported',
    );
  }
  if (inspection.operations.some((operation) => operation.type === 'invokeHostFunction')) {
    throw new BoxServiceError(
      'Create Soroban work through the Integration Intent API, not the Classic Request resource.',
      400,
      'integration_soroban_request_unsupported',
    );
  }
  const allowedAccounts = new Set(credential.classicSourceAccounts);
  const requiredAccounts = [...new Set<string>(inspection.sourceRequirements
    .map((item) => String(item.accountId))
    .filter((accountId) => accountId !== managedTransactionSource))];
  const deniedAccounts = requiredAccounts.filter((accountId) => !allowedAccounts.has(accountId));
  if (deniedAccounts.length > 0) {
    throw new BoxServiceError(
      `This Integration credential is not allowed to coordinate Classic authorization for ${deniedAccounts.join(', ')}.`,
      403,
      'integration_classic_source_account_not_allowed',
    );
  }
  const externalAccounts = new Set(credential.classicExternalExecutionSourceAccounts);
  const externalCount = requiredAccounts.filter((accountId) => externalAccounts.has(accountId)).length;
  if (externalCount > 0 && externalCount !== requiredAccounts.length) {
    throw new BoxServiceError(
      'One Classic Request cannot mix MultiSigTools-executed and externally executed authorization accounts.',
      403,
      'integration_classic_execution_policy_conflict',
    );
  }
  if (managedTransactionSource) return 'multisigtools';
  return externalCount === requiredAccounts.length ? 'external' : 'multisigtools';
}

function sameCommitment(
  stored: PrivateCommitmentRecord | undefined,
  input: PrivateCommitmentRecord | undefined,
): boolean {
  if (!stored || !input) return stored === input;
  return stored.text === input.text
    && stored.saltHex === input.saltHex
    && stored.hashHex === input.hashHex;
}

function assertReservedRequestMatchesInput(
  request: StoredSigningRequest,
  credential: ConfiguredIntegrationCredential,
  input: {
    network: StellarNetwork;
    xdr: string;
    externalReference?: string;
    privateCommitment?: PrivateCommitmentRecord;
    instructionDigest?: string;
    executionMode: 'multisigtools' | 'external';
  },
): void {
  const payloadMatches = input.instructionDigest
    ? request.instructionDigest === input.instructionDigest
    : request.baseXdr === input.xdr.trim();
  if (
    request.network !== input.network
    || !payloadMatches
    || request.integration?.serviceId !== credential.serviceId
    || request.executionPolicy?.mode !== input.executionMode
    || request.integration.correlationId !== input.externalReference
    || !sameCommitment(request.privateCommitment, input.privateCommitment)
  ) {
    throw new BoxServiceError(
      'Idempotency key is already bound to a different Integration Request.',
      409,
      'idempotency_conflict',
    );
  }
}

export async function createIntegrationSigningRequest(
  requestStore: SigningRequestStore,
  credential: ConfiguredIntegrationCredential,
  input: {
    network: StellarNetwork;
    xdr: string;
    idempotencyKey: string;
    externalReference?: unknown;
    privateCommitment?: PrivateCommitmentRecord;
    instructionDigest?: string;
    managedTransactionSource?: string;
  },
  options: IntegrationRequestOptions = {},
): Promise<IntegrationRequestCreationResult> {
  const now = options.now ?? new Date();
  const normalizedXdr = input.xdr.trim();
  const executionMode = integrationClassicExecutionMode(
    credential,
    input.network,
    normalizedXdr,
    input.managedTransactionSource,
  );
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const externalReference = normalizeExternalReference(input.externalReference);
  const requestId = options.requestIdFactory?.(credential.serviceId, idempotencyKey)
    ?? deterministicRequestId(credential.serviceId, idempotencyKey);
  const normalizedInput = {
    network: input.network,
    xdr: normalizedXdr,
    executionMode,
    ...(externalReference ? { externalReference } : {}),
    ...(input.privateCommitment ? { privateCommitment: input.privateCommitment } : {}),
    ...(input.instructionDigest ? { instructionDigest: input.instructionDigest } : {}),
  };

  const existing = await requestStore.getRequest(requestId);
  if (existing) {
    assertReservedRequestMatchesInput(existing, credential, normalizedInput);
    return {
      replayed: true,
      request: await getSigningRequest(requestStore, requestId, options),
      ...(externalReference ? { externalReference } : {}),
    };
  }

  let requestWriteAttempted = false;
  const actor = integrationCallerForCredential(credential);
  const contextualStore: SigningRequestStore = {
    ...requestStore,
    createRequest: async (stored) => {
      requestWriteAttempted = true;
      await requestStore.createRequest({
        ...stored,
        creatorActor: actor,
        integration: {
          version: 1,
          serviceId: credential.serviceId,
          serviceLabel: credential.label,
          ...(externalReference ? { correlationId: externalReference } : {}),
        },
        executionPolicy: { mode: executionMode },
        ...(input.instructionDigest ? { instructionDigest: input.instructionDigest } : {}),
        ...(input.privateCommitment
          ? { privateCommitment: { ...input.privateCommitment, createdAt: stored.createdAt } }
          : {}),
      });
    },
  };

  try {
    await createSigningRequest(
      contextualStore,
      { network: input.network, xdr: normalizedXdr },
      { ...options, now, idFactory: () => requestId },
    );
    const request = await getSigningRequest(requestStore, requestId, { ...options, now });
    return { replayed: false, request, ...(externalReference ? { externalReference } : {}) };
  } catch (cause) {
    if (!requestWriteAttempted) throw cause;
    const recovered = await requestStore.getRequest(requestId);
    if (!recovered) throw cause;
    assertReservedRequestMatchesInput(recovered, credential, normalizedInput);
    return {
      replayed: true,
      request: await getSigningRequest(requestStore, requestId, options),
      ...(externalReference ? { externalReference } : {}),
    };
  }
}


export interface IntegrationPaymentRequestCreationResult extends IntegrationRequestCreationResult {}

function classicInstructionDigest(value: ReturnType<typeof normalizeClassicPaymentInstruction>): string {
  return createHash('sha256')
    .update('multisigtools/classic-payment-instruction/v1\0')
    .update(JSON.stringify(value))
    .digest('hex');
}

export async function createIntegrationPaymentSigningRequest(
  requestStore: SigningRequestStore,
  credential: ConfiguredIntegrationCredential,
  input: {
    network: StellarNetwork;
    payment: Omit<ClassicPaymentInstruction, 'network'>;
    idempotencyKey: string;
    externalReference?: unknown;
  },
  options: IntegrationRequestOptions = {},
): Promise<IntegrationPaymentRequestCreationResult> {
  const normalized = normalizeClassicPaymentInstruction({ network: input.network, ...input.payment });
  if (!credential.networks.includes(normalized.network)) {
    throw new BoxServiceError(
      'This Integration credential is not allowed on this Stellar network.',
      403,
      'integration_network_not_allowed',
    );
  }
  if (!credential.classicSourceAccounts.includes(normalized.sourceAccount)) {
    throw new BoxServiceError(
      'This Integration credential is not allowed to coordinate Classic authorization for this source account.',
      403,
      'integration_classic_source_account_not_allowed',
    );
  }
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const externalReference = normalizeExternalReference(input.externalReference);
  const instructionDigest = classicInstructionDigest(normalized);
  const executionMode = credential.classicExternalExecutionSourceAccounts.includes(normalized.sourceAccount)
    ? 'external' as const
    : 'multisigtools' as const;
  const requestId = options.requestIdFactory?.(credential.serviceId, idempotencyKey)
    ?? deterministicRequestId(credential.serviceId, idempotencyKey);
  const existing = await requestStore.getRequest(requestId);
  if (existing) {
    assertReservedRequestMatchesInput(existing, credential, {
      network: normalized.network,
      xdr: existing.baseXdr,
      executionMode,
      instructionDigest,
      ...(externalReference ? { externalReference } : {}),
    });
    return {
      replayed: true,
      request: await getSigningRequest(requestStore, requestId, options),
      ...(externalReference ? { externalReference } : {}),
    };
  }

  if (executionMode === 'external') {
    const prepared = await prepareClassicPayment(normalized, {
      accountLoader: options.accountLoader,
      networkParametersLoader: options.networkParametersLoader,
    });
    return createIntegrationSigningRequest(requestStore, credential, {
      network: normalized.network,
      xdr: prepared.xdr,
      idempotencyKey,
      instructionDigest,
      ...(externalReference ? { externalReference } : {}),
    }, {
      ...options,
      requestIdFactory: () => requestId,
    });
  }

  const channelStore = options.managedChannelStoreFactory?.();
  if (!channelStore) {
    throw new ClassicManagedChannelServiceError(
      'MultiSigTools-managed Classic execution requires managed channel storage.',
      503,
      'managed_classic_execution_unavailable',
    );
  }

  const now = options.now ?? new Date();
  const leaseExpiresAt = new Date(
    now.getTime() + (normalized.lifetimeSeconds * 1000) + 60_000,
  ).toISOString();
  const channel = await reserveClassicManagedChannel(channelStore, {
    network: normalized.network,
    requestId,
    leaseExpiresAt,
  }, {
    now,
    accountLoader: options.accountLoader,
    channels: options.managedChannels,
  });

  try {
    const baseNetworkParametersLoader = options.networkParametersLoader ?? loadNetworkParameters;
    const prepared = await prepareClassicPayment(normalized, {
      accountLoader: options.accountLoader,
      networkParametersLoader: async (network) => {
        const parameters = await baseNetworkParametersLoader(network);
        return {
          ...parameters,
          baseFeeInStroops: parameters.baseFeeInStroops * MANAGED_CLASSIC_FEE_MULTIPLIER,
        };
      },
      transactionSource: {
        accountId: channel.accountId,
        sequence: channel.sequence,
        snapshot: channel.account,
      },
    });
    const signedXdr = signClassicManagedTransaction(prepared.xdr, normalized.network, channel);
    return await createIntegrationSigningRequest(requestStore, credential, {
      network: normalized.network,
      xdr: signedXdr,
      idempotencyKey,
      instructionDigest,
      managedTransactionSource: channel.accountId,
      ...(externalReference ? { externalReference } : {}),
    }, {
      ...options,
      now,
      requestIdFactory: () => requestId,
    });
  } catch (cause) {
    const durable = await requestStore.getRequest(requestId).catch(() => null);
    if (!durable) await channelStore.releaseRequest(requestId).catch(() => undefined);
    throw cause;
  }
}
