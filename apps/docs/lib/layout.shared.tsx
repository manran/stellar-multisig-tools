import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'MultiSig Tools · Stellar',
    },
    links: [
      {
        text: 'Testnet',
        url: 'https://stellar-testnet.multisig.tools',
        external: true,
      },
    ],
  };
}
