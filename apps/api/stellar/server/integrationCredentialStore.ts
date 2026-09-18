import type { ConfiguredIntegrationCredential } from './integrationCredentialService.js';
import type { IntegrationWebhookConfig } from './integrationWebhookConfig.js';

export interface StoredIntegrationCredential {
  version: 1;
  credential: ConfiguredIntegrationCredential;
  enabled: boolean;
  webhook?: IntegrationWebhookConfig;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationCredentialStore {
  getCredential(serviceId: string): Promise<StoredIntegrationCredential | null>;
  listCredentials(): Promise<StoredIntegrationCredential[]>;
  putCredential(record: StoredIntegrationCredential): Promise<void>;
}
