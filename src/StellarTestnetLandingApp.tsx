import { ArrowRight, FlaskConical } from 'lucide-react';
import StellarHeader from './StellarHeader';
import { STELLAR_PUBLIC_DOCS_BASE } from './stellar/apiOrigins';
import { STELLAR_MAINNET_ORIGIN } from './stellar/deploymentOrigins';
import { stellarHref } from './workspaceNavigation';

const BOUNDARY_FACTS = [
  ['Network stays fixed', 'There is no in-app Mainnet/Testnet switch. The deployment owns the network boundary so runtime state cannot silently cross networks.'],
  ['State stays isolated', 'Proposals, Intents, Treasuries, Activity, credentials, and wallet network context belong to this Testnet runtime.'],
  ['Product content stays canonical', 'Documentation, Developers, Privacy, Terms, and the interactive demo live once on the canonical product site.'],
] as const;

export default function StellarTestnetLandingApp() {
  return (
    <div data-stellar-network="testnet" className="mst-page mst-testnet-page flex min-h-screen flex-col">
      <StellarHeader landing />

      <main className="mst-testnet-layout">
        <div>
          <div className="mst-environment-chip"><FlaskConical className="h-4 w-4" />Stellar Testnet</div>
          <h1 className="mst-display mst-display--compact mt-6">Use the real workflow without Mainnet assets.</h1>
          <p className="mst-lede mt-6">This deployment is fixed to Stellar Testnet. Test the same Proposal, Intent, Treasury, wallet, and execution boundaries without sharing state with Mainnet.</p>
          <div className="mst-actions">
            <a href={stellarHref('/inbox')} className="mst-action-primary">Open Testnet workspace<ArrowRight className="h-4 w-4" /></a>
            <a href={stellarHref('/new')} className="mst-action-secondary">New test proposal</a>
          </div>
        </div>

        <section aria-label="Testnet runtime boundaries" className="mst-boundary-list">
          {BOUNDARY_FACTS.map(([title, description]) => (
            <div key={title} className="mst-boundary-item">
              <h2>{title}</h2>
              <p>{description}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="mst-testnet-footer">
        <div className="mst-testnet-footer__inner">
          <a href={STELLAR_PUBLIC_DOCS_BASE}>Documentation</a>
          <a href={`${STELLAR_PUBLIC_DOCS_BASE}/developers`}>Developers</a>
          <a href={STELLAR_MAINNET_ORIGIN}>Mainnet</a>
          <span className="sm:ml-auto">Testnet assets have no Mainnet value.</span>
        </div>
      </footer>
    </div>
  );
}
