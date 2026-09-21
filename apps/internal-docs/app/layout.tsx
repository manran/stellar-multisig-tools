import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './global.css';

export const metadata: Metadata = {
  title: {
    default: 'MultiSig Tools Internal Documentation',
    template: '%s | MultiSig Tools Internal',
  },
  description: 'Private engineering and operations documentation for MultiSig Tools.',
  robots: {
    index: false,
    follow: false,
    noarchive: true,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
