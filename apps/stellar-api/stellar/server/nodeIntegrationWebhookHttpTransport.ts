import https from 'node:https';
import tls from 'node:tls';
import {
  resolvePublicIntegrationWebhookAddresses,
  type WebhookLookup,
} from './integrationWebhookNetworkPolicy.js';
import type {
  IntegrationWebhookHttpRequest,
  IntegrationWebhookHttpResponse,
  IntegrationWebhookHttpTransport,
} from './integrationWebhookHttpTransport.js';

export class IntegrationWebhookTransportError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'IntegrationWebhookTransportError';
  }
}

function hostnameForTls(url: URL): string {
  return url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname;
}

export class NodeIntegrationWebhookHttpTransport implements IntegrationWebhookHttpTransport {
  constructor(private readonly lookup?: WebhookLookup) {}

  async post(input: IntegrationWebhookHttpRequest): Promise<IntegrationWebhookHttpResponse> {
    const url = new URL(input.url);
    const addresses = await resolvePublicIntegrationWebhookAddresses(url, this.lookup);
    const target = addresses.find((item) => item.family === 4) ?? addresses[0];
    if (!target) throw new IntegrationWebhookTransportError('Webhook host has no public address.', 'dns_empty');

    const hostname = hostnameForTls(url);
    const timeoutMs = Math.max(1000, Math.min(input.timeoutMs ?? 10000, 30000));
    const body = Buffer.from(input.body, 'utf8');

    return new Promise<IntegrationWebhookHttpResponse>((resolve, reject) => {
      let settled = false;
      const request = https.request({
        protocol: 'https:',
        hostname,
        port: url.port ? Number(url.port) : 443,
        method: 'POST',
        path: `${url.pathname}${url.search}`,
        servername: hostname,
        headers: {
          ...input.headers,
          host: url.host,
          'content-length': String(body.byteLength),
        },
        createConnection: (options) => {
          const port = typeof options.port === 'string'
            ? Number(options.port)
            : options.port ?? 443;
          return tls.connect({
            host: target.address,
            port,
            servername: hostname,
          });
        },
      }, (response) => {
        const status = response.statusCode ?? 0;
        response.resume();
        response.once('error', () => undefined);
        if (!settled) {
          settled = true;
          resolve({ status });
        }
      });

      request.setTimeout(timeoutMs, () => {
        request.destroy(new IntegrationWebhookTransportError(
          'Integration webhook delivery timed out.',
          'timeout',
        ));
      });
      request.once('error', (cause: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        reject(cause instanceof IntegrationWebhookTransportError
          ? cause
          : new IntegrationWebhookTransportError(
              'Integration webhook delivery failed.',
              cause.code ? `network_${cause.code.toLowerCase()}` : 'network_error',
            ));
      });
      request.end(body);
    });
  }
}
