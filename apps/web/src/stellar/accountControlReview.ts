import {
  FeeBumpTransaction,
  Networks,
  TransactionBuilder,
  extractBaseAddress,
} from '@stellar/stellar-sdk/base';
import { analyzeAccountAuthorization } from '../../../../packages/stellar-core/src/authorization.js';
import { approvalPowerLabel, humanAuthorizationLevelLabel, humanAuthorizationRequirement } from './authorizationPresentation.js';
import type { StellarAccountSnapshot, StellarNetwork, StellarSigner, ThresholdLevel } from '../../../../packages/stellar-core/src/types.js';

export interface AccountControlReviewChange {
  key: string;
  label: string;
  address?: string;
  before: string;
  after: string;
  warning: boolean;
}

export interface AccountControlReviewSummary {
  sourceAccount: string;
  changes: AccountControlReviewChange[];
  risks: AccountControlReviewRisk[];
  currentHighRequirement?: {
    threshold: number;
    policyLabel: string;
    requirementLabel: string;
  };
}

export interface AccountControlReviewRisk {
  key: string;
  severity: 'critical' | 'warning';
  title: string;
  detail: string;
}

type AnyRecord = Record<string, unknown>;

type SetOptionsShape = {
  type?: string;
  source?: string | null;
  signer?: unknown;
  masterWeight?: number | null;
  lowThreshold?: number | null;
  medThreshold?: number | null;
  highThreshold?: number | null;
};

function record(value: unknown): AnyRecord | null {
  return value !== null && typeof value === 'object' ? value as AnyRecord : null;
}

function networkPassphrase(network: StellarNetwork) {
  return network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
}

function signerKey(value: unknown): string | null {
  const signer = record(value);
  if (!signer) return null;
  for (const key of ['ed25519PublicKey', 'preAuthTx', 'sha256Hash', 'ed25519SignedPayload']) {
    if (typeof signer[key] === 'string') return signer[key] as string;
  }
  return null;
}

function signerWeight(value: unknown): number | null {
  const signer = record(value);
  if (!signer) return null;
  return typeof signer.weight === 'number' ? signer.weight : null;
}

function signerType(value: unknown): string | null {
  const signer = record(value);
  if (!signer) return null;
  if (typeof signer.ed25519PublicKey === 'string') return 'ed25519_public_key';
  if (typeof signer.preAuthTx === 'string') return 'preauth_tx';
  if (typeof signer.sha256Hash === 'string') return 'sha256_hash';
  if (typeof signer.ed25519SignedPayload === 'string') return 'ed25519_signed_payload';
  return null;
}

function isAuthorizationChange(operation: SetOptionsShape): boolean {
  return operation.type === 'setOptions' && (
    operation.signer != null
    || operation.masterWeight != null
    || operation.lowThreshold != null
    || operation.medThreshold != null
    || operation.highThreshold != null
  );
}

function thresholdPowerLabel(value: number): string {
  return `Approval power ${value}`;
}

