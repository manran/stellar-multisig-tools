import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'MultiSig Tools · Internal · Stellar',
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
