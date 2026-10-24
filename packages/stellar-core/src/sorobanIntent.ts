import {
  Account,
  Networks,
  Operation,
  TransactionBuilder,
  hash,
  xdr,
} from '@stellar/stellar-sdk/base';
import type { StellarNetwork } from './types.js';

export interface SorobanIntent {
  version: 1;
  network: StellarNetwork;
  hostFunctionXdr: string;
  intentDigest: string;
}

function passphrase(network: StellarNetwork): string {
  return network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function digestIntent(network: StellarNetwork, hostFunction: xdr.HostFunction): string {
  const networkBytes = new TextEncoder().encode(`${network}\0`);
  const functionBytes = hostFunction.toXdr();
  const payload = new Uint8Array(networkBytes.length + functionBytes.length);
  payload.set(networkBytes, 0);
  payload.set(functionBytes, networkBytes.length);
  return hex(hash(payload));
}

export function createSorobanIntent(
  network: StellarNetwork,
  hostFunction: xdr.HostFunction,
): SorobanIntent {
  return {
    version: 1,
    network,
    hostFunctionXdr: hostFunction.toXdr('base64'),
    intentDigest: digestIntent(network, hostFunction),
  };
}

export function sorobanIntentHostFunction(intent: SorobanIntent): xdr.HostFunction {
  return xdr.HostFunction.fromXdr(intent.hostFunctionXdr, 'base64');
}
export function materializeSorobanIntent({
  intent,
  sourceAccount,
  sourceSequence,
  fee,
  lifetimeSeconds,
  authorizationEntries = [],
  sorobanData,
}: {
  intent: SorobanIntent;
  sourceAccount: string;
  sourceSequence: string;
  fee: string;
  lifetimeSeconds: number;
  authorizationEntries?: xdr.SorobanAuthorizationEntry[];
  sorobanData?: xdr.SorobanTransactionData;
}) {
  const builder = new TransactionBuilder(new Account(sourceAccount, sourceSequence), {
    fee,
    networkPassphrase: passphrase(intent.network),
  }).addOperation(Operation.invokeHostFunction({
    func: sorobanIntentHostFunction(intent),
    auth: authorizationEntries,
  }));

  if (sorobanData) builder.setSorobanData(sorobanData);
  return builder.setTimeout(lifetimeSeconds).build();
}
