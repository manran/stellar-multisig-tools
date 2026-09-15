import { createHash } from 'node:crypto';
import type { PrivateCommitmentRecord } from '../src/stellar/privateCommitment.js';
import type { SigningRequestSnapshot } from '../src/stellar/requestTypes.js';
import type { StellarNetwork } from '../src/stellar/types.js';
import { inspectTransactionXdr } from '../src/stellar/transactionXdr.js';
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

interface IntegrationRequestOptions {
  now?: Date;
  accountLoader?: AccountLoader;
  networkParametersLoader?: NetworkParametersLoader;
  requestIdFactory?: (serviceId: string, idempotencyKey: string) => string;
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
  if (inspection.innerSignatureCount > 0 || inspection.outerSignatureCount > 0) {
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
  const requiredAccounts = [...new Set<string>(inspection.sourceRequirements.map((item) => String(item.accountId)))];
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
    executionMode: 'multisigtools' | 'external';
  },
): void {
  if (
    request.network !== input.network
    || request.baseXdr !== input.xdr.trim()
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
  },
  options: IntegrationRequestOptions = {},
): Promise<IntegrationRequestCreationResult> {
  const now = options.now ?? new Date();
  const normalizedXdr = input.xdr.trim();
  const executionMode = integrationClassicExecutionMode(credential, input.network, normalizedXdr);
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
