import ipaddr from 'ipaddr.js';

const MAX_WEBHOOK_URL_LENGTH = 2048;

export interface IntegrationWebhookConfig {
  version: 1;
  url: string;
  enabled: boolean;
  secretVersion: number;
}

export class IntegrationWebhookConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrationWebhookConfigError';
  }
}

export function integrationWebhookIpIsPublic(hostname: string): boolean {
  const candidate = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  if (!ipaddr.isValid(candidate)) return true;
  const address = ipaddr.parse(candidate);
  if (address instanceof ipaddr.IPv6 && address.isIPv4MappedAddress()) {
    return address.toIPv4Address().range() === 'unicast';
  }
  return address.range() === 'unicast';
}

export function normalizeIntegrationWebhookUrl(value: unknown): string {
  if (typeof value !== 'string') {
    throw new IntegrationWebhookConfigError('Webhook URL must be an HTTPS URL.');
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_WEBHOOK_URL_LENGTH) {
    throw new IntegrationWebhookConfigError('Webhook URL must be an HTTPS URL of at most 2048 characters.');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new IntegrationWebhookConfigError('Webhook URL is invalid.');
  }
  if (url.protocol !== 'https:') {
    throw new IntegrationWebhookConfigError('Webhook URL must use HTTPS.');
  }
  if (url.username || url.password) {
    throw new IntegrationWebhookConfigError('Webhook URL must not contain embedded credentials.');
  }
  if (url.hash) {
    throw new IntegrationWebhookConfigError('Webhook URL must not contain a fragment.');
  }

  const hostname = url.hostname.toLowerCase();
  if (
    !hostname
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || !integrationWebhookIpIsPublic(hostname)
  ) {
    throw new IntegrationWebhookConfigError('Webhook URL must target a public host.');
  }

  url.hostname = hostname;
  return url.toString();
}

export function integrationWebhookConfigFromInput(
  value: unknown,
  current?: IntegrationWebhookConfig,
): IntegrationWebhookConfig | undefined {
  if (value === undefined) return current;
  if (value === null) return undefined;
  if (!value || typeof value !== 'object') {
    throw new IntegrationWebhookConfigError('Webhook configuration is invalid.');
  }
  const record = value as Record<string, unknown>;
  const url = normalizeIntegrationWebhookUrl(record.url);
  const enabled = typeof record.enabled === 'boolean' ? record.enabled : true;
  return {
    version: 1,
    url,
    enabled,
    secretVersion: current?.secretVersion ?? 1,
  };
}
