import { isValidStellarAccountId } from '../../../../packages/stellar-core/src/horizon.js';
import type { SigningRequestAssignment } from '../../../../packages/stellar-core/src/requestTypes.js';
import { signerCanAccessTransaction, signerHasSignedTransaction } from './requestAccess.js';
import { getSigningRequest } from './requestService.js';
import type { SigningRequestStore } from './requestStore.js';

export class RequestAssignmentServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'RequestAssignmentServiceError';
  }
}

export async function assignSigningRequest(
  store: SigningRequestStore,
  requestId: string,
  assignedByAddress: string,
  signerAddressValue: unknown,
  options: {
    now?: Date;
    signerAccess?: typeof signerCanAccessTransaction;
    snapshotLoader?: typeof getSigningRequest;
  } = {},
): Promise<{ assignment: SigningRequestAssignment; created: boolean }> {
  if (!store.putRequestAssignment) {
    throw new RequestAssignmentServiceError(
      'Request assignment storage is unavailable.',
      503,
      'request_assignment_storage_unavailable',
    );
  }
  if (!isValidStellarAccountId(assignedByAddress)) {
    throw new RequestAssignmentServiceError(
      'Confirm a current signer wallet before asking someone to sign.',
      401,
      'request_assignment_identity_required',
    );
  }
  const signerAddress = typeof signerAddressValue === 'string' ? signerAddressValue.trim() : '';
  if (!isValidStellarAccountId(signerAddress)) {
    throw new RequestAssignmentServiceError(
      'Choose a valid Stellar signer.',
      400,
      'invalid_request_assignment_signer',
    );
  }
  if (signerAddress === assignedByAddress) {
    throw new RequestAssignmentServiceError(
      'Choose another signer to ask.',
      400,
      'request_assignment_self',
    );
  }

  const stored = await store.getRequest(requestId);
  if (!stored) {
    throw new RequestAssignmentServiceError('Signing request not found.', 404, 'request_not_found');
  }

  const access = options.signerAccess ?? signerCanAccessTransaction;
  const [assignerAllowed, signerAllowed] = await Promise.all([
    access(assignedByAddress, stored.baseXdr, stored.network),
    access(signerAddress, stored.baseXdr, stored.network),
  ]);
  if (!assignerAllowed) {
    throw new RequestAssignmentServiceError(
      'Only a current signer can ask another signer to act on this proposal.',
      403,
      'request_assignment_not_authorized',
    );
  }
  if (!signerAllowed) {
    throw new RequestAssignmentServiceError(
      'That address is not a current signer for this proposal.',
      409,
      'request_assignment_signer_unavailable',
    );
  }

  const loadSnapshot = options.snapshotLoader ?? getSigningRequest;
  const snapshot = await loadSnapshot(store, requestId);
  if (snapshot.status !== 'awaiting_signatures') {
    throw new RequestAssignmentServiceError(
      'This proposal is no longer waiting for signatures.',
      409,
      'request_assignment_not_pending',
    );
  }
  if (signerHasSignedTransaction(signerAddress, snapshot.mergedXdr, snapshot.network)) {
    throw new RequestAssignmentServiceError(
      'That signer has already signed this proposal.',
      409,
      'request_assignment_already_signed',
    );
  }

  return store.putRequestAssignment(requestId, {
    version: 1,
    signerAddress,
    assignedByAddress,
    assignedAt: (options.now ?? new Date()).toISOString(),
  });
}
