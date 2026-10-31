import { setTimeout as delay } from 'node:timers/promises';

import { closeCoordinationPool } from '../../db/postgres.js';
import { listDueHumanNotificationEventIds } from '../../db/postgresHumanNotificationOutbox.js';
import { dispatchHumanNotificationEvent } from '../../server/humanNotificationDispatcher.js';

const SWEEP_INTERVAL_MS = 5_000;
let stopping = false;

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    console.log(`Received ${signal}; stopping Human notification worker.`);
    stopping = true;
  });
}

async function sweepOnce(): Promise<void> {
  const eventIds = await listDueHumanNotificationEventIds({ limit: 100 });
  let sent = 0;
  let retries = 0;
  let permanentFailures = 0;

  for (const eventId of eventIds) {
    if (stopping) break;
    const result = await dispatchHumanNotificationEvent(eventId);
    if (result.status === 'sent') sent += 1;
    else if (result.status === 'retry_scheduled') retries += 1;
    else if (result.status === 'permanent_failure') permanentFailures += 1;
  }

  if (eventIds.length > 0) {
    console.log('Human notification sweep', {
      scanned: eventIds.length,
      sent,
      retries,
      permanentFailures,
    });
  }
}

async function main(): Promise<void> {
  while (!stopping) {
    try {
      await sweepOnce();
    } catch (cause) {
      console.error('Human notification sweep failed', cause);
    }
    if (!stopping) await delay(SWEEP_INTERVAL_MS);
  }
  await closeCoordinationPool();
}

main().catch(async (cause) => {
  console.error('Human notification worker failed', cause);
  await closeCoordinationPool().catch(() => undefined);
  process.exit(1);
});
