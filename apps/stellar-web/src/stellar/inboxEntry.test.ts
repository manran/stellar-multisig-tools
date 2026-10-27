import assert from 'node:assert/strict';
import test from 'node:test';
import { connectAndVerifyPrivateInbox } from './inboxEntry.js';

test('Inbox connect performs wallet selection then identity verification as one product action', async () => {
  const calls: string[] = [];
  const address = await connectAndVerifyPrivateInbox(
    async () => { calls.push('connect'); return 'GTEST'; },
    async () => { calls.push('unlock'); return 'GTEST'; },
  );
  assert.equal(address, 'GTEST');
  assert.deepEqual(calls, ['connect', 'unlock']);
});

test('Inbox connect does not ask for identity proof when wallet selection is cancelled', async () => {
  let unlocked = false;
  const address = await connectAndVerifyPrivateInbox(
    async () => null,
    async () => { unlocked = true; return 'GTEST'; },
  );
  assert.equal(address, null);
  assert.equal(unlocked, false);
});
