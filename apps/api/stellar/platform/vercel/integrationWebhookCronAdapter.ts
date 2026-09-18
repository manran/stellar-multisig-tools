import { timingSafeEqual } from 'node:crypto';
import type { IntegrationWebhookWakePublisher } from '../../server/integrationWebhookWake.js';
import { sweepIntegrationWebhookOutbox } from '../../server/integrationWebhookSweep.js';
import {
  coordinationStorageMode,
  type CoordinationStorageMode,
} from '../../server/coordinationStores.js';
import { vercelIntegrationWebhookWakePublisher } from './integrationWebhookQueueAdapter.js';

function authorized(request: Request, secret: string): boolean {
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function vercelIntegrationWebhookSweepHandler(
  request: Request,
  dependencies: {
    cronSecret?: string;
    storageMode?: () => CoordinationStorageMode;
    publisher?: IntegrationWebhookWakePublisher;
    sweep?: typeof sweepIntegrationWebhookOutbox;
  } = {},
): Promise<Response> {
  const secret = dependencies.cronSecret ?? process.env.CRON_SECRET?.trim() ?? '';
  if (!secret) {
    return Response.json(
      { error: 'Webhook sweep is not configured.', code: 'webhook_sweep_not_configured' },
      { status: 503 },
    );
  }
  if (!authorized(request, secret)) {
    return Response.json(
      { error: 'Unauthorized.', code: 'webhook_sweep_unauthorized' },
      { status: 401 },
    );
  }

  const mode = (dependencies.storageMode ?? coordinationStorageMode)();
  if (mode !== 'postgres') {
    return Response.json({ status: 'disabled', storage: mode });
  }

  const result = await (dependencies.sweep ?? sweepIntegrationWebhookOutbox)(
    dependencies.publisher ?? vercelIntegrationWebhookWakePublisher,
    { limit: 100 },
  );
  return Response.json({
    status: 'ok',
    scanned: result.scanned,
    published: result.published.length,
    failed: result.failed.length,
  });
}
