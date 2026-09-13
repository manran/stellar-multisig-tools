import {
  computePrivateCommitmentFromHex,
  PRIVATE_COMMITMENT_VERSION,
} from '../src/stellar/privateCommitment.js';
import type { PrivateCommitmentRecord } from '../src/stellar/privateCommitment.js';
import type { InspectedMemo } from '../src/stellar/transactionXdr.js';

export class PrivateCommitmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrivateCommitmentValidationError';
  }
}

export function validatePrivateCommitmentForMemo(
  input: unknown,
  memo: InspectedMemo,
  createdAt: string,
): PrivateCommitmentRecord | undefined {
  if (input === undefined || input === null) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new PrivateCommitmentValidationError('Private commitment context must be an object.');
  }
  const candidate = input as Record<string, unknown>;
  if (typeof candidate.text !== 'string' || typeof candidate.saltHex !== 'string') {
    throw new PrivateCommitmentValidationError('Private commitment context requires text and saltHex.');
  }

  let commitment;
  try {
    commitment = computePrivateCommitmentFromHex(candidate.text, candidate.saltHex);
  } catch (cause) {
    throw new PrivateCommitmentValidationError(
      cause instanceof Error ? cause.message : 'Invalid private commitment context.',
    );
  }

  if (memo.type !== 'hash' || memo.value?.toLowerCase() !== commitment.hashHex) {
    throw new PrivateCommitmentValidationError(
      'Private commitment context does not match the transaction MEMO_HASH.',
    );
  }

  return {
    version: PRIVATE_COMMITMENT_VERSION,
    text: commitment.text,
    saltHex: commitment.saltHex,
    hashHex: commitment.hashHex,
    createdAt,
  };
}
