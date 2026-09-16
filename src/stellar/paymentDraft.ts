import { isTransactionLifetimeSeconds } from './transactionPreferences.js';
import type { StellarNetwork } from './types.js';

export interface PaymentRecipientDraft {
  destination: string;
  amount: string;
  assetKey: string;
}

export type PaymentDraftAction = 'payment' | 'create_account';

export interface PaymentDraft {
  version: 4;
  action: PaymentDraftAction;
  source: string;
  recipients: PaymentRecipientDraft[];
  memo: string;
  privateNote: string;
  addOnChainProof: boolean;
  signingWindowSeconds: number;
}

function legacyPaymentDraftStorageKeyV1(ownerAddress: string, network: StellarNetwork): string {
  return `multisig-tools.stellar.payment-draft.v1:${network}:${ownerAddress}`;
}

function legacyPaymentDraftStorageKeyV3(ownerAddress: string, network: StellarNetwork): string {
  return `multisig-tools.stellar.payment-draft.v3:${network}:${ownerAddress}`;
}

function legacyPaymentDraftStorageKeyV2(ownerAddress: string, network: StellarNetwork): string {
  return `multisig-tools.stellar.payment-draft.v2:${network}:${ownerAddress}`;
}

export function paymentDraftStorageKey(ownerAddress: string, network: StellarNetwork): string {
  return `multisig-tools.stellar.payment-draft.v4:${network}:${ownerAddress}`;
}

function validRecipient(value: unknown): value is PaymentRecipientDraft {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.destination === 'string'
    && typeof record.amount === 'string'
    && typeof record.assetKey === 'string';
}

function commonContext(record: Record<string, unknown>) {
  if (typeof record.source !== 'string' || typeof record.memo !== 'string') return null;
  if (typeof record.signingWindowSeconds !== 'number' || !isTransactionLifetimeSeconds(record.signingWindowSeconds)) return null;
  if (typeof record.addOnChainProof !== 'boolean') return null;
  return {
    source: record.source,
    memo: record.memo,
    addOnChainProof: record.addOnChainProof,
    signingWindowSeconds: record.signingWindowSeconds,
  };
}

function parseDraft(value: unknown): PaymentDraft | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const common = commonContext(record);
  if (!common) return null;

  if (record.version === 4) {
    if (record.action !== 'payment' && record.action !== 'create_account') return null;
    if (typeof record.privateNote !== 'string' || !Array.isArray(record.recipients)) return null;
    const recipients = record.recipients.filter(validRecipient);
    if (recipients.length !== record.recipients.length || recipients.length < 1 || recipients.length > 100) return null;
    return {
      version: 4,
      action: record.action,
      ...common,
      recipients,
      privateNote: record.privateNote,
    };
  }

  if (record.version === 3) {
    if (typeof record.privateNote !== 'string' || !Array.isArray(record.recipients)) return null;
    const recipients = record.recipients.filter(validRecipient);
    if (recipients.length !== record.recipients.length || recipients.length < 1 || recipients.length > 100) return null;
    return {
      version: 4,
      action: 'payment',
      ...common,
      recipients,
      privateNote: record.privateNote,
    };
  }

  // v2 was the single-recipient shape. Preserve every entered field while
  // projecting it into the first row of the unified recipient editor.
  if (record.version === 2) {
    if (typeof record.assetKey !== 'string' || typeof record.destination !== 'string') return null;
    if (typeof record.amount !== 'string' || typeof record.privateNote !== 'string') return null;
    return {
      version: 4,
      action: 'payment',
      ...common,
      recipients: [{ destination: record.destination, amount: record.amount, assetKey: record.assetKey }],
      privateNote: record.privateNote,
    };
  }

  // v1 modeled public memo and private context as mutually exclusive UI modes.
  if (record.version === 1) {
    if (record.contextMode !== 'public' && record.contextMode !== 'private') return null;
    if (typeof record.assetKey !== 'string' || typeof record.destination !== 'string') return null;
    if (typeof record.amount !== 'string' || typeof record.privateMemo !== 'string') return null;
    return {
      version: 4,
      action: 'payment',
      ...common,
      recipients: [{ destination: record.destination, amount: record.amount, assetKey: record.assetKey }],
      privateNote: record.privateMemo,
    };
  }

  return null;
}

function readDraft(storage: Pick<Storage, 'getItem'>, key: string): PaymentDraft | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return parseDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function loadPaymentDraft(
  storage: Pick<Storage, 'getItem'>,
  ownerAddress: string,
  network: StellarNetwork,
): PaymentDraft | null {
  return readDraft(storage, paymentDraftStorageKey(ownerAddress, network))
    ?? readDraft(storage, legacyPaymentDraftStorageKeyV3(ownerAddress, network))
    ?? readDraft(storage, legacyPaymentDraftStorageKeyV2(ownerAddress, network))
    ?? readDraft(storage, legacyPaymentDraftStorageKeyV1(ownerAddress, network));
}

export function savePaymentDraft(
  storage: Pick<Storage, 'setItem'>,
  ownerAddress: string,
  network: StellarNetwork,
  draft: PaymentDraft,
): void {
  storage.setItem(paymentDraftStorageKey(ownerAddress, network), JSON.stringify(draft));
}

export function clearPaymentDraft(
  storage: Pick<Storage, 'removeItem'>,
  ownerAddress: string,
  network: StellarNetwork,
): void {
  storage.removeItem(paymentDraftStorageKey(ownerAddress, network));
  storage.removeItem(legacyPaymentDraftStorageKeyV3(ownerAddress, network));
  storage.removeItem(legacyPaymentDraftStorageKeyV2(ownerAddress, network));
  storage.removeItem(legacyPaymentDraftStorageKeyV1(ownerAddress, network));
}
