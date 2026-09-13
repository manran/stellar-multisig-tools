import { ChevronDown } from 'lucide-react';
import { assetBalanceParts, compactAssetIssuer } from './stellar/assetPresentation';
import type { PaymentAssetChoice } from './stellar/paymentAsset';

export default function PaymentAssetPicker({ assets, value, onChange, disabled, ariaLabel = 'Payment asset' }: {
  assets: PaymentAssetChoice[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  ariaLabel?: string;
}) {
  const selected = assets.find((asset) => asset.key === value) ?? assets[0];
  if (!selected) return null;

  const identity = (asset: PaymentAssetChoice) => asset.issuer
    ? `Issuer ${compactAssetIssuer(asset.issuer)}`
    : 'Native XLM';

  const content = (asset: PaymentAssetChoice, chevron = false) => {
    const balance = assetBalanceParts(asset.balance);
    return (
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1 text-left">
          <div className="text-sm font-bold">{asset.code}</div>
          <div className="truncate font-mono text-[11px] font-normal text-neutral-500 dark:text-neutral-400" title={asset.issuer}>{identity(asset)}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[11px] text-neutral-400">Balance</div>
          <div className="max-w-36 truncate font-mono text-xs font-semibold tabular-nums">
            {balance.integer}<span className="font-normal text-neutral-400">{balance.fraction}</span>
          </div>
        </div>
        {chevron && <ChevronDown className="h-4 w-4 shrink-0 text-neutral-400 transition group-open:rotate-180" />}
      </div>
    );
  };

  if (disabled) {
    return <div aria-label={ariaLabel} aria-disabled="true" className="rounded-xl border border-black/10 bg-black/[0.018] px-4 py-2.5 opacity-50 dark:border-white/10 dark:bg-white/[0.025]">{content(selected)}</div>;
  }

  return (
    <details data-payment-asset-picker className="group relative">
      <summary aria-label={ariaLabel} aria-haspopup="listbox" className="cursor-pointer list-none rounded-xl border border-black/10 bg-black/[0.018] px-4 py-2.5 outline-none hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-black/15 dark:border-white/10 dark:bg-white/[0.025] dark:hover:bg-white/[0.05] dark:focus-visible:ring-white/20 [&::-webkit-details-marker]:hidden">{content(selected, true)}</summary>
      <div role="listbox" aria-label={`${ariaLabel} options`} className="absolute left-0 right-0 top-full z-30 mt-2 max-h-72 overflow-y-auto rounded-xl border border-black/10 bg-white p-1.5 shadow-xl dark:border-white/15 dark:bg-neutral-900">
        {assets.map((asset) => (
          <button key={asset.key} type="button" role="option" aria-selected={asset.key === selected.key} onClick={(event) => { onChange(asset.key); event.currentTarget.closest('details')?.removeAttribute('open'); }} className="w-full rounded-lg px-3 py-2.5 text-left hover:bg-black/5 focus-visible:bg-black/5 focus-visible:outline-none dark:hover:bg-white/10 dark:focus-visible:bg-white/10">
            {content(asset)}
          </button>
        ))}
      </div>
    </details>
  );
}
