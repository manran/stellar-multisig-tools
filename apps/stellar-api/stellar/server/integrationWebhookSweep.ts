import type { Pool } from 'pg';
import { listDueIntegrationOutboxEventIds } from '../db/postgresIntegrationOutboxDispatch.js';
import {
  publishIntegrationWebhookWakeBatch,
  type IntegrationWebhookWakePublisher,
} from './integrationWebhookWake.js';

export interface IntegrationWebhookSweepResult {
  scanned: number;
  published: string[];
  failed: Array<{ eventId: string; error: unknown }>;
}

export async function sweepIntegrationWebhookOutbox(
  publisher: IntegrationWebhookWakePublisher,
  options: {
    pool?: Pool;
    now?: Date;
    limit?: number;
  } = {},
): Promise<IntegrationWebhookSweepResult> {
  const eventIds = await listDueIntegrationOutboxEventIds({
    ...(options.pool ? { pool: options.pool } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.limit ? { limit: options.limit } : {}),
  });
  const result = await publishIntegrationWebhookWakeBatch(eventIds, publisher);
  return {
    scanned: eventIds.length,
    published: result.published,
    failed: result.failed,
  };
}
