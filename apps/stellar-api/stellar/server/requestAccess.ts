import { createHash, timingSafeEqual } from 'node:crypto';
import { loadAccount } from '../../../../packages/stellar-core/src/horizon.js';
import { analyzeEnvelopeSignatures } from '../../../../packages/stellar-core/src/signatureAnalysis.js';
import type { StellarAccountSnapshot, StellarNetwork } from '../../../../packages/stellar-core/src/types.js';
import { inspectTransactionXdr } from '../../../../packages/stellar-core/src/transactionXdr.js';
import type { StoredSigningRequest } from './requestStore.js';

export type RequestAccountLoader = (
  accountId: string,
  network: StellarNetwork,
) => Promise<StellarAccountSnapshot>;

export function capabilityHashForToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function equalHex(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function requestCapabilityMatches(
  request: Pick<StoredSigningRequest, 'capabilityHash'>,
  capability: string,
): boolean {
  if (!capability || !request.capabilityHash) return false;
  return equalHex(request.capabilityHash, capabilityHashForToken(capability));
}

export function signerHasSignedTransaction(
  address: string,
  xdr: string,
  network: StellarNetwork,
): boolean {
  const analysis = analyzeEnvelopeSignatures(
    xdr,
    network,
    [{ key: address, type: 'ed25519_public_key', weight: 1 }],
    'inner',
  );
  return analysis.matchedSigners.some((signer) =>
    signer.signerKey === address && !signer.automatic && signer.signatureIndex !== undefined,
  );
}

export async function signerCanAccessTransaction(
  address: string,
  xdr: string,
  network: StellarNetwork,
  accountLoader: RequestAccountLoader = loadAccount,
): Promise<boolean> {
  const inspection = inspectTransactionXdr(xdr, network);
  if (inspection.extraSigners.includes(address)) return true;

  const sourceAccounts = [...new Set(
    inspection.sourceRequirements.map((requirement) => requirement.accountId),
  )];
  const accounts = await Promise.all(sourceAccounts.map((accountId) => accountLoader(accountId, network)));
  return accounts.some((account) => account.signers.some((signer) =>
    signer.key === address
    && signer.weight > 0
    && signer.type === 'ed25519_public_key',
  ));
}
