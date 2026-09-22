import type { StellarAccountSnapshot, StellarSigner, StellarThresholds } from '../../packages/stellar-core/src/types.js';

export interface ExactMultisigPolicyInput {
  additionalSignerKeys: string[];
  keepMaster: boolean;
  paymentQuorum: number;
  adminQuorum: number;
}

export interface MultisigSignerChange {
  kind: 'add_signer' | 'remove_signer';
  signerKey: string;
  weight: number;
}

export interface MultisigSetupStep {
  kind: 'add_signer' | 'remove_signer' | 'finalize_policy';
  title: string;
  detail: string;
  signerKey?: string;
}

export interface ExactMultisigDesign {
  mode: 'setup' | 'change';
  participantCount: number;
  paymentQuorum: number;
  adminQuorum: number;
  masterWeight: number;
  thresholds: StellarThresholds;
  additionalSignerKeys: string[];
  signerChanges: MultisigSignerChange[];
  finalPolicyChanged: boolean;
  operationCount: number;
  targetAccount: StellarAccountSnapshot;
  setupSteps: MultisigSetupStep[];
  reserveSubentriesAdded: number;
}

export interface SetupSourceAssessment {
  supported: boolean;
  reasons: string[];
}

export interface ExistingMultisigAssessment extends SetupSourceAssessment {
  existing: boolean;
}

