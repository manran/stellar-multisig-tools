export const MAX_PRIVATE_NOTE_BYTES = 8 * 1024;

export interface PrivateNoteRevision {
  version: 1;
  revisionId: string;
  text: string;
  createdAt: string;
  actorAddress?: string;
}

export function privateNoteByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function normalizePrivateNote(value: string): string {
  const text = value.trim();
  if (!text) throw new Error('Private note cannot be empty.');
  if (privateNoteByteLength(text) > MAX_PRIVATE_NOTE_BYTES) {
    throw new Error('Private note is too large.');
  }
  return text;
}
