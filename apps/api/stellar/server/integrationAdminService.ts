import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  configuredIntegrationCredentials,
  createIntegrationApiKey,
  IntegrationCredentialServiceError,
  normalizeConfiguredIntegrationCredential,
  type ConfiguredIntegrationCredential,
} from './integrationCredentialService.js';
import { RequestStorageUnavailableError } from './blobRequestStore.js';
import type { IntegrationCredentialStore, StoredIntegrationCredential } from './integrationCredentialStore.js';
import {
  integrationWebhookConfigFromInput,
  IntegrationWebhookConfigError,
  type IntegrationWebhookConfig,
} from './integrationWebhookConfig.js';
import {
  deriveIntegrationWebhookSecret,
  IntegrationWebhookSigningError,
} from './integrationWebhookSigning.js';

const ADMIN_KEY_PREFIX = 'mia';
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export interface IntegrationAdminSummary {
  serviceId: string;
  label: string;
  enabled: boolean;
  source: 'bootstrap' | 'durable';
  networks: ConfiguredIntegrationCredential['networks'];
  classicSourceAccounts: string[];
  classicExternalExecutionSourceAccounts: string[];
  sorobanContracts: ConfiguredIntegrationCredential['sorobanContracts'];
  sorobanExecutionAccounts: string[];
  sorobanDefaultExecutor?: string;
  webhook?: IntegrationWebhookConfig;
  createdAt?: string;
  updatedAt?: string;
}

export class IntegrationAdminServiceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'IntegrationAdminServiceError';
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createIntegrationAdminSecret(): { adminSecret: string; secretHash: string } {
  const adminSecret = `${ADMIN_KEY_PREFIX}_${randomBytes(32).toString('base64url')}`;
  return { adminSecret, secretHash: sha256(adminSecret) };
}

export function authenticateIntegrationAdminSecret(
  value: string,
  expectedHash = process.env.MULTISIG_INTEGRATION_ADMIN_SECRET_HASH,
): void {
  const secret = value.trim();
  const configured = expectedHash?.trim().toLowerCase() ?? '';
  if (!SHA256_PATTERN.test(configured)) {
    throw new IntegrationAdminServiceError('Integration administration is not configured.', 503, 'integration_admin_not_configured');
  }
  if (!secret.startsWith(`${ADMIN_KEY_PREFIX}_`)) {
    throw new IntegrationAdminServiceError('Invalid Integration administrator credential.', 401, 'invalid_integration_admin_credential');
  }
  const expected = Buffer.from(configured, 'hex');
  const actual = Buffer.from(sha256(secret), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new IntegrationAdminServiceError('Invalid Integration administrator credential.', 401, 'invalid_integration_admin_credential');
  }
}

function summary(record: StoredIntegrationCredential, source: 'durable'): IntegrationAdminSummary;
function summary(record: ConfiguredIntegrationCredential, source: 'bootstrap'): IntegrationAdminSummary;
function summary(record: StoredIntegrationCredential | ConfiguredIntegrationCredential, source: 'bootstrap' | 'durable'): IntegrationAdminSummary {
  const stored = source === 'durable' ? record as StoredIntegrationCredential : null;
  const credential = stored ? stored.credential : record as ConfiguredIntegrationCredential;
  return {
    serviceId: credential.serviceId,
    label: credential.label,
    enabled: stored ? stored.enabled : true,
    source,
    networks: credential.networks,
    classicSourceAccounts: credential.classicSourceAccounts,
    classicExternalExecutionSourceAccounts: credential.classicExternalExecutionSourceAccounts,
    sorobanContracts: credential.sorobanContracts,
    sorobanExecutionAccounts: credential.sorobanExecutionAccounts,
    ...(credential.sorobanDefaultExecutor ? { sorobanDefaultExecutor: credential.sorobanDefaultExecutor } : {}),
    ...(stored?.webhook ? { webhook: stored.webhook } : {}),
    ...(stored ? { createdAt: stored.createdAt, updatedAt: stored.updatedAt } : {}),
  };
}

