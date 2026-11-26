import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { grantRequestSource, limitAgentGrant } from './agentGrantRateLimit.js';

test('Agent pairing uses durable atomic per-actor limits, not the Vercel-only firewall', async () => {
  const mode = process.env.MULTISIG_PRIVATE_OBJECT_STORAGE;
  const originalRoot = process.env.MULTISIG_PRIVATE_OBJECT_ROOT;
  const dir = await mkdtemp(join(tmpdir(), 'mst-agent-rate-'));
  process.env.MULTISIG_PRIVATE_OBJECT_STORAGE = 'filesystem';
  process.env.MULTISIG_PRIVATE_OBJECT_ROOT = dir;
  try {
    const now = new Date('2026-11-24T04:00:00Z');
    const attempts = await Promise.allSettled([
      limitAgentGrant('ip:127.0.0.1', now, 2),
      limitAgentGrant('ip:127.0.0.1', now, 2),
      limitAgentGrant('ip:127.0.0.1', now, 2),
    ]);
    assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 2);
    const denied = attempts.filter((r) => r.status === 'rejected');
    assert.equal(denied.length, 1);
    assert.equal(denied[0].reason.code, 'agent_pairing_rate_limited');
    assert.deepEqual(denied[0].reason.details, { retryAfterSeconds: 600, limit: 2, remaining: 0 });
    await assert.rejects(limitAgentGrant('ip:127.0.0.1', new Date(now.getTime() + 599001), 2),
      (error: any) => error.details?.retryAfterSeconds === 1);
    await limitAgentGrant('ip:127.0.0.2', now, 2);
    await limitAgentGrant('ip:127.0.0.1', new Date(now.getTime() + 600000), 2);
  } finally {
    if (mode === undefined) delete process.env.MULTISIG_PRIVATE_OBJECT_STORAGE;
    else process.env.MULTISIG_PRIVATE_OBJECT_STORAGE = mode;
    if (originalRoot === undefined) delete process.env.MULTISIG_PRIVATE_OBJECT_ROOT;
    else process.env.MULTISIG_PRIVATE_OBJECT_ROOT = originalRoot;
    await rm(dir, { recursive: true, force: true });
  }
});

test('Agent pairing ignores client-supplied X-Real-IP and X-Forwarded-For spoofing', () => {
  const a = new Request('https://example.test/agent-grants', {
    headers: { 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' },
  });
  assert.equal(grantRequestSource(a), 'unknown');
  const b = new Request('https://example.test/agent-grants', {
    headers: { 'cf-connecting-ip': '192.0.2.3' },
  });
  assert.equal(grantRequestSource(b), 'ip:192.0.2.3');
  const c = new Request('https://example.test/agent-grants', {
    headers: { 'cf-connecting-ip': 'evil.invalid' },
  });
  assert.equal(grantRequestSource(c), 'unknown');
});
