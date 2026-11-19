import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2">
          <img src="/brand/mst-a3-primary.svg" alt="" aria-hidden="true" className="h-6 w-10 shrink-0 object-contain" />
          <span>MultiSig Tools · Internal · Stellar</span>
        </span>
      ),
    },
    searchToggle: {
      enabled: false,
    },
    links: [
      {
        text: 'Public Docs',
        url: 'https://docs.multisig.tools/stellar',
        external: true,
      },
    ],
  };
}
