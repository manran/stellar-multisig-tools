import { createHash, createHmac } from 'node:crypto';

import {
  resolvePublicIntegrationWebhookAddresses,
  type WebhookLookup,
} from './integrationWebhookNetworkPolicy.js';
import {
  IntegrationWebhookTransportError,
} from './nodeIntegrationWebhookHttpTransport.js';
import type {
  IntegrationWebhookHttpRequest,
  IntegrationWebhookHttpResponse,
  IntegrationWebhookHttpTransport,
} from './integrationWebhookHttpTransport.js';

const RELAY_SECRET_PREFIX = 'mrelay_';

type RelayFetch = typeof fetch;

function relaySecretBytes(value: string): Buffer {
  const raw = value.trim();
  if (!raw.startsWith(RELAY_SECRET_PREFIX)) {
    throw new IntegrationWebhookTransportError(
      'Integration webhook relay secret is invalid.',
      'relay_configuration',
    );
  }
  const bytes = Buffer.from(raw.slice(RELAY_SECRET_PREFIX.length), 'base64url');
  if (bytes.length !== 32) {
    throw new IntegrationWebhookTransportError(
      'Integration webhook relay secret is invalid.',
      'relay_configuration',
    );
  }
  return bytes;
}

function requiredRelayUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new IntegrationWebhookTransportError(
      'Integration webhook relay URL is invalid.',
      'relay_configuration',
    );
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new IntegrationWebhookTransportError(
      'Integration webhook relay URL must be HTTPS.',
      'relay_configuration',
    );
  }
  return url;
}

function forwardedHeaders(input: IntegrationWebhookHttpRequest): Headers {
  const headers = new Headers();
  for (const name of ['content-type', 'webhook-id', 'webhook-timestamp', 'webhook-signature']) {
    const value = Object.entries(input.headers).find(([key]) => key.toLowerCase() === name)?.[1];
    if (value) headers.set(name, value);
  }
  return headers;
}

export function integrationWebhookRelaySignature(input: {
  targetUrl: string;
  timestamp: string;
  body: string;
  secret: string;
}): string {
  const digest = createHash('sha256').update(input.body, 'utf8').digest('base64url');
  const canonical = `${input.timestamp}\n${input.targetUrl}\n${digest}`;
  return 'v1=' + createHmac('sha256', relaySecretBytes(input.secret))
    .update(canonical, 'utf8')
    .digest('base64url');
}

export class CloudflareRelayIntegrationWebhookHttpTransport implements IntegrationWebhookHttpTransport {
  private readonly relayUrl: URL;
  private readonly secret: string;

  constructor(
    relayUrl: string,
    relaySecret: string,
    private readonly lookup?: WebhookLookup,
    private readonly relayFetch: RelayFetch = fetch,
  ) {
    this.relayUrl = requiredRelayUrl(relayUrl);
    relaySecretBytes(relaySecret);
    this.secret = relaySecret;
  }

  async post(input: IntegrationWebhookHttpRequest): Promise<IntegrationWebhookHttpResponse> {
    const targetUrl = new URL(input.url);
    await resolvePublicIntegrationWebhookAddresses(targetUrl, this.lookup);

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const headers = forwardedHeaders(input);
    headers.set('x-mst-relay-target', input.url);
    headers.set('x-mst-relay-timestamp', timestamp);
    headers.set('x-mst-relay-signature', integrationWebhookRelaySignature({
      targetUrl: input.url,
      timestamp,
      body: input.body,
      secret: this.secret,
    }));

    const timeoutMs = Math.max(1000, Math.min(input.timeoutMs ?? 10000, 30000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.relayFetch(this.relayUrl, {
        method: 'POST',
        headers,
        body: input.body,
        redirect: 'manual',
        signal: controller.signal,
      });
      return { status: response.status };
    } catch (cause) {
      const timedOut = controller.signal.aborted;
      throw new IntegrationWebhookTransportError(
        timedOut
          ? 'Integration webhook relay timed out.'
          : 'Integration webhook relay failed.',
        timedOut ? 'timeout' : 'relay_network_error',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
