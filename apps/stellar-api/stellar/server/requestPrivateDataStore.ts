import type { PrivateCommitmentRecord } from '../../../../src/stellar/privateCommitment.js';
import type { PrivateNoteRevision } from '../../../../src/stellar/privateNote.js';

export interface StoredRequestPrivateData {
  version: 1;
  initialPrivateNote?: PrivateNoteRevision;
  privateCommitment?: PrivateCommitmentRecord;
}

export interface RequestPrivateDataStore {
  getRequestPrivateData(id: string): Promise<StoredRequestPrivateData | null>;
  putRequestPrivateData(id: string, value: StoredRequestPrivateData): Promise<void>;
  listPrivateNoteRevisions(id: string): Promise<PrivateNoteRevision[]>;
  putPrivateNoteRevision(id: string, value: PrivateNoteRevision): Promise<void>;
}
