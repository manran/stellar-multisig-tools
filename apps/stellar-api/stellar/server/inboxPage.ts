import { isValidSigningRequestId } from './requestLocator.js';

export interface InboxPageKey {
  createdAt: string;
  kind: 'request' | 'intent';
  id: string;
}

export function compareInboxPageKeys(a: InboxPageKey, b: InboxPageKey): number {
  return b.createdAt.localeCompare(a.createdAt) || b.kind.localeCompare(a.kind) || b.id.localeCompare(a.id);
}

export class InvalidInboxPageError extends Error {
  readonly status = 400;
  readonly code = 'invalid_inbox_page';
}

export function inboxPageParameters(url: URL): { limit: number; after?: InboxPageKey } {
  const value = url.searchParams.get('limit');
  const limit = value === null ? 50 : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (value !== null && !/^\d+$/.test(value))) {
    throw new InvalidInboxPageError('Inbox limit must be between 1 and 100.');
  }
  const cursor = url.searchParams.get('cursor');
  if (cursor === null) return { limit };
  try {
    if (cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const after = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as InboxPageKey;
    if (!after || typeof after.createdAt !== 'string' || new Date(after.createdAt).toISOString() !== after.createdAt
      || (after.kind !== 'request' && after.kind !== 'intent') || typeof after.id !== 'string'
      || !isValidSigningRequestId(after.id)) throw new Error();
    return { limit, after };
  } catch {
    throw new InvalidInboxPageError('Invalid Inbox cursor.');
  }
}

export function mergeInboxPage<R extends { id: string; createdAt: string }, I extends { id: string; createdAt: string }>(
  requests: readonly R[], intents: readonly I[], limit: number,
) {
  const keys: InboxPageKey[] = [
    ...requests.map((item) => ({ kind: 'request' as const, id: item.id, createdAt: item.createdAt })),
    ...intents.map((item) => ({ kind: 'intent' as const, id: item.id, createdAt: item.createdAt })),
  ].sort(compareInboxPageKeys);
  const selected = [...new Map(keys.map((key) => [key.kind + ':' + key.id, key])).values()].slice(0, limit + 1);
  const complete = selected.length <= limit;
  const page = selected.slice(0, limit);
  const requestIds = new Set(page.filter((key) => key.kind === 'request').map((key) => key.id));
  const intentIds = new Set(page.filter((key) => key.kind === 'intent').map((key) => key.id));
  return {
    requests: [...new Map(requests.filter((item) => requestIds.has(item.id)).map((item) => [item.id, item])).values()],
    intents: [...new Map(intents.filter((item) => intentIds.has(item.id)).map((item) => [item.id, item])).values()],
    complete,
    ...(!complete ? { nextCursor: Buffer.from(JSON.stringify(page.at(-1)), 'utf8').toString('base64url') } : {}),
  };
}