export function assessAccountControlPolicyTransition(
  currentAccount: StellarAccountSnapshot,
  targetAccount: StellarAccountSnapshot,
): AccountControlReviewRisk[] {
  const current = analyzeAccountAuthorization(currentAccount);
  const target = analyzeAccountAuthorization(targetAccount);
  const risks: AccountControlReviewRisk[] = [];

  if (target.activeSignerCount === 0) {
    risks.push({
      key: 'no-reusable-signer',
      severity: 'critical',
      title: 'No reusable signer would remain',
      detail: 'After this change, no reusable signer could authorize a new transaction for the account.',
    });
  } else {
    for (const level of ['low', 'medium', 'high'] as ThresholdLevel[]) {
      const summary = target.thresholds[level];
      if (!summary.reachable) {
        risks.push({
          key: `unreachable:${level}`,
          severity: 'critical',
          title: `${humanAuthorizationLevelLabel(level)} would be unreachable`,
          detail: `The resulting policy requires approval power ${summary.threshold}, but reusable signers provide ${summary.totalActiveWeight}.`,
        });
      }
    }
  }

  for (const level of ['medium', 'high'] as ThresholdLevel[]) {
    const before = current.thresholds[level].guaranteedSignerFailuresTolerated;
    const after = target.thresholds[level].guaranteedSignerFailuresTolerated;
    if (before !== null && after !== null && after < before) {
      risks.push({
        key: `resilience:${level}`,
        severity: 'warning',
        title: `${humanAuthorizationLevelLabel(level)} signer-loss tolerance decreases`,
        detail: `The current policy tolerates ${before} signer loss${before === 1 ? '' : 'es'} for ${humanAuthorizationLevelLabel(level).toLowerCase()}; the resulting policy would tolerate ${after}.`,
      });
    }
  }

  if (current.thresholds.high.singleSignerKeys.length === 0 && target.thresholds.high.singleSignerKeys.length > 0) {
    risks.push({
      key: 'single-high-controller',
      severity: 'warning',
      title: 'A single signer would be able to change core account control',
      detail: `${target.thresholds.high.singleSignerKeys.length} resulting signer${target.thresholds.high.singleSignerKeys.length === 1 ? '' : 's'} would individually provide enough approval power for core account control.`,
    });
  }

  return risks;
}

