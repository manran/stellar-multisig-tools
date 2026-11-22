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
  /** Explicit sender opt-in: after a manual Ask, at most two automatic email reminders. */
  autoRemind?: true;
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
  /** Verified wallet that owns the Template, not the Treasury's legal administrator. */
  ownerAddress?: string;
  /** Active grants are disclosed only when the owner opens their own templates. */
  proposerAddresses?: string[];
  /** Unified MST users who can start a Template payment. Only shown to the owner. */
  proposerUserIds?: string[];
  /** Active one-time invitations. Only shown to the owner. */
  pendingInvitations?: { id: string; expiresAt: string }[];
  network: StellarNetwork;
  name: string;
  kind: ReusableTemplateKind;
  currentVersion: number;
  definition: ReusableTemplateDefinition;
  createdAt: string;
  updatedAt: string;
}
