import type { PrivateNoteRevision } from '../../../../packages/stellar-core/src/privateNote.js';

export interface StoredSorobanIntentPrivateData {
  version: 1;
  initialPrivateNote?: PrivateNoteRevision;
}

export interface SorobanIntentPrivateDataStore {
  getIntentPrivateData(id: string): Promise<StoredSorobanIntentPrivateData | null>;
  putIntentPrivateData(id: string, value: StoredSorobanIntentPrivateData): Promise<void>;
}