export function summarizeAccountControlReview(
  envelopeXdr: string,
  network: StellarNetwork,
  currentAccount: StellarAccountSnapshot | null = null,
): AccountControlReviewSummary | null {
  let parsed: ReturnType<typeof TransactionBuilder.fromXdr>;
  try {
    parsed = TransactionBuilder.fromXdr(envelopeXdr.trim(), networkPassphrase(network));
  } catch {
    return null;
  }
  const transaction = parsed instanceof FeeBumpTransaction ? parsed.innerTransaction : parsed;
  const sourceAccount = extractBaseAddress(transaction.source);
  const operations = transaction.operations as SetOptionsShape[];
  if (operations.length === 0 || operations.some((operation) => !isAuthorizationChange(operation))) return null;
  if (operations.some((operation) => extractBaseAddress(operation.source ?? transaction.source) !== sourceAccount)) return null;

  if (!currentAccount || currentAccount.accountId !== sourceAccount) {
    const changes: AccountControlReviewChange[] = [];
    operations.forEach((operation, index) => {
      if (operation.signer != null) {
        const key = signerKey(operation.signer);
        const weight = signerWeight(operation.signer);
        if (key && weight != null) {
          changes.push({
            key: `signer:${index}:${key}`,
            label: weight === 0 ? 'Remove signer' : 'Set signer',
            address: key,
            before: 'Current policy',
            after: approvalPowerLabel(weight),
            warning: weight === 0,
          });
        }
      }
      if (operation.masterWeight != null) {
        changes.push({ key: `master:${index}`, label: 'Account key', before: 'Current policy', after: approvalPowerLabel(operation.masterWeight), warning: operation.masterWeight === 0 });
      }
      if (operation.medThreshold != null) {
        changes.push({ key: `medium:${index}`, label: 'Standard transactions', before: 'Current policy', after: thresholdPowerLabel(operation.medThreshold), warning: true });
      }
      if (operation.highThreshold != null) {
        changes.push({ key: `high:${index}`, label: 'Core account control', before: 'Current policy', after: thresholdPowerLabel(operation.highThreshold), warning: true });
      }
      if (operation.lowThreshold != null && operation.medThreshold == null) {
        changes.push({ key: `low:${index}`, label: 'Limited account actions', before: 'Current policy', after: thresholdPowerLabel(operation.lowThreshold), warning: true });
      }
    });
    return { sourceAccount, changes, risks: [] };
  }

  const currentMasterWeight = currentAccount.signers.find((signer) => signer.key === currentAccount.accountId)?.weight ?? 0;
  let targetMasterWeight = currentMasterWeight;
  let targetLow = currentAccount.thresholds.low;
  let targetMedium = currentAccount.thresholds.medium;
  let targetHigh = currentAccount.thresholds.high;
  const currentSigners = new Map<string, StellarSigner>(
    currentAccount.signers
      .filter((signer) => signer.key !== currentAccount.accountId && signer.weight > 0)
      .map((signer) => [signer.key, { ...signer }] as const),
  );
  const targetSigners = new Map(currentSigners);

  for (const operation of operations) {
    if (operation.signer != null) {
      const key = signerKey(operation.signer);
      const weight = signerWeight(operation.signer);
      if (key && weight != null) {
        if (weight <= 0) targetSigners.delete(key);
        else targetSigners.set(key, {
          key,
          type: signerType(operation.signer) ?? targetSigners.get(key)?.type ?? 'ed25519_public_key',
          weight,
        });
      }
    }
    if (operation.masterWeight != null) targetMasterWeight = operation.masterWeight;
    if (operation.lowThreshold != null) targetLow = operation.lowThreshold;
    if (operation.medThreshold != null) targetMedium = operation.medThreshold;
    if (operation.highThreshold != null) targetHigh = operation.highThreshold;
  }

  const changes: AccountControlReviewChange[] = [];
  const signerKeys = [...new Set([...currentSigners.keys(), ...targetSigners.keys()])].sort();
  for (const key of signerKeys) {
    const before = currentSigners.get(key)?.weight ?? 0;
    const after = targetSigners.get(key)?.weight ?? 0;
    if (before === after) continue;
    changes.push({
      key: `signer:${key}`,
      label: before === 0 ? 'Add signer' : after === 0 ? 'Remove signer' : 'Change signer weight',
      address: key,
      before: before === 0 ? 'Not a signer' : approvalPowerLabel(before),
      after: after === 0 ? 'Removed' : approvalPowerLabel(after),
      warning: after < before,
    });
  }

  if (currentMasterWeight !== targetMasterWeight) {
    changes.push({
      key: 'master',
      label: 'Account key',
      address: currentAccount.accountId,
      before: approvalPowerLabel(currentMasterWeight),
      after: approvalPowerLabel(targetMasterWeight),
      warning: targetMasterWeight < currentMasterWeight,
    });
  }
  if (currentAccount.thresholds.medium !== targetMedium) {
    changes.push({
      key: 'medium',
      label: 'Standard transactions',
      before: thresholdPowerLabel(currentAccount.thresholds.medium),
      after: thresholdPowerLabel(targetMedium),
      warning: true,
    });
  }
  if (currentAccount.thresholds.high !== targetHigh) {
    changes.push({
      key: 'high',
      label: 'Core account control',
      before: thresholdPowerLabel(currentAccount.thresholds.high),
      after: thresholdPowerLabel(targetHigh),
      warning: true,
    });
  }
  if (
    currentAccount.thresholds.low !== targetLow
    && (currentAccount.thresholds.low !== currentAccount.thresholds.medium || targetLow !== targetMedium)
  ) {
    changes.push({
      key: 'low',
      label: 'Limited account actions',
      before: thresholdPowerLabel(currentAccount.thresholds.low),
      after: thresholdPowerLabel(targetLow),
      warning: true,
    });
  }

  const masterSigner = currentAccount.signers.find((signer) => signer.key === currentAccount.accountId);
  const targetAccount: StellarAccountSnapshot = {
    ...currentAccount,
    thresholds: { low: targetLow, medium: targetMedium, high: targetHigh },
    signers: [
      {
        key: currentAccount.accountId,
        type: masterSigner?.type ?? 'ed25519_public_key',
        weight: targetMasterWeight,
        ...(masterSigner?.sponsor ? { sponsor: masterSigner.sponsor } : {}),
      },
      ...targetSigners.values(),
    ],
  };
  const currentAuthorization = analyzeAccountAuthorization(currentAccount);

  return {
    sourceAccount,
    changes,
    risks: assessAccountControlPolicyTransition(currentAccount, targetAccount),
    currentHighRequirement: {
      threshold: currentAccount.thresholds.high,
      policyLabel: currentAuthorization.thresholds.high.policyLabel,
      requirementLabel: humanAuthorizationRequirement(currentAuthorization.thresholds.high),
    },
  };
}
