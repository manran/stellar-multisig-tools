import type { StellarNetwork } from './types.js';

export type TransactionTemplateKind = 'batch' | 'multi-party' | 'claimable';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function transactionTemplateDraftKey(owner: string, network: StellarNetwork, kind: TransactionTemplateKind): string {
  return `multisig-tools.stellar.transaction-template-draft.v1:${kind}:${network}:${owner.trim()}`;
}

export function loadTransactionTemplateDraft<T>(storage: StorageLike, owner: string, network: StellarNetwork, kind: TransactionTemplateKind): T | null {
  if (!owner.trim()) return null;
  try {
    const raw = storage.getItem(transactionTemplateDraftKey(owner, network, kind));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { version?: unknown; value?: unknown };
    return parsed?.version === 1 ? parsed.value as T : null;
  } catch {
    return null;
  }
}

export function saveTransactionTemplateDraft<T>(storage: StorageLike, owner: string, network: StellarNetwork, kind: TransactionTemplateKind, value: T) {
  if (!owner.trim()) return;
  storage.setItem(transactionTemplateDraftKey(owner, network, kind), JSON.stringify({ version: 1, value }));
}

export function clearTransactionTemplateDraft(storage: StorageLike, owner: string, network: StellarNetwork, kind: TransactionTemplateKind) {
  if (!owner.trim()) return;
  storage.removeItem(transactionTemplateDraftKey(owner, network, kind));
}
