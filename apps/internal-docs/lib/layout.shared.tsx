import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'MultiSig Tools · Internal · Stellar',
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
