import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCompleteHumanInbox } from '../../../../packages/stellar-core/src/humanInboxClient.js';

const identity = { address: 'fixture-signer', network: 'testnet' as const };
const first = { ...identity, requests: [{ id: 'request-1', viewerAction: 'sign' }], intents: [], complete: false, nextCursor: 'page-2' };
const last = { ...identity, requests: [{ id: 'request-1', viewerAction: 'waiting_for_others' }],
  intents: [{ id: 'intent-1', viewerAction: 'reconcile_execution' }], complete: true };

test('Human Inbox assembles and deduplicates every page before reporting counts', async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (url) => {
    urls.push(String(url));
    return Response.json(urls.length === 1 ? first : last);
  };
  const result = await loadCompleteHumanInbox(identity, undefined, fetchImpl);
  assert.deepEqual(urls, ['/api/inbox','/api/inbox?cursor=page-2']);
  assert.equal(result.pending_count, 2);
  assert.equal(result.action_counts.signatureNeeded, 0);
  assert.equal(result.action_counts.needsAttention, 1);
});

test('failed, missing, or inconsistent continuation does not return partial Inbox', async () => {
  for (const response of [Response.json({error:'offline'}, {status:503}),
    Response.json({...last, complete: undefined}),
    Response.json({...last, address:'other'}),
    Response.json(first)]) {
    let calls=0;
    await assert.rejects(() => loadCompleteHumanInbox(identity, undefined, async () => ++calls === 1 ? Response.json(first) : response.clone()));
    assert.equal(calls,2);
  }
});
