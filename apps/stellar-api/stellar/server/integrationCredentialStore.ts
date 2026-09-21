import type { ConfiguredIntegrationCredential } from './integrationCredentialService.js';
import type { IntegrationWebhookConfig } from './integrationWebhookConfig.js';
import type { IntegrationProfilePreferences } from './integrationProfile.js';

export interface StoredIntegrationCredential {
  version: 1;
  credential: ConfiguredIntegrationCredential;
  enabled: boolean;
  webhook?: IntegrationWebhookConfig;
  profile?: IntegrationProfilePreferences;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationCredentialStore {
  getCredential(serviceId: string): Promise<StoredIntegrationCredential | null>;
  listCredentials(): Promise<StoredIntegrationCredential[]>;
  putCredential(record: StoredIntegrationCredential): Promise<void>;
}
