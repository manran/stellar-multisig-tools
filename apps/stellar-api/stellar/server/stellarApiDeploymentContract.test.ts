import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const apiFiles = [
  'account-create-prepare.ts',
  'activity.ts',
  'address-book.ts',
  'agent-access.ts',
  'auth.ts',
  'contract-call.ts',
  'contract-interface.ts',
  'contract-prepare.ts',
  'contracts.ts',
  'inbox.ts',
  'integration-admin.ts',
  'integration-execution.ts',
  'integration-testnet.ts',
  'integration-webhook-dispatch.ts',
  'integration-webhook-sweep.ts',
  'intent.ts',
  'openapi.ts',
  'operations.ts',
  'payment-prepare.ts',
  'request.ts',
  'runtime-config.ts',
  'stellar-toml.ts',
  'treasuries.ts',
  'treasury-box.ts',
] as const;

test('standalone Stellar API owns the complete Vercel entrypoint set', () => {
  const entrypoints = readdirSync(new URL('../../api/', import.meta.url))
    .filter((name) => name.endsWith('.ts'))
    .sort();
  assert.deepEqual(entrypoints, [...apiFiles].sort());
});

test('standalone Stellar API owns OpenAPI, Queue, and Cron deployment wiring', () => {
  const config = JSON.parse(
    readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'),
  ) as {
    functions?: Record<string, { experimentalTriggers?: Array<Record<string, unknown>> }>;
    crons?: Array<{ path?: string; schedule?: string }>;
    rewrites?: Array<{ source?: string; destination?: string }>;
  };

  assert.deepEqual(
    config.functions?.['api/integration-webhook-dispatch.ts']?.experimentalTriggers,
    [{
      type: 'queue/v2beta',
      topic: 'mst-stellar-integration-webhooks',
      retryAfterSeconds: 180,
      initialDelaySeconds: 0,
    }],
  );
  assert.deepEqual(config.crons, [{
    path: '/api/integration-webhook-sweep',
    schedule: '0 * * * *',
  }]);

  assert.ok(config.rewrites?.some((rewrite) =>
    rewrite.source === '/openapi.json' && rewrite.destination === '/api/openapi'));
});
