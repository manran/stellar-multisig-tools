import { useEffect, useState } from 'react';
import { Check, ClipboardCopy, FlaskConical, KeyRound } from 'lucide-react';
import IntegrationProfileWizard, { type IntegrationProfileWizardResult } from './IntegrationProfileWizard';
import { STELLAR_PUBLIC_DOCS_BASE } from '../packages/stellar-core/src/apiOrigins';
import { STELLAR_TESTNET_ORIGIN } from '../packages/stellar-core/src/deploymentOrigins';
import type { StellarNetwork } from '../packages/stellar-core/src/types';
import './integration-admin.css';

interface RuntimeConfig {
  fixedNetwork: StellarNetwork | null;
}

async function runtimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch('/api/runtime-config', { cache: 'no-store' });
  const body = await response.json() as RuntimeConfig | { error?: string };
  if (!response.ok) throw new Error('error' in body && body.error ? body.error : 'HTTP ' + response.status);
  return body as RuntimeConfig;
}

export default function TestnetIntegrationApp() {
  const [network, setNetwork] = useState<StellarNetwork | null | 'loading'>('loading');
  const [created, setCreated] = useState<IntegrationProfileWizardResult | null>(null);
  const [copied, setCopied] = useState<'api' | 'webhook' | null>(null);

  useEffect(() => {
    let active = true;
    void runtimeConfig()
      .then((body) => { if (active) setNetwork(body.fixedNetwork); })
      .catch(() => { if (active) setNetwork(null); });
    return () => { active = false; };
  }, []);

  async function copy(value: string, kind: 'api' | 'webhook') {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied((current) => current === kind ? null : current), 1400);
  }

  if (network === 'loading') {
    return <main className="integration-admin-shell px-4 py-8 sm:px-6 lg:px-8"><div className="mx-auto max-w-5xl ia-muted">Loading Testnet Integration setup…</div></main>;
  }

  if (network !== 'testnet') {
    return <main className="integration-admin-shell px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="pb-6">
          <p className="ia-kicker">Developers</p>
          <h1 className="ia-workspace__title">Create Testnet Integration</h1>
          <p className="ia-muted mt-2 max-w-3xl text-sm leading-6">Self-service Integration creation is deliberately available only on the fixed Testnet deployment.</p>
        </header>
        <a className="ia-action ia-action--primary" href={STELLAR_TESTNET_ORIGIN + '/developers/integrations/new'}>
          <FlaskConical className="h-4 w-4" />Open Testnet setup
        </a>
      </div>
    </main>;
  }

  if (created) {
    return <main className="integration-admin-shell px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="pb-6">
          <p className="ia-kicker">Testnet Integration</p>
          <h1 className="ia-workspace__title">Integration ready</h1>
          <p className="ia-muted mt-2 max-w-3xl text-sm leading-6">The Testnet profile is active immediately. Store these secrets now; they are not shown again.</p>
        </header>

        <section className="ia-secret">
          <div className="flex items-center gap-2 font-bold"><KeyRound className="h-5 w-5" />API credential — shown once</div>
          <p className="ia-code mt-3">{created.apiKey}</p>
          <button type="button" onClick={() => void copy(created.apiKey, 'api')} className="ia-action mt-3">
            {copied === 'api' ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}
            {copied === 'api' ? 'Copied' : 'Copy credential'}
          </button>
        </section>

        {created.webhookSecret && <section className="ia-secret mt-4">
          <div className="font-bold">Webhook signing secret — shown once</div>
          <p className="ia-code mt-3">{created.webhookSecret}</p>
          <button type="button" onClick={() => void copy(created.webhookSecret!, 'webhook')} className="ia-action mt-3">
            {copied === 'webhook' ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}
            {copied === 'webhook' ? 'Copied' : 'Copy webhook secret'}
          </button>
        </section>}

        <section className="ia-ops mt-6">
          <h2 className="m-0 text-lg font-bold">Use it</h2>
          <p className="ia-muted mt-2 text-sm leading-6">Set <code>MULTISIG_INTEGRATION_KEY</code> to the <code>msi_*</code> value. This profile is Testnet-only; creating it grants no Stellar signer authority and no Mainnet access.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => setCreated(null)} className="ia-action">Create another</button>
          </div>
        </section>
      </div>
    </main>;
  }

  return <main className="integration-admin-shell px-4 py-8 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-6xl">
      <header className="pb-6">
        <p className="ia-kicker">Developers · Testnet</p>
        <h1 className="ia-workspace__title">Create Testnet Integration</h1>
        <p className="ia-muted mt-2 max-w-3xl text-sm leading-6">No application or approval is required. Define the Testnet accounts/contracts your service will exercise, choose who submits, and receive an <code>msi_*</code> credential immediately.</p>
      </header>
      <IntegrationProfileWizard
        createEndpoint="/api/integration-testnet"
        onCreated={setCreated}
        onCancel={() => { window.location.href = `${STELLAR_PUBLIC_DOCS_BASE}/developers`; }}
      />
    </div>
  </main>;
}
