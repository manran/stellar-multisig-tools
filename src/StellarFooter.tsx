import { Mail } from 'lucide-react';
import MultiSigBrandMark from './MultiSigBrandMark';
import { STELLAR_PUBLIC_DOCS_BASE } from './stellar/apiOrigins';
import { canonicalStellarContentHref, stellarHref } from './workspaceNavigation';
import { isCanonicalStellarContentPath } from './workspaceRoutes';

interface Props {
  workspace?: boolean;
}

const linkClass = 'transition hover:text-emerald-700 dark:hover:text-emerald-300';

function footerHref(path: string) {
  return isCanonicalStellarContentPath(path) ? canonicalStellarContentHref(path) : stellarHref(path);
}

function SupportLink({ compact = false }: { compact?: boolean }) {
  return (
    <a
      href="mailto:support@multisig.tools"
      aria-label={compact ? 'Email support' : undefined}
      title={compact ? 'Email support' : undefined}
      className={compact ? linkClass + ' inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10' : undefined}
    >
      {compact ? <Mail className="h-4 w-4" aria-hidden="true" /> : 'Email support'}
    </a>
  );
}

const MARKETING_LINKS = [
  ['Inbox', '/inbox'],
  ['Create a treasury', '/treasury'],
  ['New transaction', '/new'],
  ['Live demo', '/demo'],
  ['Privacy', '/privacy'],
  ['Terms', '/terms'],
] as const;

export default function StellarFooter({ workspace = false }: Props) {
  if (workspace) {
    return (
      <footer className="border-t border-black/10 bg-white/35 text-neutral-500 dark:border-white/10 dark:bg-white/[0.02] dark:text-neutral-400">
        <div className="mx-auto w-full max-w-[1480px] px-4 py-5 sm:px-6 lg:pl-[226px]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <MultiSigBrandMark className="h-7 w-8" />
              <div className="text-sm"><span className="font-bold text-neutral-800 dark:text-neutral-100">MultiSig Tools</span><span className="ml-2 text-xs">Beta · non-custodial</span></div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold">
              <a href={STELLAR_PUBLIC_DOCS_BASE} className={linkClass}>Docs</a>
              <a href={canonicalStellarContentHref('/privacy')} className={linkClass}>Privacy</a>
              <a href={canonicalStellarContentHref('/terms')} className={linkClass}>Terms</a>
              <SupportLink compact />
            </div>
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer className="mst-footer">
      <div className="mst-footer__inner">
        <div className="mst-footer__top">
          <div className="mst-footer__statement">
            <a href={stellarHref('')} className="mst-brand">
              <MultiSigBrandMark className="h-9 w-10 shrink-0" />
              <span className="mst-brand__name"><span className="mst-brand__accent">MultiSig</span> Tools</span>
            </a>
            <strong className="mt-5">Shared control. Not custody.</strong>
            <p>Coordinate Stellar signatures without taking custody. Keys stay in signer wallets; account authority stays on Stellar.</p>
          </div>

          <nav aria-label="MultiSig Tools directory" className="mst-footer__links">
            {MARKETING_LINKS.map(([label, path]) => <a key={path} href={footerHref(path)}>{label}</a>)}
            <a href={STELLAR_PUBLIC_DOCS_BASE}>Docs</a>
            <a href={`${STELLAR_PUBLIC_DOCS_BASE}/developers`}>Developers</a>
            <SupportLink />
          </nav>
        </div>

        <div className="mst-footer__bottom">
          <span>MultiSig Tools · Stellar shared authorization · Beta</span>
          <a href={stellarHref('/account/signing') + '?mode=offline'}>Set up multisig offline</a>
        </div>
      </div>
    </footer>
  );
}
