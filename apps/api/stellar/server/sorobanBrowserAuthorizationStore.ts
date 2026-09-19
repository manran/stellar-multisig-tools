export interface StoredSorobanBrowserAuthorizationCapability {
  version: 1;
  capabilityId: string;
  intentId: string;
  integrationServiceId: string;
  signerAddress: string;
  authorizationPlanRevision: number;
  authorizationPlanDigest: string;
  origin: string;
  secretHash: string;
  createdAt: string;
  expiresAt: string;
}

export interface SorobanBrowserAuthorizationStore {
  getCapability(capabilityId: string): Promise<StoredSorobanBrowserAuthorizationCapability | null>;
  putCapability(record: StoredSorobanBrowserAuthorizationCapability): Promise<void>;
}
