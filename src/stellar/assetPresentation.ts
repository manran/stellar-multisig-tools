import { paymentAssetChoices } from '../../packages/stellar-core/src/paymentAsset.js';
import type { StellarAccountSnapshot } from '../../packages/stellar-core/src/types.js';

export type AssetPresentationKind = 'native' | 'credit';

export interface AssetPresentation {
  key: string;
  kind: AssetPresentationKind;
  code: string;
  issuer?: string;
  balance: string;
  canonicalId: string;
}

export function accountAssetPresentations(account: StellarAccountSnapshot | null): AssetPresentation[] {
  return paymentAssetChoices(account).map((asset) => ({
    key: asset.key,
    kind: asset.issuer ? 'credit' : 'native',
    code: asset.code,
    ...(asset.issuer ? { issuer: asset.issuer } : {}),
    balance: asset.balance,
    canonicalId: asset.issuer ? `${asset.code}:${asset.issuer}` : 'XLM:native',
  }));
}


export interface InspectedAssetIdentity {
  code: string;
  issuer?: string;
  canonicalId: string;
}

export function inspectedAssetIdentity(asset: string): InspectedAssetIdentity {
  const [rawCode, rawIssuer] = asset.split(' · ', 2);
  const code = rawCode?.trim() || asset.trim() || 'Unknown';
  const issuer = rawIssuer?.trim();
  return issuer
    ? { code, issuer, canonicalId: `${code}:${issuer}` }
    : { code, canonicalId: code === 'XLM' ? 'XLM:native' : code };
}

export interface AssetBalanceParts {
  integer: string;
  fraction: string;
}

export function compactAssetIssuer(issuer: string): string {
  return issuer.length <= 22 ? issuer : `${issuer.slice(0, 10)}…${issuer.slice(-8)}`;
}

export function assetBalanceParts(balance: string): AssetBalanceParts {
  const match = balance.match(/^(-?)(\d+)(\.\d+)?$/);
  if (!match) return { integer: balance, fraction: '' };
  const [, sign, digits, fraction = ''] = match;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return { integer: `${sign}${grouped}`, fraction };
}
