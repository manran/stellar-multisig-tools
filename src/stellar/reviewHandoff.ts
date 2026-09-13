import type { PrivateCommitmentDraft } from './privateCommitment.js';
import type { AccountSigningIntent } from './accountSigningFlow.js';
import type { StellarNetwork } from './types.js';

const REVIEW_HANDOFF_XDR_KEY = 'multisig-tools.stellar.review-handoff.xdr';
const REVIEW_HANDOFF_NETWORK_KEY = 'multisig-tools.stellar.review-handoff.network';
const PRIVATE_NOTE_HANDOFF_KEY = 'multisig-tools.stellar.private-note-handoff';
const PRIVATE_COMMITMENT_HANDOFF_KEY = 'multisig-tools.stellar.private-commitment-handoff';
const CREATE_TREASURY_HANDOFF_KEY = 'multisig-tools.stellar.create-treasury-handoff';
const ACCOUNT_SIGNING_INTENT_HANDOFF_KEY = 'multisig-tools.stellar.account-signing-intent-handoff';
const REVIEW_HISTORY_STATE_KEY = '__multisigToolsReviewHandoff';

export interface ReviewHandoff {
  xdr: string;
  network: StellarNetwork | null;
  privateNote: string | null;
  privateCommitment: PrivateCommitmentDraft | null;
  createTreasuryAccountId: string | null;
  accountSigningIntent: AccountSigningIntent | null;
}

export interface ReviewHandoffWrite {
  xdr: string;
  network: StellarNetwork;
  privateNote?: string | null;
  privateCommitment?: PrivateCommitmentDraft | null;
  createTreasuryAccountId?: string | null;
  accountSigningIntent?: AccountSigningIntent | null;
}

export interface ReviewHistory {
  pathname: string;
  state: unknown;
  replaceState(state: unknown): void;
}

type ReviewHandoffStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function emptyHandoff(): ReviewHandoff {
  return {
    xdr: '',
    network: null,
    privateNote: null,
    privateCommitment: null,
    createTreasuryAccountId: null,
    accountSigningIntent: null,
  };
}

function parsePrivateCommitment(raw: string | null): PrivateCommitmentDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PrivateCommitmentDraft>;
    if (typeof value.text !== 'string' || typeof value.saltHex !== 'string' || typeof value.hashHex !== 'string') return null;
    return { text: value.text, saltHex: value.saltHex, hashHex: value.hashHex };
  } catch {
    return null;
  }
}

function parseHistoryHandoff(value: unknown): ReviewHandoff | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<ReviewHandoff>;
  if (typeof record.xdr !== 'string' || !record.xdr.trim()) return null;
  if (record.network !== 'public' && record.network !== 'testnet' && record.network !== null) return null;
  if (record.privateNote !== null && typeof record.privateNote !== 'string') return null;
  if (record.createTreasuryAccountId !== null && typeof record.createTreasuryAccountId !== 'string') return null;
  if (record.accountSigningIntent !== undefined && record.accountSigningIntent !== null && record.accountSigningIntent !== 'standalone' && record.accountSigningIntent !== 'offline' && record.accountSigningIntent !== 'treasury') return null;
  const commitment = record.privateCommitment;
  if (commitment !== null && (
    !commitment
    || typeof commitment.text !== 'string'
    || typeof commitment.saltHex !== 'string'
    || typeof commitment.hashHex !== 'string'
  )) return null;
  return {
    xdr: record.xdr.trim(),
    network: record.network ?? null,
    privateNote: record.privateNote?.trim() || null,
    privateCommitment: commitment ?? null,
    createTreasuryAccountId: record.createTreasuryAccountId?.trim() || null,
    accountSigningIntent: record.accountSigningIntent === 'standalone' || record.accountSigningIntent === 'offline' || record.accountSigningIntent === 'treasury' ? record.accountSigningIntent : null,
  };
}

