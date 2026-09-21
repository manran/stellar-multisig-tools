import type { IntegrationCredentialStore } from './integrationCredentialStore.js';
import {
  createIntegrationAdminService,
  type IntegrationAdminSummary,
} from './integrationAdminService.js';

export async function createTestnetIntegration(
  store: IntegrationCredentialStore,
  input: Record<string, unknown>,
  now = new Date(),
  webhookMasterSecret?: string,
): Promise<{ service: IntegrationAdminSummary; apiKey: string; webhookSecret?: string }> {
  return createIntegrationAdminService(store, {
    ...input,
    enabled: true,
    networks: ['testnet'],
  }, now, webhookMasterSecret);
}
