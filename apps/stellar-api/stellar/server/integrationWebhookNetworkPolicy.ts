import { lookup as defaultLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { integrationWebhookIpIsPublic } from './integrationWebhookConfig.js';

export interface ResolvedWebhookAddress {
  address: string;
  family: number;
}

export class IntegrationWebhookNetworkPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrationWebhookNetworkPolicyError';
  }
}

export type WebhookLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<ResolvedWebhookAddress[]>;

export async function resolvePublicIntegrationWebhookAddresses(
  value: string | URL,
  lookup: WebhookLookup = defaultLookup as WebhookLookup,
): Promise<ResolvedWebhookAddress[]> {
  const url = typeof value === 'string' ? new URL(value) : value;
  const hostname = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname;

  const family = isIP(hostname);
  if (family) {
    if (!integrationWebhookIpIsPublic(hostname)) {
      throw new IntegrationWebhookNetworkPolicyError('Webhook host is not public.');
    }
    return [{ address: hostname, family }];
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new IntegrationWebhookNetworkPolicyError('Webhook host did not resolve to an address.');
  }
  if (addresses.some((item) => !integrationWebhookIpIsPublic(item.address))) {
    throw new IntegrationWebhookNetworkPolicyError(
      'Webhook host resolves to a non-public address.',
    );
  }
  return addresses;
}
