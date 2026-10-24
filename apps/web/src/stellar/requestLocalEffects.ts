import { loadAdoptedTreasuryAccountIds, saveAdoptedTreasuryAccountIds } from './treasuryPreferences.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';

const REQUEST_LOCAL_EFFECTS_PREFIX = 'multisig-tools.stellar.request-local-effects.v1.';

interface TreasuryAdoptionEffect {
  accountId: string;
  walletAddress: string;
  network: StellarNetwork;
}

export interface RequestLocalEffects {
  adoptTreasury?: TreasuryAdoptionEffect;
}

interface StoredRequestLocalEffects extends RequestLocalEffects {
  version: 1;
}

type RequestLocalEffectsStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function keyFor(requestId: string): string {
  return `${REQUEST_LOCAL_EFFECTS_PREFIX}${requestId.trim()}`;
}

function validAdoption(value: unknown): TreasuryAdoptionEffect | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Partial<TreasuryAdoptionEffect>;
  if (!record.accountId?.trim() || !record.walletAddress?.trim()) return undefined;
  if (record.network !== 'public' && record.network !== 'testnet') return undefined;
  return {
    accountId: record.accountId.trim(),
    walletAddress: record.walletAddress.trim(),
    network: record.network,
  };
}

export function saveRequestLocalEffects(
  storage: RequestLocalEffectsStorage,
  requestId: string,
  effects: RequestLocalEffects,
): void {
  const id = requestId.trim();
  if (!id) return;
  const adoptTreasury = validAdoption(effects.adoptTreasury);
  if (!adoptTreasury) {
    storage.removeItem(keyFor(id));
    return;
  }
  const stored: StoredRequestLocalEffects = { version: 1, adoptTreasury };
  storage.setItem(keyFor(id), JSON.stringify(stored));
}

export function loadRequestLocalEffects(
  storage: RequestLocalEffectsStorage,
  requestId: string,
): RequestLocalEffects | null {
  const id = requestId.trim();
  if (!id) return null;
  const raw = storage.getItem(keyFor(id));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredRequestLocalEffects>;
    if (parsed.version !== 1) return null;
    const adoptTreasury = validAdoption(parsed.adoptTreasury);
    return adoptTreasury ? { adoptTreasury } : null;
  } catch {
    return null;
  }
}

export function clearRequestLocalEffects(
  storage: Pick<Storage, 'removeItem'>,
  requestId: string,
): void {
  const id = requestId.trim();
  if (id) storage.removeItem(keyFor(id));
}

export function applyRequestLocalEffects(
  effectStorage: RequestLocalEffectsStorage,
  preferenceStorage: Pick<Storage, 'getItem' | 'setItem'>,
  requestId: string,
  network: StellarNetwork,
): boolean {
  const effects = loadRequestLocalEffects(effectStorage, requestId);
  const adoption = effects?.adoptTreasury;
  if (!adoption || adoption.network !== network) return false;
  try {
    const current = loadAdoptedTreasuryAccountIds(
      preferenceStorage,
      adoption.walletAddress,
      adoption.network,
    );
    saveAdoptedTreasuryAccountIds(
      preferenceStorage,
      adoption.walletAddress,
      adoption.network,
      [...current, adoption.accountId],
    );
    clearRequestLocalEffects(effectStorage, requestId);
    return true;
  } catch {
    // Local preference persistence must never turn an already-submitted
    // Stellar transaction into an apparent product failure. Retain the
    // effect so a later submitted projection can retry it.
    return false;
  }
}
