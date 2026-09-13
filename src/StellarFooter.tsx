import { Mail } from 'lucide-react';
import MultiSigBrandMark from './MultiSigBrandMark';
import { stellarHref } from './workspaceNavigation';

interface Props {
  workspace?: boolean;
}

const FOOTER_GROUPS = [
  {
    label: 'Product',
    links: [
      ['Inbox', '/inbox'],
      ['Create a treasury', '/treasury'],
      ['New transaction', '/new'],
      ['Live demo', '/demo'],
    ],
  },
  {
    label: 'Resources',
    links: [
      ['Docs', '/docs'],
      ['Developers', '/developers'],
    ],
  },
  {
    label: 'Trust',
    links: [
      ['Privacy', '/privacy'],
      ['Terms', '/terms'],
    ],
  },
] as const;

const linkClass = 'transition hover:text-emerald-700 dark:hover:text-emerald-300';

function SupportLink({ compact = false }: { compact?: boolean }) {
  return (
    <a
      href="mailto:support@multisig.tools"
      aria-label={compact ? 'Email support' : undefined}
      title={compact ? 'Email support' : undefined}
      className={`${linkClass} ${compact ? 'inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10' : 'font-semibold text-neutral-700 dark:text-neutral-200'}`}
    >
      {compact ? <Mail className="h-4 w-4" aria-hidden="true" /> : 'Email support'}
    </a>
  );
}

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
              <a href={stellarHref('/docs')} className={linkClass}>Docs</a>
              <a href={stellarHref('/privacy')} className={linkClass}>Privacy</a>
              <a href={stellarHref('/terms')} className={linkClass}>Terms</a>
              <SupportLink compact />
            </div>
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer className="border-t border-black/10 bg-[#efefe9] text-neutral-600 dark:border-white/10 dark:bg-[#0d0d0d] dark:text-neutral-300">
      <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 sm:py-14 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.45fr_repeat(3,minmax(0,0.72fr))] lg:gap-8">
          <div className="max-w-sm">
            <a href={stellarHref('')} className="inline-flex items-center gap-3">
              <MultiSigBrandMark className="h-9 w-10" />
              <span className="text-lg font-extrabold tracking-[-0.025em] text-neutral-900 dark:text-white"><span className="text-emerald-700 dark:text-emerald-300">MultiSig</span> Tools</span>
            </a>
            <p className="mt-5 text-xl font-bold tracking-tight text-neutral-900 dark:text-white">Shared control. Not custody.</p>
            <p className="mt-3 text-sm leading-6 text-neutral-500 dark:text-neutral-400">Stellar multisig coordination without taking custody. Keys stay in signer wallets; authorization stays on Stellar.</p>
            <div className="mt-5 text-sm"><div className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">Support</div><div className="mt-1.5"><SupportLink /></div></div>
          </div>

          {FOOTER_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="text-xs font-bold uppercase tracking-[0.16em] text-neutral-400">{group.label}</div>
              <div className="mt-4 flex flex-col items-start gap-3 text-sm font-semibold">
                {group.links.map(([label, path]) => <a key={path} href={stellarHref(path)} className={linkClass}>{label}</a>)}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-black/10 pt-5 text-xs text-neutral-500 dark:border-white/10 dark:text-neutral-400 sm:flex-row sm:items-center sm:justify-between">
          <div>MultiSig Tools · Stellar shared authorization · Beta</div>
          <a href={stellarHref('/account/signing') + '?mode=offline'} className="transition hover:text-neutral-800 dark:hover:text-neutral-100">Set up multisig offline</a>
        </div>
      </div>
    </footer>
  );
}
