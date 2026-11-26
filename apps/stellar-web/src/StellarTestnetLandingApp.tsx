import { ArrowRight, FlaskConical } from 'lucide-react';
import StellarHeader from './StellarHeader';
import { STELLAR_PUBLIC_DOCS_BASE } from '../../../packages/stellar-core/src/apiOrigins';
import { stellarHref } from './workspaceNavigation';

const BOUNDARY_FACTS = [
  ['Prepare a transaction', 'Create a payment or a contract call for your shared account.'],
  ['Collect approvals', 'Invite the required signers. Each signer reviews and approves with their own wallet.'],
  ['Verify the result', 'Submit when ready and check the result on Stellar.'],
] as const;

export default function StellarTestnetLandingApp() {
  return (
    <div data-stellar-network="testnet" className="mst-page mst-testnet-page flex min-h-screen flex-col">
      <StellarHeader landing />

      <main className="mst-testnet-layout">
        <div>
          <div className="mst-environment-chip"><FlaskConical className="h-4 w-4" />Stellar Testnet</div>
          <h1 className="mst-display mst-display--compact mt-6">Manage shared Stellar accounts.</h1>
          <p className="mst-lede mt-6">Prepare transactions, collect approvals and verify results without giving up custody of your keys. Try the full workflow with Testnet assets.</p>
          <div className="mst-actions">
            <a href={stellarHref('/inbox')} className="mst-action-primary">Open Testnet workspace<ArrowRight className="h-4 w-4" /></a>
            <a href={stellarHref('/new')} className="mst-action-secondary">New test proposal</a>
          </div>
        </div>

        <section aria-label="How shared signing works" className="mst-boundary-list">
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
          <a href={stellarHref('/privacy')}>Privacy</a>
          <a href={stellarHref('/terms')}>Terms</a>
          <span className="sm:ml-auto">Testnet assets have no Mainnet value.</span>
        </div>
      </footer>
    </div>
  );
}