function browserReviewHistory(): ReviewHistory | null {
  if (typeof window === 'undefined') return null;
  return {
    pathname: window.location.pathname,
    state: window.history.state,
    replaceState(state) { window.history.replaceState(state, ''); },
  };
}

function historyHandoff(history: ReviewHistory | null): ReviewHandoff | null {
  if (!history || !history.pathname.endsWith('/signing-room')) return null;
  if (!history.state || typeof history.state !== 'object') return null;
  return parseHistoryHandoff((history.state as Record<string, unknown>)[REVIEW_HISTORY_STATE_KEY]);
}

function retainInHistory(history: ReviewHistory | null, handoff: ReviewHandoff) {
  if (!history || !history.pathname.endsWith('/signing-room')) return;
  const current = history.state && typeof history.state === 'object'
    ? history.state as Record<string, unknown>
    : {};
  history.replaceState({ ...current, [REVIEW_HISTORY_STATE_KEY]: handoff });
}

function writeOptional(storage: ReviewHandoffStorage, key: string, value: string | null | undefined) {
  if (value) storage.setItem(key, value);
  else storage.removeItem(key);
}

export function clearReviewHandoff(storage: Pick<Storage, 'removeItem'>): void {
  storage.removeItem(REVIEW_HANDOFF_XDR_KEY);
  storage.removeItem(REVIEW_HANDOFF_NETWORK_KEY);
  storage.removeItem(PRIVATE_NOTE_HANDOFF_KEY);
  storage.removeItem(PRIVATE_COMMITMENT_HANDOFF_KEY);
  storage.removeItem(CREATE_TREASURY_HANDOFF_KEY);
  storage.removeItem(ACCOUNT_SIGNING_INTENT_HANDOFF_KEY);
}

export function writeReviewHandoff(storage: ReviewHandoffStorage, handoff: ReviewHandoffWrite): void {
  const xdr = handoff.xdr.trim();
  if (!xdr) throw new Error('Review handoff requires transaction XDR.');

  storage.setItem(REVIEW_HANDOFF_XDR_KEY, xdr);
  storage.setItem(REVIEW_HANDOFF_NETWORK_KEY, handoff.network);
  writeOptional(storage, PRIVATE_NOTE_HANDOFF_KEY, handoff.privateNote ?? null);
  writeOptional(
    storage,
    PRIVATE_COMMITMENT_HANDOFF_KEY,
    handoff.privateCommitment ? JSON.stringify(handoff.privateCommitment) : null,
  );
  writeOptional(storage, CREATE_TREASURY_HANDOFF_KEY, handoff.createTreasuryAccountId?.trim() || null);
  writeOptional(storage, ACCOUNT_SIGNING_INTENT_HANDOFF_KEY, handoff.accountSigningIntent ?? null);
}

export function takeReviewHandoff(storage: ReviewHandoffStorage, history: ReviewHistory | null = browserReviewHistory()): ReviewHandoff {
  const xdr = storage.getItem(REVIEW_HANDOFF_XDR_KEY)?.trim() ?? '';
  if (!xdr) return historyHandoff(history) ?? emptyHandoff();

  const rawNetwork = storage.getItem(REVIEW_HANDOFF_NETWORK_KEY);
  const handoff: ReviewHandoff = {
    xdr,
    network: rawNetwork === 'public' || rawNetwork === 'testnet' ? rawNetwork : null,
    privateNote: storage.getItem(PRIVATE_NOTE_HANDOFF_KEY)?.trim() || null,
    privateCommitment: parsePrivateCommitment(storage.getItem(PRIVATE_COMMITMENT_HANDOFF_KEY)),
    createTreasuryAccountId: storage.getItem(CREATE_TREASURY_HANDOFF_KEY)?.trim() || null,
    accountSigningIntent: (() => {
      const intent = storage.getItem(ACCOUNT_SIGNING_INTENT_HANDOFF_KEY);
      return intent === 'standalone' || intent === 'offline' || intent === 'treasury' ? intent : null;
    })(),
  };
  clearReviewHandoff(storage);
  retainInHistory(history, handoff);
  return handoff;
}
