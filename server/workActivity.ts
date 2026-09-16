import type { ActivityRequestItem } from '../src/stellar/activityTypes.js';
import type { StellarNetwork } from '../src/stellar/types.js';
import type { WorkActivityItem } from '../src/stellar/workActivityTypes.js';
import { isValidSigningRequestId } from './requestLocator.js';
import { listSignerActivityItems } from './requestActivity.js';
import type { SigningRequestStore } from './requestStore.js';
import { listSorobanIntentActivityItems } from './sorobanIntentActivity.js';
import type { SorobanIntentStore } from './sorobanIntentStore.js';

function requestActivityAt(item: ActivityRequestItem): string {
  return item.events.at(-1)?.occurredAt ?? item.createdAt;
}

function workKey(item: WorkActivityItem): string {
  return `${item.kind}:${item.workId}`;
}

function compareItems(left: WorkActivityItem, right: WorkActivityItem): number {
  return right.activityAt.localeCompare(left.activityAt) || workKey(right).localeCompare(workKey(left));
}

function encodeCursor(item: WorkActivityItem): string {
  return Buffer.from(`${item.activityAt}\n${workKey(item)}`, 'utf8').toString('base64url');
}

function decodeCursor(value: string | undefined): { activityAt: string; key: string } | null {
  if (!value) return null;
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const newline = decoded.indexOf('\n');
    if (newline <= 0) return null;
    const activityAt = decoded.slice(0, newline);
    const key = decoded.slice(newline + 1);
    const match = /^(request|soroban_intent):(.+)$/.exec(key);
    if (!activityAt || !match || !isValidSigningRequestId(match[2])) return null;
    return { activityAt, key };
  } catch {
    return null;
  }
}

function isAfterCursor(item: WorkActivityItem, cursor: { activityAt: string; key: string }): boolean {
  const key = workKey(item);
  return item.activityAt < cursor.activityAt || (item.activityAt === cursor.activityAt && key < cursor.key);
}

export async function listWorkActivityPage(
  requestStore: SigningRequestStore,
  intentStore: SorobanIntentStore,
  address: string,
  options: { network: StellarNetwork; cursor?: string; limit?: number },
): Promise<{ items: WorkActivityItem[]; nextCursor?: string }> {
  const [requests, intents] = await Promise.all([
    listSignerActivityItems(requestStore, address, { network: options.network }),
    listSorobanIntentActivityItems(intentStore, address, options.network),
  ]);
  const items: WorkActivityItem[] = [
    ...requests.map((request) => ({
      kind: 'request' as const,
      workId: request.requestId,
      activityAt: requestActivityAt(request),
      request,
    })),
    ...intents,
  ].sort(compareItems);
  const cursor = decodeCursor(options.cursor);
  const filtered = cursor ? items.filter((item) => isAfterCursor(item, cursor)) : items;
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  const page = filtered.slice(0, limit);
  return {
    items: page,
    ...(filtered.length > limit && page.length > 0 ? { nextCursor: encodeCursor(page.at(-1)!) } : {}),
  };
}
