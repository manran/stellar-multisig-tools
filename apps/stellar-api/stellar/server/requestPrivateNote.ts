import { randomUUID } from 'node:crypto';
import { normalizePrivateNote } from '../../../../src/stellar/privateNote.js';
import type { PrivateNoteRevision } from '../../../../src/stellar/privateNote.js';
import { SigningRequestServiceError } from './requestService.js';
import type { SigningRequestStore, StoredSigningRequest } from './requestStore.js';

export async function latestPrivateNote(
  store: SigningRequestStore,
  requestId: string,
): Promise<PrivateNoteRevision | null> {
  const [request, revisions] = await Promise.all([
    store.getRequest(requestId),
    store.listPrivateNoteRevisions?.(requestId) ?? Promise.resolve([]),
  ]);
  return latestPrivateNoteFromFacts(request?.initialPrivateNote, revisions);
}

export async function latestPrivateNoteForRequest(
  store: SigningRequestStore,
  request: StoredSigningRequest,
  revisions?: PrivateNoteRevision[],
): Promise<PrivateNoteRevision | null> {
  const loadedRevisions = revisions ?? await (store.listPrivateNoteRevisions?.(request.id) ?? Promise.resolve([]));
  return latestPrivateNoteFromFacts(request.initialPrivateNote, loadedRevisions);
}

function latestPrivateNoteFromFacts(
  initialPrivateNote: PrivateNoteRevision | undefined,
  revisions: PrivateNoteRevision[],
): PrivateNoteRevision | null {
  const notes = [...(initialPrivateNote ? [initialPrivateNote] : []), ...revisions];
  return [...notes].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt) || b.revisionId.localeCompare(a.revisionId),
  )[0] ?? null;
}

export async function revisePrivateNote(
  store: SigningRequestStore,
  requestId: string,
  value: string,
  options: { now?: Date; actorAddress?: string; revisionIdFactory?: () => string } = {},
): Promise<PrivateNoteRevision> {
  if (!store.putPrivateNoteRevision) {
    throw new SigningRequestServiceError('Private note storage is unavailable.', 503, 'private_note_unavailable');
  }
  let text: string;
  try {
    text = normalizePrivateNote(value);
  } catch (cause) {
    throw new SigningRequestServiceError(
      cause instanceof Error ? cause.message : 'Invalid private note.',
      400,
      'invalid_private_note',
    );
  }
  const revision: PrivateNoteRevision = {
    version: 1,
    revisionId: options.revisionIdFactory?.() ?? randomUUID(),
    text,
    createdAt: (options.now ?? new Date()).toISOString(),
    ...(options.actorAddress ? { actorAddress: options.actorAddress } : {}),
  };
  await store.putPrivateNoteRevision(requestId, revision);
  return revision;
}
