import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { Webhook, WebhookVerificationError } from 'standardwebhooks';

import {
  recordHumanNotificationProviderEvent,
  type HumanNotificationProviderDeliveryState,
} from '../db/postgresHumanNotificationOutbox.js';

const MAX_WEBHOOK_BYTES = 64 * 1024;

interface ResendEmailEvent {
  type: string;
  created_at: string;
  data: {
    email_id?: string;
  };
}

type RecordProviderEvent = typeof recordHumanNotificationProviderEvent;

async function webhookSecret(filePath?: string): Promise<string> {
  const path = filePath?.trim() || process.env.RESEND_WEBHOOK_SECRET_FILE?.trim();
  if (!path) throw new Error('RESEND_WEBHOOK_SECRET_FILE is not configured.');
  const value = (await readFile(path, 'utf8')).trim();
  if (!value.startsWith('whsec_')) throw new Error('Resend webhook secret is invalid.');
  return value;
}

function svixHeaders(request: Request): Record<string, string> {
  return {
    'webhook-id': request.headers.get('svix-id') ?? '',
    'webhook-timestamp': request.headers.get('svix-timestamp') ?? '',
    'webhook-signature': request.headers.get('svix-signature') ?? '',
  };
}

function providerState(type: string): HumanNotificationProviderDeliveryState | null {
  if (type === 'email.delivered') return 'delivered';
  if (type === 'email.bounced') return 'bounced';
  return null;
}

export async function handleResendHumanNotificationWebhook(
  request: Request,
  dependencies: {
    pool?: Pool;
    secret?: string;
    secretFile?: string;
    recordProviderEvent?: RecordProviderEvent;
  } = {},
): Promise<Response> {
  const contentLength = Number.parseInt(request.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return Response.json({ error: 'Webhook body is too large.', code: 'webhook_body_too_large' }, { status: 413 });
  }

  const payload = await request.text();
  if (Buffer.byteLength(payload, 'utf8') > MAX_WEBHOOK_BYTES) {
    return Response.json({ error: 'Webhook body is too large.', code: 'webhook_body_too_large' }, { status: 413 });
  }

  let secret: string;
  try {
    secret = dependencies.secret ?? await webhookSecret(dependencies.secretFile);
    new Webhook(secret).verify(payload, svixHeaders(request), { jsonParse: false });
  } catch (cause) {
    const code = cause instanceof WebhookVerificationError
      ? 'invalid_webhook_signature'
      : 'webhook_verification_unavailable';
    return Response.json({ error: 'Webhook verification failed.', code }, {
      status: cause instanceof WebhookVerificationError ? 400 : 503,
    });
  }

  let event: ResendEmailEvent;
  try {
    event = JSON.parse(payload) as ResendEmailEvent;
  } catch {
    return Response.json({ error: 'Webhook payload is invalid.', code: 'invalid_webhook_payload' }, { status: 400 });
  }

  const state = providerState(event.type);
  if (!state) return Response.json({ accepted: true, ignored: true });

  const providerMessageId = event.data?.email_id?.trim();
  const eventAt = new Date(event.created_at);
  const providerEventId = request.headers.get('svix-id')?.trim() ?? '';
  if (!providerMessageId || !providerEventId || Number.isNaN(eventAt.getTime())) {
    return Response.json({ error: 'Webhook payload is incomplete.', code: 'invalid_webhook_payload' }, { status: 400 });
  }

  const recordProviderEvent = dependencies.recordProviderEvent ?? recordHumanNotificationProviderEvent;
  const result = await recordProviderEvent({
    providerMessageId,
    state,
    eventAt,
    providerEventId,
  }, dependencies.pool);

  if (result === 'not_found') {
    return Response.json({
      error: 'Provider message is not ready for reconciliation.',
      code: 'provider_message_not_ready',
    }, { status: 503 });
  }

  return Response.json({
    accepted: true,
    matched: result === 'updated',
    state,
  });
}
