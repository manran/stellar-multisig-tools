import { summarizeInboxActions, type InboxActionCounts, type InboxRequestSnapshot } from './inboxPresentation.js';
import type { InboxSorobanIntentSnapshot } from './sorobanIntentApiTypes.js';
import type { StellarNetwork } from './types.js';

export interface HumanInboxResponse {
  address: string;
  network: StellarNetwork;
  pending_count: number;
  action_count: number;
  action_counts: InboxActionCounts;
  requests: InboxRequestSnapshot[];
  intents: InboxSorobanIntentSnapshot[];
}

interface HumanInboxPage extends HumanInboxResponse {
  complete: boolean;
  nextCursor?: string;
  error?: string;
}

export class InboxLoadError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Never present a partial enumeration as a complete empty or smaller Inbox. */
export async function loadCompleteHumanInbox(
  expected?: { address: string; network: StellarNetwork },
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<HumanInboxResponse> {
  const requests = new Map<string, InboxRequestSnapshot>();
  const intents = new Map<string, InboxSorobanIntentSnapshot>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let identity = expected;
  for (;;) {
    const response = await fetchImpl(cursor ? '/api/inbox?cursor=' + encodeURIComponent(cursor) : '/api/inbox',
      { cache: 'no-store', signal });
    const body = await response.json() as HumanInboxPage;
    if (!response.ok) throw new InboxLoadError(body.error || 'Unable to load your inbox.', response.status);
    identity ??= { address: body.address, network: body.network };
    if (body.address !== identity.address || body.network !== identity.network) {
      throw new InboxLoadError('The wallet session changed. Confirm your wallet and try again.', 403);
    }
    if (!Array.isArray(body.requests) || !Array.isArray(body.intents) || typeof body.complete !== 'boolean') {
      throw new InboxLoadError('Inbox completeness could not be established. Retry to load all tasks.', 503);
    }
    for (const item of body.requests) requests.set(item.id, item);
    for (const item of body.intents) intents.set(item.id, item);
    if (body.complete) {
      if (body.nextCursor !== undefined) throw new InboxLoadError('Invalid Inbox continuation.', 503);
      const allRequests = [...requests.values()], allIntents = [...intents.values()];
      const counts = summarizeInboxActions(allRequests, allIntents);
      return { ...identity, pending_count: allRequests.length + allIntents.length,
        action_count: counts.actionRequired, action_counts: counts, requests: allRequests, intents: allIntents };
    }
    if (!body.nextCursor || cursors.has(body.nextCursor) || cursors.size >= 10000) {
      throw new InboxLoadError('Inbox continuation is unavailable. Retry to load all tasks.', 503);
    }
    cursor = body.nextCursor;
    cursors.add(cursor);
  }
}
