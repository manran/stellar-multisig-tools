import { setTimeout as delay } from 'node:timers/promises';

import { closeCoordinationPool } from '../../db/postgres.js';
import { dispatchRuntimeIntegrationWebhookEvent } from '../../server/integrationWebhookRuntime.js';
import { sweepIntegrationWebhookOutbox } from '../../server/integrationWebhookSweep.js';

const SWEEP_INTERVAL_MS = 5_000;
let stopping = false;

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    console.log(`Received ${signal}; stopping webhook worker.`);
    stopping = true;
  });
}

async function sweepOnce(): Promise<void> {
  const result = await sweepIntegrationWebhookOutbox({
    async publish(eventId) {
      await dispatchRuntimeIntegrationWebhookEvent(eventId);
    },
  }, { limit: 100 });

  if (result.scanned > 0 || result.failed.length > 0) {
    console.log('Integration webhook sweep', {
      scanned: result.scanned,
      dispatched: result.published.length,
      failed: result.failed.length,
    });
  }
}

async function main(): Promise<void> {
  while (!stopping) {
    try {
      await sweepOnce();
    } catch (cause) {
      console.error('Integration webhook sweep failed', cause);
    }
    if (!stopping) await delay(SWEEP_INTERVAL_MS);
  }
  await closeCoordinationPool();
}

main().catch(async (cause) => {
  console.error('Integration webhook worker failed', cause);
  await closeCoordinationPool().catch(() => undefined);
  process.exit(1);
});
