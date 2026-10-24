import { hkdfSync, randomBytes } from 'node:crypto';
import { Webhook } from 'standardwebhooks';

const MASTER_PREFIX = 'mwh_';
const MASTER_BYTES = 32;
const SERVICE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

export class IntegrationWebhookSigningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrationWebhookSigningError';
  }
}

function masterBytes(value = process.env.MULTISIG_WEBHOOK_MASTER_SECRET): Buffer {
  const raw = value?.trim() ?? '';
  if (!raw.startsWith(MASTER_PREFIX)) {
    throw new IntegrationWebhookSigningError('Integration webhook signing is not configured.');
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(raw.slice(MASTER_PREFIX.length), 'base64url');
  } catch {
    throw new IntegrationWebhookSigningError('Integration webhook signing master secret is invalid.');
  }
  if (bytes.length !== MASTER_BYTES) {
    throw new IntegrationWebhookSigningError('Integration webhook signing master secret is invalid.');
  }
  return bytes;
}

export function createIntegrationWebhookMasterSecret(): string {
  return MASTER_PREFIX + randomBytes(MASTER_BYTES).toString('base64url');
}

export function deriveIntegrationWebhookSecret(
  serviceIdValue: string,
  secretVersion: number,
  masterSecret?: string,
): string {
  const serviceId = serviceIdValue.trim().toLowerCase();
  if (!SERVICE_ID_PATTERN.test(serviceId) || !Number.isInteger(secretVersion) || secretVersion < 1) {
    throw new IntegrationWebhookSigningError('Integration webhook signing context is invalid.');
  }
  const derived = hkdfSync(
    'sha256',
    masterBytes(masterSecret),
    Buffer.from('multisig.tools/integration-webhook/v1', 'utf8'),
    Buffer.from(`${serviceId}:${secretVersion}`, 'utf8'),
    32,
  );
  return 'whsec_' + Buffer.from(derived).toString('base64');
}

export interface SignedIntegrationWebhook {
  headers: {
    'content-type': 'application/json';
    'webhook-id': string;
    'webhook-timestamp': string;
    'webhook-signature': string;
  };
  body: string;
}

export function signIntegrationWebhookPayload(input: {
  serviceId: string;
  secretVersion: number;
  eventId: string;
  timestamp: Date;
  payload: unknown;
  masterSecret?: string;
}): SignedIntegrationWebhook {
  const body = JSON.stringify(input.payload);
  const secret = deriveIntegrationWebhookSecret(
    input.serviceId,
    input.secretVersion,
    input.masterSecret,
  );
  const webhook = new Webhook(secret);
  const timestamp = Math.floor(input.timestamp.getTime() / 1000).toString();
  return {
    headers: {
      'content-type': 'application/json',
      'webhook-id': input.eventId,
      'webhook-timestamp': timestamp,
      'webhook-signature': webhook.sign(input.eventId, input.timestamp, body),
    },
    body,
  };
}
