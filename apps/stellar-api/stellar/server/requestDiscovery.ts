import { inspectTransactionXdr } from '../../../../packages/stellar-core/src/transactionXdr.js';
import type { TransactionXdrInspection } from '../../../../packages/stellar-core/src/transactionXdr.js';
import type { StellarAccountSnapshot, StellarNetwork } from '../../../../packages/stellar-core/src/types.js';

export interface RequestDiscoverySubjects {
  sourceAccountIds: string[];
  directSignerKeys: string[];
}

export function requestDiscoverySubjectsForInspection(
  inspection: Pick<TransactionXdrInspection, 'sourceRequirements' | 'extraSigners'>,
): RequestDiscoverySubjects {
  const sourceAccountIds = [...new Set(
    inspection.sourceRequirements.map((requirement) => requirement.accountId),
  )].sort();
  const directSignerKeys = [...new Set(
    inspection.extraSigners.filter((key) => key.startsWith('G')),
  )].sort();
  return { sourceAccountIds, directSignerKeys };
}

export function requestDiscoverySignerKeys(
  accounts: Array<StellarAccountSnapshot | null | undefined>,
  directSignerKeys: string[],
): string[] {
  const keys = new Set(directSignerKeys.filter((key) => key.startsWith('G')));
  for (const account of accounts) {
    if (!account) continue;
    for (const signer of account.signers) {
      if (signer.type === 'ed25519_public_key' && signer.weight > 0) keys.add(signer.key);
    }
  }
  return [...keys].sort();
}

export function requestDiscoverySubjects(
  xdr: string,
  network: StellarNetwork,
): RequestDiscoverySubjects {
  return requestDiscoverySubjectsForInspection(inspectTransactionXdr(xdr, network));
}