export async function listIntegrationAdminServices(store: IntegrationCredentialStore): Promise<IntegrationAdminSummary[]> {
  let durable: StoredIntegrationCredential[];
  try {
    durable = await store.listCredentials();
  } catch (cause) {
    if (cause instanceof RequestStorageUnavailableError) {
      throw new IntegrationAdminServiceError('Integration administration storage is unavailable.', 503, 'integration_admin_storage_unavailable');
    }
    throw cause;
  }
  const byId = new Map(configuredIntegrationCredentials().map((item) => [item.serviceId, summary(item, 'bootstrap')]));
  for (const item of durable) byId.set(item.credential.serviceId, summary(item, 'durable'));
  return [...byId.values()].sort((a, b) => a.serviceId.localeCompare(b.serviceId));
}

function integrationWebhookSecret(
  serviceId: string,
  webhook: IntegrationWebhookConfig,
  masterSecret?: string,
): string {
  try {
    return deriveIntegrationWebhookSecret(serviceId, webhook.secretVersion, masterSecret);
  } catch (cause) {
    if (cause instanceof IntegrationWebhookSigningError) {
      throw new IntegrationAdminServiceError(
        'Integration webhook signing is not configured for this deployment.',
        503,
        'integration_webhook_signing_not_configured',
      );
    }
    throw cause;
  }
}

function normalizeInput(input: Record<string, unknown>, secretHash: string): ConfiguredIntegrationCredential {
  try {
    return normalizeConfiguredIntegrationCredential({ ...input, secretHash });
  } catch (cause) {
    if (cause instanceof IntegrationCredentialServiceError) {
      throw new IntegrationAdminServiceError(cause.message, 400, 'invalid_integration_admin_configuration');
    }
    throw cause;
  }
}

async function currentRecord(store: IntegrationCredentialStore, serviceId: string): Promise<StoredIntegrationCredential | null> {
  const durable = await store.getCredential(serviceId);
  if (durable) return durable;
  const bootstrap = configuredIntegrationCredentials().find((item) => item.serviceId === serviceId);
  if (!bootstrap) return null;
  const now = new Date().toISOString();
  return { version: 1, credential: bootstrap, enabled: true, createdAt: now, updatedAt: now };
}

export async function createIntegrationAdminService(
  store: IntegrationCredentialStore,
  input: Record<string, unknown>,
  now = new Date(),
  webhookMasterSecret?: string,
): Promise<{ service: IntegrationAdminSummary; apiKey: string; webhookSecret?: string }> {
  const serviceId = typeof input.serviceId === 'string' ? input.serviceId.trim().toLowerCase() : '';
  if (!serviceId) throw new IntegrationAdminServiceError('Service id is required.', 400, 'integration_service_id_required');
  if (await currentRecord(store, serviceId)) {
    throw new IntegrationAdminServiceError('This Integration Service already exists.', 409, 'integration_service_exists');
  }
  const generated = createIntegrationApiKey(serviceId);
  const credential = normalizeInput(input, generated.secretHash);
  const timestamp = now.toISOString();
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : true;
  let webhook: IntegrationWebhookConfig | undefined;
  try {
    webhook = integrationWebhookConfigFromInput(input.webhook);
  } catch (cause) {
    if (cause instanceof IntegrationWebhookConfigError) {
      throw new IntegrationAdminServiceError(cause.message, 400, 'invalid_integration_webhook_configuration');
    }
    throw cause;
  }
  const webhookSecret = webhook
    ? integrationWebhookSecret(serviceId, webhook, webhookMasterSecret)
    : undefined;
  const record: StoredIntegrationCredential = {
    version: 1, credential, enabled,
    ...(webhook ? { webhook } : {}),
    createdAt: timestamp, updatedAt: timestamp,
  };
  await store.putCredential(record);
  return {
    service: summary(record, 'durable'),
    apiKey: generated.apiKey,
    ...(webhookSecret ? { webhookSecret } : {}),
  };
}

