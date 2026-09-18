import type { PrivateNoteRevision } from '../../../../src/stellar/privateNote.js';

export interface StoredSorobanIntentPrivateData {
  version: 1;
  initialPrivateNote?: PrivateNoteRevision;
}

export interface SorobanIntentPrivateDataStore {
  getIntentPrivateData(id: string): Promise<StoredSorobanIntentPrivateData | null>;
  putIntentPrivateData(id: string, value: StoredSorobanIntentPrivateData): Promise<void>;
}
