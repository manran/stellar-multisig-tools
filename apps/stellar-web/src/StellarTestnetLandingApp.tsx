import { ArrowRight, FlaskConical } from 'lucide-react';
import StellarHeader from './StellarHeader';
import { useUserIdentity } from './UserIdentityContext';
import { STELLAR_PUBLIC_DOCS_BASE } from '../../../packages/stellar-core/src/apiOrigins';
import { STELLAR_MAINNET_ORIGIN } from '../../../packages/stellar-core/src/deploymentOrigins';
import { stellarHref } from './workspaceNavigation';

const TESTNET_STEPS = [
  ['1. Prepare', 'Create a payment proposal.'],
  ['2. Sign', 'Collect the required signatures.'],
  ['3. Submit', 'Confirm the result on Stellar Testnet.'],
] as const;

export default function StellarTestnetLandingApp() {
  const { identity } = useUserIdentity();
  return (
    <div data-stellar-network="testnet" className="mst-page mst-testnet-page flex min-h-screen flex-col">
      <StellarHeader landing />

      <main className="mst-testnet-layout">
        <div>
          <div className="mst-environment-chip"><FlaskConical className="h-4 w-4" />Stellar Testnet</div>
          <h1 className="mst-display mst-display--compact mt-6">Try multisig on Testnet.</h1>
          <p className="mst-lede mt-6">Create a proposal, collect signatures, and submit with test assets.</p>
          <div className="mst-actions">
            <a href={stellarHref(identity ? '/inbox' : '/identity')} className="mst-action-primary">{identity ? 'Open Inbox' : 'Get started'}<ArrowRight className="h-4 w-4" /></a>
            <a href={stellarHref('/new')} className="mst-action-secondary">New proposal</a>
          </div>
        </div>

        <section aria-label="Test the workflow" className="mst-boundary-list">
          {TESTNET_STEPS.map(([title, description]) => (
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
