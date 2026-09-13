import { useEffect, useState } from 'react';
import StellarAccountControl from './StellarAccountControl';
import MultiSigBrandMark from './MultiSigBrandMark';
import { NetworkBadge } from './MultiSigUi';
import { fixedClientStellarDeploymentNetwork } from './stellar/deploymentNetwork';
import { stellarHref } from './workspaceNavigation';

interface Props {
  landing?: boolean;
  demo?: boolean;
}

export default function StellarHeader({ landing = false, demo = false }: Props) {
  const fixedDeploymentNetwork = fixedClientStellarDeploymentNetwork();
  const [scrolled, setScrolled] = useState(() => landing && typeof window !== 'undefined' ? window.scrollY > 24 : false);

  useEffect(() => {
    if (!landing) {
      setScrolled(false);
      return;
    }
    const update = () => setScrolled(window.scrollY > 24);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [landing]);

  const expanded = landing && !scrolled;

  return (
    <header className="sticky top-0 z-50 border-b border-black/10 bg-[#f6f6f2]/95 backdrop-blur dark:border-white/10 dark:bg-[#090909]/95">
      <div className={`mx-auto flex w-full max-w-[1480px] items-center justify-between gap-4 px-4 transition-[height] duration-200 sm:px-6 lg:px-8 ${expanded ? 'h-20 sm:h-[5.5rem]' : 'h-16'}`}>
        <a href={stellarHref('')} className="group flex min-w-0 items-center gap-2.5">
          <MultiSigBrandMark className={`${expanded ? 'h-11 w-12' : 'h-9 w-10'} transition-all duration-200`} />
          <span className="min-w-0 leading-tight">
            <span className={`block truncate font-extrabold tracking-[-0.025em] transition-all duration-200 ${expanded ? 'text-lg sm:text-xl' : 'text-[15px]'}`}><span className="text-emerald-700 dark:text-emerald-300">MultiSig</span> Tools</span>
            <span className={`mt-0.5 hidden truncate font-medium tracking-[0.01em] text-neutral-500 transition-all duration-200 dark:text-neutral-400 sm:block ${expanded ? 'text-xs' : 'text-[11px]'}`}>Shared authorization for Stellar</span>
          </span>
        </a>
        {demo ? (
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-800 dark:text-amber-200 sm:inline">Interactive demo</span>
            <a href={stellarHref('')} className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10">Home</a>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {fixedDeploymentNetwork && <NetworkBadge network={fixedDeploymentNetwork} />}
            <StellarAccountControl />
          </div>
        )}
      </div>
    </header>
  );
}
