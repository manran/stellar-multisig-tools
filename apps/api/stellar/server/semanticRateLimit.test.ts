import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beforeFirstDurableWrite,
  enforceSemanticRateLimit,
  SemanticRateLimitError,
  semanticRateLimitKey,
} from './semanticRateLimit.js';

const request = new Request('https://stellar.multisig.tools/api/request', { method: 'POST' });

test('semantic quota uses the verified identity key and configured rule id', async () => {
  let received: { id: string; key: string } | null = null;
  const result = await enforceSemanticRateLimit(request, {
    rateLimitId: 'request-create',
    rateLimitKey: semanticRateLimitKey('testnet', 'GABC'),
    errorCode: 'request_create_rate_limited',
    errorMessage: 'Too many proposals.',
    check: async (id, options) => {
      received = { id, key: options.rateLimitKey };
      return { rateLimited: false };
    },
  });

  assert.deepEqual(received, { id: 'request-create', key: 'testnet:GABC' });
  assert.deepEqual(result, { configured: true });
});

test('semantic quota returns a stable 429 error when the principal bucket is exhausted', async () => {
  await assert.rejects(
    () => enforceSemanticRateLimit(request, {
      rateLimitId: 'request-create',
      rateLimitKey: 'public:GABC',
      errorCode: 'request_create_rate_limited',
      errorMessage: 'Too many proposals. Try again later.',
      check: async () => ({ rateLimited: true }),
    }),
    (cause: unknown) => cause instanceof SemanticRateLimitError
      && cause.status === 429
      && cause.code === 'request_create_rate_limited'
      && cause.message === 'Too many proposals. Try again later.',
  );
});

test('missing Vercel rule is explicit but fail-open until the platform rule is published', async () => {
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    const result = await enforceSemanticRateLimit(request, {
      rateLimitId: 'treasury-admin',
      rateLimitKey: 'testnet:GTR',
      errorCode: 'treasury_admin_rate_limited',
      errorMessage: 'Too many Treasury changes.',
      check: async () => ({ rateLimited: false, error: 'not-found' }),
    });
    assert.deepEqual(result, { configured: false });
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
  }
});

test('blocked or failed quota checks fail closed for durable writes', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    for (const check of [
      async () => ({ rateLimited: true, error: 'blocked' as const }),
      async () => { throw new Error('network down'); },
    ]) {
      await assert.rejects(
        () => enforceSemanticRateLimit(request, {
          rateLimitId: 'agent-access-admin',
          rateLimitKey: 'public:GABC',
          errorCode: 'agent_access_rate_limited',
          errorMessage: 'Too many credential changes.',
          check,
        }),
        (cause: unknown) => cause instanceof SemanticRateLimitError
          && cause.status === 503
          && cause.code === 'rate_limit_unavailable',
      );
    }
  } finally {
    console.error = originalError;
  }
});

test('beforeFirstDurableWrite runs one shared check for a multi-write mutation', async () => {
  let calls = 0;
  const beforeWrite = beforeFirstDurableWrite(async () => {
    calls += 1;
  });

  await Promise.all([beforeWrite(), beforeWrite(), beforeWrite()]);
  assert.equal(calls, 1);
});
