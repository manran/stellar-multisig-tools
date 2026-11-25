import assert from 'node:assert/strict';
import test from 'node:test';
import { compareInboxPageKeys, inboxPageParameters, mergeInboxPage, type InboxPageKey } from './inboxPage.js';
import { encodeSigningRequestId } from './requestLocator.js';

const at = '2026-11-25T00:00:00.000Z';
function item(index: number) {
  const bytes = Buffer.alloc(10); bytes.writeUInt32BE(index, 6);
  return { id: encodeSigningRequestId(bytes), createdAt: at };
}

test('combined Inbox pages do not silently truncate at 50 or 100 and resolve cross-kind ties', () => {
  for (const count of [0, 1, 50, 51, 100, 101, 203]) {
    for (const limit of [50, 100]) {
      const requests = Array.from({ length: Math.ceil(count / 2) }, (_, i) => item(i+1));
      const intents = Array.from({ length: Math.floor(count / 2) }, (_, i) => item(i+1));
      const keys: InboxPageKey[] = [...requests.map((x) => ({ ...x, kind: 'request' as const })),
        ...intents.map((x) => ({ ...x, kind: 'intent' as const }))].sort(compareInboxPageKeys);
      const seen: string[] = [];
      let after: InboxPageKey | undefined;
      for (;;) {
        const remaining = keys.filter((x) => !after || compareInboxPageKeys(x, after) > 0);
        const page = mergeInboxPage(remaining.filter((x) => x.kind === 'request'), remaining.filter((x) => x.kind === 'intent'), limit);
        assert.ok(page.requests.length + page.intents.length <= limit);
        seen.push(...[...page.requests, ...page.intents].sort(compareInboxPageKeys).map((x) => x.kind+':'+x.id));
        if (page.complete) { assert.equal(page.nextCursor, undefined); break; }
        const url = new URL('https://example.test/inbox'); url.searchParams.set('cursor', page.nextCursor!);
        after = inboxPageParameters(url).after;
      }
      assert.deepEqual(seen, keys.map((x) => x.kind+':'+x.id));
    }
  }
});

test('pagination deduplicates candidates and does not restart on newer insertions', () => {
  const older = item(1), newer = item(2);
  const first = mergeInboxPage([newer, newer, older], [], 1);
  assert.equal(first.complete, false);
  const after = inboxPageParameters(new URL('https://example.test/inbox?cursor='+first.nextCursor)).after!;
  const added = { ...item(3), createdAt: '2026-11-25T01:00:00.000Z' };
  const second = mergeInboxPage([added, newer, older].filter((x) => compareInboxPageKeys({ ...x, kind: 'request' }, after) > 0), [], 1);
  assert.deepEqual(second.requests, [older]);
  assert.equal(second.complete, true);
});

test('invalid cursor and limit are errors, never an empty page', () => {
  for (const query of ['limit=0','limit=101','limit=1.5','cursor=','cursor=invalid']) {
    assert.throws(() => inboxPageParameters(new URL('https://example.test/inbox?'+query)), { code: 'invalid_inbox_page' });
  }
});
