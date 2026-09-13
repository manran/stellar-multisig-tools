import {
  Account,
  BASE_FEE,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import type { ExactMultisigDesign } from './multisigDesigner.js';
import type { StellarAccountSnapshot, StellarNetwork } from './types.js';

function networkPassphrase(network: StellarNetwork): string {
  return network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
}

export function validateDesignerSignerKeys(keys: string[]): string[] {
  const invalid = keys.filter((key) => !StrKey.isValidEd25519PublicKey(key));
  if (invalid.length > 0) {
    throw new Error(`Invalid Stellar public key: ${invalid[0]}`);
  }
  return keys;
}

export const DEFAULT_MULTISIG_SETUP_TIMEOUT_SECONDS = 24 * 60 * 60;

export function buildMultisigSetupXdr(
  account: StellarAccountSnapshot,
  network: StellarNetwork,
  design: ExactMultisigDesign,
  baseFeeInStroops: number | string = BASE_FEE,
  timeoutSeconds = DEFAULT_MULTISIG_SETUP_TIMEOUT_SECONDS,
): string {
  validateDesignerSignerKeys(design.signerChanges.map((change) => change.signerKey));

  const builder = new TransactionBuilder(new Account(account.accountId, account.sequence), {
    fee: String(baseFeeInStroops),
    networkPassphrase: networkPassphrase(network),
  });

  for (const change of design.signerChanges) {
    builder.addOperation(Operation.setOptions({
      signer: { ed25519PublicKey: change.signerKey, weight: change.weight },
    }));
  }

  if (design.finalPolicyChanged) {
    builder.addOperation(Operation.setOptions({
      masterWeight: design.masterWeight,
      lowThreshold: design.thresholds.low,
      medThreshold: design.thresholds.medium,
      highThreshold: design.thresholds.high,
    }));
  }

  return builder.setTimeout(timeoutSeconds).build().toXdr();
}
