import { configuredIntegrationCredentials, type ConfiguredIntegrationCredential } from './integrationCredentialService.js';
import type { IntegrationCredentialStore } from './integrationCredentialStore.js';
import { configuredDeploymentNetwork } from './deploymentNetworkPolicy.js';

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
  // Testnet self-service writes durable credentials independently of the
  // operator administration endpoint. Keep Mainnet/bootstrap policy unchanged.
  if (configuredDeploymentNetwork() !== 'testnet' && !durableIntegrationRegistryEnabled()) {
    return configuredIntegrationCredentials().find((item) => item.serviceId === serviceId) ?? null;
  }
  return resolveIntegrationCredential(store, serviceId);
}
