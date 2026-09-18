import { QueueClient } from '@vercel/queue';
import type { IntegrationWebhookWakePublisher } from '../../server/integrationWebhookWake.js';
import { dispatchRuntimeIntegrationWebhookEvent } from '../../server/integrationWebhookRuntime.js';

export const VERCEL_INTEGRATION_WEBHOOK_TOPIC = 'mst-stellar-integration-webhooks';
const RETENTION_SECONDS = 7 * 24 * 60 * 60;
const queueClient = new QueueClient({ region: process.env.VERCEL_REGION ?? 'iad1' });

export interface VercelIntegrationWebhookWakeMessage {
  version: 1;
  eventId: string;
}

export class InvalidVercelIntegrationWebhookWakeError extends Error {
  constructor() {
    super('Invalid Integration webhook Queue message.');
    this.name = 'InvalidVercelIntegrationWebhookWakeError';
  }
}

interface QueueSendOptions {
  retentionSeconds?: number;
  delaySeconds?: number;
}

type QueueSend = (
  topic: string,
  payload: VercelIntegrationWebhookWakeMessage,
  options?: QueueSendOptions,
) => Promise<unknown>;

function wakeMessage(eventId: string): VercelIntegrationWebhookWakeMessage {
  return { version: 1, eventId };
}

export function createVercelIntegrationWebhookWakePublisher(
  queueSend: QueueSend = queueClient.send,
): IntegrationWebhookWakePublisher {
  return {
    async publish(eventId) {
      await queueSend(
        VERCEL_INTEGRATION_WEBHOOK_TOPIC,
        wakeMessage(eventId),
        { retentionSeconds: RETENTION_SECONDS },
      );
    },
  };
}

export const vercelIntegrationWebhookWakePublisher =
  createVercelIntegrationWebhookWakePublisher();

export function retryDelaySeconds(nextAvailableAt: string, now = new Date()): number {
  return Math.max(
    0,
    Math.min(
      RETENTION_SECONDS,
      Math.ceil((Date.parse(nextAvailableAt) - now.getTime()) / 1000),
    ),
  );
}

export async function scheduleVercelIntegrationWebhookRetryWake(
  eventId: string,
  nextAvailableAt: string,
  queueSend: QueueSend = queueClient.send,
  now = new Date(),
): Promise<boolean> {
  try {
    await queueSend(
      VERCEL_INTEGRATION_WEBHOOK_TOPIC,
      wakeMessage(eventId),
      {
        retentionSeconds: RETENTION_SECONDS,
        delaySeconds: retryDelaySeconds(nextAvailableAt, now),
      },
    );
    return true;
  } catch (cause) {
    console.error(
      'Unable to schedule delayed Integration webhook wake; Cron sweep will recover it.',
      cause,
    );
    return false;
  }
}

export async function processVercelIntegrationWebhookWake(
  message: unknown,
  dispatch: (eventId: string) => Promise<{
    status: string;
    nextAvailableAt?: string;
  }> = dispatchRuntimeIntegrationWebhookEvent,
  queueSend: QueueSend = queueClient.send,
): Promise<void> {
  if (
    !message
    || typeof message !== 'object'
    || (message as { version?: unknown }).version !== 1
    || typeof (message as { eventId?: unknown }).eventId !== 'string'
    || !(message as { eventId: string }).eventId.trim()
    || (message as { eventId: string }).eventId.length > 256
  ) {
    throw new InvalidVercelIntegrationWebhookWakeError();
  }

  const eventId = (message as { eventId: string }).eventId.trim();
  const result = await dispatch(eventId);
  if (result.status === 'retry_scheduled' && result.nextAvailableAt) {
    await scheduleVercelIntegrationWebhookRetryWake(
      eventId,
      result.nextAvailableAt,
      queueSend,
    );
  }
}

export function vercelIntegrationWebhookQueueRetry(error: unknown) {
  return error instanceof InvalidVercelIntegrationWebhookWakeError
    ? { acknowledge: true as const }
    : { afterSeconds: 180 };
}

export const vercelIntegrationWebhookQueueHandler =
  queueClient.handleCallback<VercelIntegrationWebhookWakeMessage>(
    async (message) => {
      await processVercelIntegrationWebhookWake(message);
    },
    {
      visibilityTimeoutSeconds: 180,
      retry: vercelIntegrationWebhookQueueRetry,
    },
  );