export async function updateIntegrationAdminService(
  store: IntegrationCredentialStore,
  serviceIdValue: string,
  input: Record<string, unknown>,
  now = new Date(),
): Promise<IntegrationAdminSummary> {
  const serviceId = serviceIdValue.trim().toLowerCase();
  const current = await currentRecord(store, serviceId);
  if (!current) throw new IntegrationAdminServiceError('Integration Service was not found.', 404, 'integration_service_not_found');
  const credential = normalizeInput({ ...input, serviceId }, current.credential.secretHash);
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : current.enabled;
  const updated: StoredIntegrationCredential = {
    version: 1,
    credential,
    enabled,
    ...(current.webhook ? { webhook: current.webhook } : {}),
    createdAt: current.createdAt,
    updatedAt: now.toISOString(),
  };
  await store.putCredential(updated);
  return summary(updated, 'durable');
}

export async function configureIntegrationAdminWebhook(
  store: IntegrationCredentialStore,
  serviceIdValue: string,
  webhookInput: unknown,
  now = new Date(),
  webhookMasterSecret?: string,
): Promise<{ service: IntegrationAdminSummary; webhookSecret?: string }> {
  const serviceId = serviceIdValue.trim().toLowerCase();
  const current = await currentRecord(store, serviceId);
  if (!current) throw new IntegrationAdminServiceError('Integration Service was not found.', 404, 'integration_service_not_found');
  let webhook: IntegrationWebhookConfig | undefined;
  try {
    webhook = integrationWebhookConfigFromInput(webhookInput, current.webhook);
  } catch (cause) {
    if (cause instanceof IntegrationWebhookConfigError) {
      throw new IntegrationAdminServiceError(cause.message, 400, 'invalid_integration_webhook_configuration');
    }
    throw cause;
  }
  const webhookSecret = webhook
    ? integrationWebhookSecret(serviceId, webhook, webhookMasterSecret)
    : undefined;
  const updated: StoredIntegrationCredential = {
    ...current,
    ...(webhook ? { webhook } : {}),
    updatedAt: now.toISOString(),
  };
  if (!webhook) delete updated.webhook;
  await store.putCredential(updated);
  return {
    service: summary(updated, 'durable'),
    ...(webhookSecret ? { webhookSecret } : {}),
  };
}

export async function rotateIntegrationAdminWebhookSecret(
  store: IntegrationCredentialStore,
  serviceIdValue: string,
  now = new Date(),
  webhookMasterSecret?: string,
): Promise<{ service: IntegrationAdminSummary; webhookSecret: string }> {
  const serviceId = serviceIdValue.trim().toLowerCase();
  const current = await currentRecord(store, serviceId);
  if (!current) throw new IntegrationAdminServiceError('Integration Service was not found.', 404, 'integration_service_not_found');
  if (!current.webhook) {
    throw new IntegrationAdminServiceError('Integration Service webhook is not configured.', 409, 'integration_webhook_not_configured');
  }
  const webhook = { ...current.webhook, secretVersion: current.webhook.secretVersion + 1 };
  const webhookSecret = integrationWebhookSecret(serviceId, webhook, webhookMasterSecret);
  const updated: StoredIntegrationCredential = {
    ...current,
    webhook,
    updatedAt: now.toISOString(),
  };
  await store.putCredential(updated);
  return {
    service: summary(updated, 'durable'),
    webhookSecret,
  };
}

export async function rotateIntegrationAdminCredential(
  store: IntegrationCredentialStore,
  serviceIdValue: string,
  now = new Date(),
): Promise<{ service: IntegrationAdminSummary; apiKey: string }> {
  const serviceId = serviceIdValue.trim().toLowerCase();
  const current = await currentRecord(store, serviceId);
  if (!current) throw new IntegrationAdminServiceError('Integration Service was not found.', 404, 'integration_service_not_found');
  const generated = createIntegrationApiKey(serviceId);
  const updated: StoredIntegrationCredential = {
    ...current,
    credential: { ...current.credential, secretHash: generated.secretHash },
    updatedAt: now.toISOString(),
  };
  await store.putCredential(updated);
  return { service: summary(updated, 'durable'), apiKey: generated.apiKey };
}
