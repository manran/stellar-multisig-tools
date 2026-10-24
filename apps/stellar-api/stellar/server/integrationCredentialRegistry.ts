import { configuredIntegrationCredentials, type ConfiguredIntegrationCredential } from './integrationCredentialService.js';
import type { IntegrationCredentialStore } from './integrationCredentialStore.js';

const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export function durableIntegrationRegistryEnabled(
  adminSecretHash = process.env.MULTISIG_INTEGRATION_ADMIN_SECRET_HASH,
): boolean {
  return SHA256_PATTERN.test(adminSecretHash?.trim() ?? '');
}

export async function resolveIntegrationCredential(
  store: IntegrationCredentialStore,
  serviceId: string,
): Promise<ConfiguredIntegrationCredential | null> {
  const durable = await store.getCredential(serviceId);
  if (durable) return durable.enabled ? durable.credential : null;
  return configuredIntegrationCredentials().find((item) => item.serviceId === serviceId) ?? null;
}

export async function resolveRuntimeIntegrationCredential(
  store: IntegrationCredentialStore,
  serviceId: string,
): Promise<ConfiguredIntegrationCredential | null> {
  if (!durableIntegrationRegistryEnabled()) {
    return configuredIntegrationCredentials().find((item) => item.serviceId === serviceId) ?? null;
  }
  return resolveIntegrationCredential(store, serviceId);
}
