import type {
  ReusableTemplateDefinition,
  ReusableTemplateKind,
} from '../../../../packages/stellar-core/src/reusableTemplate.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';

export interface StoredReusableTemplate {
  id: string;
  ownerAddress: string;
  network: StellarNetwork;
  name: string;
  kind: ReusableTemplateKind;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface StoredReusableTemplateVersion {
  template: StoredReusableTemplate;
  version: number;
  definition: ReusableTemplateDefinition;
  createdAt: string;
}

export interface ReusableTemplateStore {
  createTemplate(
    template: StoredReusableTemplate,
    version: StoredReusableTemplateVersion,
  ): Promise<void>;
  listTemplates(
    ownerAddress: string,
    network: StellarNetwork,
  ): Promise<StoredReusableTemplateVersion[]>;
  getTemplateVersion(
    id: string,
    version: number,
  ): Promise<StoredReusableTemplateVersion | null>;
}
