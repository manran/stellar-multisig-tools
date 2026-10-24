import {
  FeeBumpTransaction,
  Networks,
  TransactionBuilder,
  hash,
  inspectAuthEntry,
  xdr,
} from '@stellar/stellar-sdk/base';
import type { SorobanIntent } from './sorobanIntent.js';
import type { SorobanEffectsSnapshot } from './sorobanEffects.js';
import type { StellarNetwork } from './types.js';

export type SorobanAuthorizationExecutionBinding = 'detached' | 'source_bound';

export interface SorobanAuthorizationPlan {
  version: 1;
  network: StellarNetwork;
  intentDigest: string;
  authorizationPlanDigest: string;
  authorizationEntriesXdr: string[];
  effects: SorobanEffectsSnapshot;
  executionBinding: SorobanAuthorizationExecutionBinding;
  boundSourceAccount?: string;
}

function passphrase(network: StellarNetwork): string {
  return network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
}
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function digestPlan(
  intent: SorobanIntent,
  authorizationEntriesXdr: readonly string[],
  effects: SorobanEffectsSnapshot,
  executionBinding: SorobanAuthorizationExecutionBinding,
  boundSourceAccount?: string,
): string {
  const payload = JSON.stringify({
    version: 1,
    network: intent.network,
    intentDigest: intent.intentDigest,
    authorizationEntriesXdr,
    effectsDigest: effects.digest,
    executionBinding,
    boundSourceAccount: boundSourceAccount ?? null,
  });
  return hex(hash(new TextEncoder().encode(payload)));
}

export function authorizationEntriesFromPlan(
  plan: SorobanAuthorizationPlan,
): xdr.SorobanAuthorizationEntry[] {
  return plan.authorizationEntriesXdr.map((value) =>
    xdr.SorobanAuthorizationEntry.fromXdr(value, 'base64'));
}

export function createSorobanAuthorizationPlan(
  intent: SorobanIntent,
  preparedXdr: string,
  effects: SorobanEffectsSnapshot,
): SorobanAuthorizationPlan {
  const parsed = TransactionBuilder.fromXDR(preparedXdr.trim(), passphrase(intent.network));
  if (parsed instanceof FeeBumpTransaction
    || parsed.operations.length !== 1
    || parsed.operations[0]?.type !== 'invokeHostFunction') {
    throw new Error('Soroban authorization planning requires one InvokeHostFunction transaction.');
  }
  const operation = parsed.operations[0];
  if (operation.type !== 'invokeHostFunction') {
    throw new Error('Soroban authorization planning requires one InvokeHostFunction transaction.');
  }
  if (operation.func.toXdr('base64') !== intent.hostFunctionXdr) {
    throw new Error('Prepared Soroban transaction does not match this Intent.');
  }

  const entries = [...(operation.auth ?? [])];
  const authorizationEntriesXdr = entries.map((entry) => entry.toXdr('base64'));
  const executionBinding: SorobanAuthorizationExecutionBinding = entries.some(
    (entry) => inspectAuthEntry(entry).credentialType === 'sourceAccount',
  ) ? 'source_bound' : 'detached';
  const boundSourceAccount = executionBinding === 'source_bound' ? parsed.source : undefined;

  return {
    version: 1,
    network: intent.network,
    intentDigest: intent.intentDigest,
    authorizationPlanDigest: digestPlan(
      intent,
      authorizationEntriesXdr,
      effects,
      executionBinding,
      boundSourceAccount,
    ),
    authorizationEntriesXdr,
    effects,
    executionBinding,
    ...(boundSourceAccount ? { boundSourceAccount } : {}),
  };
}
