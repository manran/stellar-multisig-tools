export type StellarNetwork = 'public' | 'testnet';
export type ThresholdLevel = 'low' | 'medium' | 'high';

export interface StellarSigner {
  key: string;
  type: string;
  weight: number;
  sponsor?: string;
}

export interface StellarThresholds {
  low: number;
  medium: number;
  high: number;
}

export interface StellarBalance {
  assetType: string;
  assetCode: string;
  assetIssuer?: string;
  balance: string;
  sellingLiabilities: string;
  buyingLiabilities: string;
  limit?: string;
  authorized?: boolean;
}

export interface StellarAccountSnapshot {
  accountId: string;
  sequence: string;
  sequenceLedger?: number;
  sequenceTime?: string;
  homeDomain?: string;
  subentryCount: number;
  numSponsoring: number;
  numSponsored: number;
  nativeBalance?: string;
  nativeSellingLiabilities?: string;
  balances?: StellarBalance[];
  thresholds: StellarThresholds;
  signers: StellarSigner[];
}

export interface ThresholdAuthorizationSummary {
  level: ThresholdLevel;
  threshold: number;
  reachable: boolean;
  totalActiveWeight: number;
  minimumSignerCount: number | null;
  singleSignerKeys: string[];
  exampleMinimumSets: string[][];
  policyLabel: string;
  exactNOfM: { required: number; total: number } | null;
  guaranteedSignerFailuresTolerated: number | null;
}

export type FindingSeverity = 'critical' | 'warning' | 'info';

export interface SecurityFinding {
  severity: FindingSeverity;
  title: string;
  detail: string;
}

export interface AccountAuthorizationAnalysis {
  totalActiveWeight: number;
  activeSignerCount: number;
  masterKeyWeight: number;
  thresholds: Record<ThresholdLevel, ThresholdAuthorizationSummary>;
  findings: SecurityFinding[];
}
