import type { ConfiguredIntegrationCredential } from './integrationCredentialService.js';

export interface StoredIntegrationCredential {
  version: 1;
  credential: ConfiguredIntegrationCredential;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationCredentialStore {
  getCredential(serviceId: string): Promise<StoredIntegrationCredential | null>;
  listCredentials(): Promise<StoredIntegrationCredential[]>;
  putCredential(record: StoredIntegrationCredential): Promise<void>;
}
