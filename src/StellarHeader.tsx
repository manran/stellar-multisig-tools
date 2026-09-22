import StellarAccountControl from './StellarAccountControl';
import MultiSigBrandMark from './MultiSigBrandMark';
import { NetworkBadge } from './MultiSigUi';
import { fixedClientStellarDeploymentNetwork } from '../packages/stellar-core/src/deploymentNetwork';
import { stellarHref } from './workspaceNavigation';

interface Props {
  landing?: boolean;
  demo?: boolean;
}

export default function StellarHeader({ landing = false, demo = false }: Props) {
  const fixedDeploymentNetwork = fixedClientStellarDeploymentNetwork();
  const brandLabel = landing ? 'MultiSig Tools — Shared authorization for Stellar' : 'MultiSig Tools';

  return (
    <header className="mst-header">
      <div className="mst-header__inner">
        <a href={stellarHref('')} className="mst-brand" aria-label={brandLabel}>
          <MultiSigBrandMark className="h-9 w-10 shrink-0" />
          <span className="mst-brand__name"><span className="mst-brand__accent">MultiSig</span> Tools</span>
        </a>

        {demo ? (
          <div className="mst-header__actions">
            <span className="hidden rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-800 dark:text-amber-200 sm:inline">Interactive demo</span>
            <a href={stellarHref('')} className="mst-action-secondary">Home</a>
          </div>
        ) : (
          <div className="mst-header__actions">
            {fixedDeploymentNetwork && <NetworkBadge network={fixedDeploymentNetwork} />}
            <StellarAccountControl />
          </div>
        )}
      </div>
    </header>
  );
}
