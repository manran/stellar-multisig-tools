import type { PaymentAssetChoice } from './paymentAsset.js';

export interface BatchPromotionDraft {
  source: string;
  input: string;
  memo: string;
  privateNote: string;
  lifetimeSeconds: number;
}

export function batchAssetToken(asset: Pick<PaymentAssetChoice, 'code' | 'issuer'>): string {
  return asset.issuer ? `${asset.code}:${asset.issuer}` : 'XLM';
}

export function batchPromotionDraft({
  source,
  destination,
  amount,
  asset,
  memo,
  privateNote,
  lifetimeSeconds,
}: {
  source: string;
  destination: string;
  amount: string;
  asset: Pick<PaymentAssetChoice, 'code' | 'issuer'>;
  memo: string;
  privateNote: string;
  lifetimeSeconds: number;
}): BatchPromotionDraft {
  const destinationValue = destination.trim();
  const amountValue = amount.trim();
  const input = destinationValue || amountValue
    ? `${destinationValue}, ${amountValue}, ${batchAssetToken(asset)}`
    : '';
  return {
    source: source.trim(),
    input,
    memo,
    privateNote,
    lifetimeSeconds,
  };
}
