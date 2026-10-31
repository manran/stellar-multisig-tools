import type { StellarNetwork } from './types.js';

export type ReusableTemplateKind = 'payment' | 'batch_payment';

export interface ReusablePaymentTemplateRecipient {
  destination: string;
  assetKey: string;
}

export interface ReusablePaymentTemplateDefinitionV1 {
  version: 1;
  source: string;
  recipients: ReusablePaymentTemplateRecipient[];
  signingWindowSeconds: number;
}

export type ReusableTemplateDefinition = ReusablePaymentTemplateDefinitionV1;

export interface ReusableTemplateRef {
  id: string;
  version: number;
  name?: string;
  kind?: ReusableTemplateKind;
}

export interface ReusableTemplateSummary {
  id: string;
  network: StellarNetwork;
  name: string;
  kind: ReusableTemplateKind;
  currentVersion: number;
  definition: ReusableTemplateDefinition;
  createdAt: string;
  updatedAt: string;
}