function uniqueKeys(keys: string[]): string[] {
  return [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
}

function activeSigner(signer: StellarSigner): boolean {
  return signer.weight > 0;
}

function currentMasterWeight(account: StellarAccountSnapshot): number {
  return account.signers.find((signer) => signer.key === account.accountId)?.weight ?? 0;
}

function currentAdditionalEd25519Keys(account: StellarAccountSnapshot): string[] {
  return account.signers
    .filter((signer) => signer.key !== account.accountId && signer.type === 'ed25519_public_key' && activeSigner(signer))
    .map((signer) => signer.key);
}

function validateTargetPolicy(account: StellarAccountSnapshot, input: ExactMultisigPolicyInput) {
  const additionalSignerKeys = uniqueKeys(input.additionalSignerKeys);
  if (additionalSignerKeys.some((key) => key === account.accountId)) {
    throw new Error('Do not add the account master key again as an additional signer.');
  }

  const participantCount = additionalSignerKeys.length + (input.keepMaster ? 1 : 0);
  if (participantCount < 2) {
    throw new Error('A multisig policy needs at least two active participants.');
  }
  if (additionalSignerKeys.length > 20) {
    throw new Error('Stellar accounts support at most 20 additional signers.');
  }

  const maxQuorum = Math.min(participantCount, 20);
  const paymentQuorum = Math.trunc(input.paymentQuorum);
  const adminQuorum = Math.trunc(input.adminQuorum);
  if (!Number.isFinite(paymentQuorum) || paymentQuorum < 1 || paymentQuorum > maxQuorum) {
    throw new Error(`Payment quorum must be between 1 and ${maxQuorum}.`);
  }
  if (!Number.isFinite(adminQuorum) || adminQuorum < paymentQuorum || adminQuorum > maxQuorum) {
    throw new Error(`Account-control quorum must be between ${paymentQuorum} and ${maxQuorum}.`);
  }

  return {
    additionalSignerKeys,
    participantCount,
    paymentQuorum,
    adminQuorum,
    masterWeight: input.keepMaster ? 1 : 0,
    thresholds: { low: paymentQuorum, medium: paymentQuorum, high: adminQuorum } satisfies StellarThresholds,
  };
}

function targetAccount(
  account: StellarAccountSnapshot,
  additionalSignerKeys: string[],
  masterWeight: number,
  thresholds: StellarThresholds,
  subentryDelta: number,
): StellarAccountSnapshot {
  return {
    ...account,
    subentryCount: Math.max(0, account.subentryCount + subentryDelta),
    thresholds,
    signers: [
      { key: account.accountId, type: 'ed25519_public_key', weight: masterWeight },
      ...additionalSignerKeys.map((key): StellarSigner => ({
        key,
        type: 'ed25519_public_key',
        weight: 1,
      })),
    ],
  };
}

export function assessSetupSource(account: StellarAccountSnapshot): SetupSourceAssessment {
  const reasons: string[] = [];
  const master = account.signers.find((signer) => signer.key === account.accountId);
  const additional = account.signers.filter((signer) =>
    signer.key !== account.accountId && activeSigner(signer),
  );

  if (!master || master.weight <= 0) {
    reasons.push('The account key is currently disabled.');
  } else if (master.weight < account.thresholds.high) {
    reasons.push(`The account key does not have enough approval power to make core account-control changes by itself.`);
  }

  if (additional.length > 0) {
    reasons.push('This account already has active additional signers.');
  }

  return { supported: reasons.length === 0, reasons };
}

export function assessExistingMultisigSource(account: StellarAccountSnapshot): ExistingMultisigAssessment {
  const active = account.signers.filter(activeSigner);
  const additional = active.filter((signer) => signer.key !== account.accountId);
  const existing = additional.length > 0 || active.length > 1;
  if (!existing) return { existing: false, supported: false, reasons: [] };

  const reasons: string[] = [];
  const advanced = active.filter((signer) => signer.type !== 'ed25519_public_key');
  const reusable = active.filter((signer) => signer.type === 'ed25519_public_key');
  const weighted = reusable.filter((signer) => signer.weight !== 1);

  if (advanced.length > 0) {
    reasons.push('This account uses a signing method that the guided editor does not support. Keep this policy read-only here and use technical transaction import for changes.');
  }
  if (weighted.length > 0) {
    reasons.push('This account uses custom approval power. The guided editor currently supports equal-power shared-control policies.');
  }
  if (account.thresholds.low !== account.thresholds.medium) {
    reasons.push('This account uses different authorization rules for limited account actions and standard transactions. The guided editor does not collapse that custom policy automatically.');
  }
  if (reusable.length < 2) {
    reasons.push('At least two active standard signing keys are required for the guided shared-control flow.');
  }
  if (account.thresholds.medium < 1 || account.thresholds.high < account.thresholds.medium) {
    reasons.push('The current authorization requirements are outside the guided shared-control policy shape.');
  }
  if (account.thresholds.high > reusable.length) {
    reasons.push('The core account-control requirement exceeds the supported active signing-key count.');
  }

  return { existing: true, supported: reasons.length === 0, reasons };
}

export function designExactMultisigPolicy(
  account: StellarAccountSnapshot,
  input: ExactMultisigPolicyInput,
): ExactMultisigDesign {
  const target = validateTargetPolicy(account, input);
  const signerChanges = target.additionalSignerKeys.map((signerKey): MultisigSignerChange => ({
    kind: 'add_signer',
    signerKey,
    weight: 1,
  }));
  const setupSteps: MultisigSetupStep[] = signerChanges.map((change, index) => ({
    kind: 'add_signer',
    title: `Add signer ${index + 1}`,
    detail: 'Add this Ed25519 signer with weight 1 while the current master policy still controls the account.',
    signerKey: change.signerKey,
  }));
  setupSteps.push({
    kind: 'finalize_policy',
    title: 'Finalize thresholds and master weight',
    detail: `Set low/medium to ${target.paymentQuorum}, high to ${target.adminQuorum}, and master weight to ${target.masterWeight}. This is deliberately the last operation.`,
  });

  return {
    mode: 'setup',
    participantCount: target.participantCount,
    paymentQuorum: target.paymentQuorum,
    adminQuorum: target.adminQuorum,
    masterWeight: target.masterWeight,
    thresholds: target.thresholds,
    additionalSignerKeys: target.additionalSignerKeys,
    signerChanges,
    finalPolicyChanged: true,
    operationCount: signerChanges.length + 1,
    targetAccount: targetAccount(
      account,
      target.additionalSignerKeys,
      target.masterWeight,
      target.thresholds,
      target.additionalSignerKeys.length,
    ),
    setupSteps,
    reserveSubentriesAdded: target.additionalSignerKeys.length,
  };
}

export function designExistingMultisigPolicy(
  account: StellarAccountSnapshot,
  input: ExactMultisigPolicyInput,
): ExactMultisigDesign {
  const assessment = assessExistingMultisigSource(account);
  if (!assessment.existing || !assessment.supported) {
    throw new Error(assessment.reasons.join(' ') || 'This account is not supported by the existing-multisig editor.');
  }

  const target = validateTargetPolicy(account, input);
  const currentAdditional = currentAdditionalEd25519Keys(account);
  const currentSet = new Set(currentAdditional);
  const targetSet = new Set(target.additionalSignerKeys);
  const removals = currentAdditional
    .filter((key) => !targetSet.has(key))
    .map((signerKey): MultisigSignerChange => ({ kind: 'remove_signer', signerKey, weight: 0 }));
  const additions = target.additionalSignerKeys
    .filter((key) => !currentSet.has(key))
    .map((signerKey): MultisigSignerChange => ({ kind: 'add_signer', signerKey, weight: 1 }));
  const signerChanges = [...removals, ...additions];
  const finalPolicyChanged = currentMasterWeight(account) !== target.masterWeight
    || account.thresholds.low !== target.thresholds.low
    || account.thresholds.medium !== target.thresholds.medium
    || account.thresholds.high !== target.thresholds.high;

  if (signerChanges.length === 0 && !finalPolicyChanged) {
    throw new Error('No signing changes to review.');
  }

  const setupSteps: MultisigSetupStep[] = signerChanges.map((change) => ({
    kind: change.kind,
    title: change.kind === 'remove_signer' ? 'Remove signer' : 'Add signer',
    detail: change.kind === 'remove_signer'
      ? 'Set this signer weight to 0. The transaction remains atomic; nothing changes unless the complete transaction succeeds.'
      : 'Add this Ed25519 signer with weight 1.',
    signerKey: change.signerKey,
  }));
  if (finalPolicyChanged) {
    setupSteps.push({
      kind: 'finalize_policy',
      title: 'Apply thresholds and master participation',
      detail: `Set low/medium to ${target.paymentQuorum}, high to ${target.adminQuorum}, and master weight to ${target.masterWeight}.`,
    });
  }

  const subentryDelta = target.additionalSignerKeys.length - currentAdditional.length;
  return {
    mode: 'change',
    participantCount: target.participantCount,
    paymentQuorum: target.paymentQuorum,
    adminQuorum: target.adminQuorum,
    masterWeight: target.masterWeight,
    thresholds: target.thresholds,
    additionalSignerKeys: target.additionalSignerKeys,
    signerChanges,
    finalPolicyChanged,
    operationCount: signerChanges.length + (finalPolicyChanged ? 1 : 0),
    targetAccount: targetAccount(
      account,
      target.additionalSignerKeys,
      target.masterWeight,
      target.thresholds,
      subentryDelta,
    ),
    setupSteps,
    reserveSubentriesAdded: Math.max(0, subentryDelta),
  };
}
