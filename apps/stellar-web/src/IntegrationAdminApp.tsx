import { useMemo, useState } from 'react';
import { Check, ClipboardCopy, KeyRound, LoaderCircle, Plus, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import IntegrationProfileWizard, { type IntegrationProfileWizardResult } from './IntegrationProfileWizard';
import './integration-admin.css';

interface ContractScope {
  contractId: string;
  methods: string[];
  execution?: { mode: 'multisigtools' } | { mode: 'external'; executor: string };
}
interface WebhookSummary { version: 1; url: string; enabled: boolean; secretVersion: number; }
interface ServiceSummary {
  serviceId: string; label: string; enabled: boolean; source: 'bootstrap' | 'durable';
  networks: Array<'public' | 'testnet'>;
  classicSourceAccounts: string[];
  classicExternalExecutionSourceAccounts: string[];
  sorobanContracts: ContractScope[];
  sorobanExecutionAccounts: string[];
  sorobanDefaultExecutor?: string;
  webhook?: WebhookSummary;
  profile: { version: 1; authorizationExperience: 'hosted' | 'native' | 'headless' };
  createdAt?: string; updatedAt?: string;
}
interface Draft {
  serviceId: string; label: string; enabled: boolean;
  networks: Array<'public' | 'testnet'>;
  classicSourceAccounts: string;
  classicExternalExecutionSourceAccounts: string;
  sorobanContracts: string;
  sorobanExecutionAccounts: string;
  sorobanDefaultExecutor: string;
  authorizationExperience: 'hosted' | 'native' | 'headless';
}
interface ApiError { error?: string; code?: string; }

interface ManagedClassicChannelRow {
  accountId: string;
  leaseState: 'active' | 'expired' | 'free' | 'unknown';
  leaseExpiresAt?: string;
  balanceState: 'ready' | 'missing' | 'unavailable';
  nativeBalance?: string;
}

interface ManagedClassicCreatorStatus {
  accountId: string;
  balanceState: 'ready' | 'missing' | 'unavailable';
  nativeBalance?: string;
  state?: 'ready' | 'low' | 'insufficient';
  lowThreshold: string;
  recoveryThreshold: string;
  requiredForNextChannel?: string;
}

interface ManagedClassicOperationalStatus {
  network: 'public' | 'testnet';
  capacity: number;
  softLimit: number;
  creator?: ManagedClassicCreatorStatus;
  leaseVisibility: 'available' | 'unavailable';
  activeLeaseCount: number | null;
  expiredLeaseCount: number | null;
  freeCapacity: number | null;
  channels: ManagedClassicChannelRow[];
}

interface ManagedClassicExecutionStatus {
  network: 'public' | 'testnet';
  configured: boolean;
  channelAccounts: string[];
  operationalStatus?: ManagedClassicOperationalStatus;
}

const emptyDraft: Draft = {
  serviceId: '', label: '', enabled: true, networks: ['testnet'],
  classicSourceAccounts: '', classicExternalExecutionSourceAccounts: '', sorobanContracts: '',
  sorobanExecutionAccounts: '', sorobanDefaultExecutor: '', authorizationExperience: 'hosted',
};

function lines(value: string): string[] {
  return [...new Set(value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean))];
}

function contracts(value: string): ContractScope[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [scopePart, executionPart] = line.split(/\s*->\s*/, 2);
    const separator = scopePart.indexOf(':');
    const contractId = separator < 0 ? scopePart : scopePart.slice(0, separator).trim();
    const methods = separator < 0 ? [] : lines(scopePart.slice(separator + 1));
    const executionValue = executionPart?.trim();
    const execution = !executionValue
      ? undefined
      : /^(mst|multisigtools)$/i.test(executionValue)
        ? { mode: 'multisigtools' as const }
        : { mode: 'external' as const, executor: executionValue };
    return { contractId, methods, ...(execution ? { execution } : {}) };
  });
}

function draftFrom(service: ServiceSummary): Draft {
  return {
    serviceId: service.serviceId, label: service.label, enabled: service.enabled, networks: service.networks,
    classicSourceAccounts: service.classicSourceAccounts.join('\n'),
    classicExternalExecutionSourceAccounts: service.classicExternalExecutionSourceAccounts.join('\n'),
    sorobanContracts: service.sorobanContracts.map((item) => {
      const execution = item.execution?.mode === 'multisigtools'
        ? ' -> MST'
        : item.execution?.mode === 'external'
          ? ` -> ${item.execution.executor}`
          : '';
      return `${item.contractId}:${item.methods.join(',')}${execution}`;
    }).join('\n'),
    sorobanExecutionAccounts: service.sorobanExecutionAccounts.join('\n'),
    sorobanDefaultExecutor: service.sorobanDefaultExecutor ?? '',
    authorizationExperience: service.profile.authorizationExperience,
  };
}

function requestBody(draft: Draft) {
  return {
    serviceId: draft.serviceId.trim().toLowerCase(), label: draft.label.trim(), enabled: draft.enabled,
    networks: draft.networks,
    classicSourceAccounts: lines(draft.classicSourceAccounts),
    classicExternalExecutionSourceAccounts: lines(draft.classicExternalExecutionSourceAccounts),
    sorobanContracts: contracts(draft.sorobanContracts),
    sorobanExecutionAccounts: lines(draft.sorobanExecutionAccounts),
    ...(draft.sorobanDefaultExecutor.trim() ? { sorobanDefaultExecutor: draft.sorobanDefaultExecutor.trim() } : {}),
    profile: { authorizationExperience: draft.authorizationExperience },
  };
}

async function apiJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T | ApiError;
  if (!response.ok) throw new Error((body as ApiError).error || `HTTP ${response.status}`);
  return body as T;
}

export default function IntegrationAdminApp() {
  const [adminSecret, setAdminSecret] = useState('');
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState('');
  const [generatedKey, setGeneratedKey] = useState('');
  const [generatedWebhookSecret, setGeneratedWebhookSecret] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEnabled, setWebhookEnabled] = useState(true);
  const [copied, setCopied] = useState(false);
  const [webhookCopied, setWebhookCopied] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [managedClassic, setManagedClassic] = useState<ManagedClassicExecutionStatus | null>(null);
  const [managedClassicBusy, setManagedClassicBusy] = useState(false);
  const [managedClassicError, setManagedClassicError] = useState('');
  const editing = useMemo(() => services.find((item) => item.serviceId === editingId), [services, editingId]);

  const headers = () => ({ Authorization: `Bearer ${adminSecret.trim()}`, 'Content-Type': 'application/json' });

  async function loadManagedClassicStatus(): Promise<void> {
    setManagedClassicBusy(true); setManagedClassicError('');
    try {
      const runtime = await apiJson<{
        stellarNetwork: 'public' | 'testnet';
        fixedNetwork?: 'public' | 'testnet';
      }>(await fetch('/api/runtime-config', { cache: 'no-store' }));
      const network = runtime.fixedNetwork ?? runtime.stellarNetwork;
      const body = await apiJson<{ managedClassicExecution: ManagedClassicExecutionStatus }>(
        await fetch(
          `/api/integration-admin?view=managed_classic_execution&network=${network}&details=channels`,
          { headers: { Authorization: `Bearer ${adminSecret.trim()}` }, cache: 'no-store' },
        ),
      );
      setManagedClassic(body.managedClassicExecution);
    } catch (cause) {
      setManagedClassic(null);
      setManagedClassicError(cause instanceof Error ? cause.message : 'Unable to load managed Classic channel status.');
    } finally {
      setManagedClassicBusy(false);
    }
  }

  async function load(preserveGeneratedSecrets = false): Promise<ServiceSummary[]> {
    setBusy(true); setError('');
    if (!preserveGeneratedSecrets) { setGeneratedKey(''); setGeneratedWebhookSecret(''); }
    try {
      const body = await apiJson<{ services: ServiceSummary[] }>(await fetch('/api/integration-admin', { headers: { Authorization: `Bearer ${adminSecret.trim()}` }, cache: 'no-store' }));
      setServices(body.services); setLoaded(true);
      await loadManagedClassicStatus();
      return body.services;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load Integration Services.');
      return [];
    } finally { setBusy(false); }
  }

  function select(service: ServiceSummary) {
    setCreatingNew(false); setAdvancedOpen(false);
    setEditingId(service.serviceId); setDraft(draftFrom(service)); setGeneratedKey(''); setGeneratedWebhookSecret('');
    setWebhookUrl(service.webhook?.url ?? ''); setWebhookEnabled(service.webhook?.enabled ?? true); setError('');
  }

  function createNew() {
    setCreatingNew(true); setAdvancedOpen(false); setEditingId(''); setDraft(emptyDraft); setGeneratedKey(''); setGeneratedWebhookSecret('');
    setWebhookUrl(''); setWebhookEnabled(true); setError('');
  }

  async function createdFromWizard(result: IntegrationProfileWizardResult) {
    setGeneratedKey(result.apiKey);
    setGeneratedWebhookSecret(result.webhookSecret ?? '');
    setCreatingNew(false);
    setEditingId(result.serviceId);
    const nextServices = await load(true);
    const created = nextServices.find((service) => service.serviceId === result.serviceId);
    if (created) {
      setDraft(draftFrom(created));
      setWebhookUrl(created.webhook?.url ?? '');
      setWebhookEnabled(created.webhook?.enabled ?? true);
    }
  }

  async function save() {
    setBusy(true); setError(''); setGeneratedKey(''); setGeneratedWebhookSecret('');
    try {
      const method = editingId ? 'PATCH' : 'POST';
      const body = await apiJson<{ service: ServiceSummary; apiKey?: string }>(await fetch('/api/integration-admin', {
        method, headers: headers(), body: JSON.stringify(requestBody(draft)),
      }));
      if (body.apiKey) setGeneratedKey(body.apiKey);
      await load(true);
      setEditingId(body.service.serviceId); setDraft(draftFrom(body.service));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save Integration Service.'); }
    finally { setBusy(false); }
  }

  async function rotate() {
    if (!editingId) return;
    setBusy(true); setError(''); setGeneratedKey(''); setGeneratedWebhookSecret('');
    try {
      const body = await apiJson<{ service: ServiceSummary; apiKey: string }>(await fetch('/api/integration-admin', {
        method: 'PATCH', headers: headers(), body: JSON.stringify({ action: 'rotate', serviceId: editingId }),
      }));
      setGeneratedKey(body.apiKey); setEditingId(body.service.serviceId); setDraft(draftFrom(body.service)); await load(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to rotate Integration credential.'); }
    finally { setBusy(false); }
  }

  async function configureWebhook(webhook: { url: string; enabled: boolean } | null) {
    if (!editingId) return;
    setBusy(true); setError(''); setGeneratedWebhookSecret('');
    try {
      const body = await apiJson<{ service: ServiceSummary; webhookSecret?: string }>(await fetch('/api/integration-admin', {
        method: 'PATCH', headers: headers(), body: JSON.stringify({ action: 'configure_webhook', serviceId: editingId, webhook }),
      }));
      setGeneratedWebhookSecret(body.webhookSecret ?? '');
      setWebhookUrl(body.service.webhook?.url ?? ''); setWebhookEnabled(body.service.webhook?.enabled ?? true);
      await load(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to configure webhook delivery.'); }
    finally { setBusy(false); }
  }

  async function rotateWebhookSecret() {
    if (!editingId) return;
    setBusy(true); setError(''); setGeneratedWebhookSecret('');
    try {
      const body = await apiJson<{ service: ServiceSummary; webhookSecret: string }>(await fetch('/api/integration-admin', {
        method: 'PATCH', headers: headers(), body: JSON.stringify({ action: 'rotate_webhook_secret', serviceId: editingId }),
      }));
      setGeneratedWebhookSecret(body.webhookSecret);
      await load(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to rotate webhook secret.'); }
    finally { setBusy(false); }
  }

  async function copyKey() {
    if (!generatedKey) return;
    await navigator.clipboard.writeText(generatedKey); setCopied(true); window.setTimeout(() => setCopied(false), 1500);
  }

  async function copyWebhookSecret() {
    if (!generatedWebhookSecret) return;
    await navigator.clipboard.writeText(generatedWebhookSecret); setWebhookCopied(true); window.setTimeout(() => setWebhookCopied(false), 1500);
  }

  return <main className="integration-admin-shell px-4 py-8 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-7xl">
      <header className="pb-5">
        <p className="ia-kicker">Operator</p>
        <h1 className="ia-workspace__title">Integration administration</h1>
        <p className="ia-muted mt-2 max-w-3xl text-sm leading-6">Provision non-signer Service identities, scope what they may coordinate, and rotate credentials. This surface is deployment-operator only.</p>
      </header>

      <section className="ia-access">
        <div className="ia-access__copy">
          <div className="flex items-center gap-2 font-bold"><ShieldCheck className="h-5 w-5" />Operator access</div>
          <p className="ia-muted mt-2 text-sm">Enter the deployment <code>mia_...</code> secret. It stays only in this page's memory.</p>
        </div>
        <div className="ia-inline-form">
          <input type="password" autoComplete="off" value={adminSecret} onChange={(event) => setAdminSecret(event.target.value)} placeholder="mia_..." className="ia-input font-mono text-sm" />
          <button type="button" disabled={busy || !adminSecret.trim()} onClick={() => void load(false)} className="ia-action ia-action--primary">{busy ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <KeyRound className="h-4 w-4" />}Load services</button>
        </div>
      </section>

      {error && <div className="mt-4 border-y border-red-500/30 bg-red-500/[0.06] px-1 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>}
      {generatedKey && <section className="ia-secret mt-4"><div className="font-bold">API credential — shown once</div><p className="ia-muted mt-1 text-sm">Store this value in your server-side secret store. The Integration Profile can be viewed later, but this credential cannot.</p><p className="ia-code mt-3">{generatedKey}</p><button type="button" onClick={() => void copyKey()} className="ia-action mt-3">{copied ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}{copied ? 'Copied' : 'Copy credential'}</button></section>}
      {generatedWebhookSecret && <section className="ia-secret mt-4"><div className="font-bold">Webhook signing secret</div><p className="ia-muted mt-1 text-sm">Store this value in the webhook receiver and use it to verify Standard Webhooks signatures.</p><p className="ia-code mt-3">{generatedWebhookSecret}</p><button type="button" onClick={() => void copyWebhookSecret()} className="ia-action mt-3">{webhookCopied ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}{webhookCopied ? 'Copied' : 'Copy webhook secret'}</button></section>}

      {loaded && <ManagedClassicStatusPanel
        status={managedClassic}
        busy={managedClassicBusy}
        error={managedClassicError}
        onRefresh={() => void loadManagedClassicStatus()}
      />}

      {loaded && <div className="ia-workbench mt-6">
        <aside className="ia-service-rail">
          <div className="ia-service-rail__head"><h2 className="m-0 font-bold">Integrations</h2><button type="button" onClick={createNew} className="ia-action px-3 text-xs"><Plus className="h-3.5 w-3.5" />New</button></div>
          <div className="ia-service-list">{services.map((service) => <button key={service.serviceId} type="button" data-selected={editingId === service.serviceId && !creatingNew} onClick={() => select(service)} className="ia-service-item"><div className="ia-service-item__top"><span className="min-w-0 truncate font-semibold">{service.label}</span><span className={service.enabled ? 'text-xs text-emerald-700 dark:text-emerald-300' : 'ia-muted text-xs'}>{service.enabled ? 'Enabled' : 'Disabled'}</span></div><span className="ia-service-item__id">{service.serviceId}</span><div className="ia-muted mt-1 text-xs">{service.source}</div></button>)}</div>
        </aside>
        <div className="ia-workspace">

        {creatingNew
          ? <IntegrationProfileWizard
              adminSecret={adminSecret}
              onCreated={createdFromWizard}
              onCancel={() => setCreatingNew(false)}
            />
          : editing
            ? <section className="min-w-0">
                <div className="ia-workspace__head">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="ia-workspace__title">{editing.label}</h2>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${editing.enabled ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-neutral-500/10 text-neutral-500'}`}>{editing.enabled ? 'Enabled' : 'Disabled'}</span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-neutral-500">{editing.serviceId}</p>
                    <p className="mt-2 text-sm text-neutral-500">{editing.source === 'bootstrap' ? 'Bootstrap profile · saving creates a durable override.' : 'Durable Integration Profile'}</p>
                  </div>
                  <button type="button" onClick={() => setAdvancedOpen((value) => !value)} className="ia-action">
                    {advancedOpen ? 'Close advanced' : 'Advanced configuration'}
                  </button>
                </div>

                {!advancedOpen && <IntegrationProfileDetail service={editing} onRotate={() => void rotate()} busy={busy} />}

                {advancedOpen && <div className="mt-6 border-t border-black/10 pt-6 dark:border-white/10">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-bold">Advanced configuration</h3>
                      <p className="mt-1 text-sm text-neutral-500">Raw authority fields. Prefer the guided flow for new profiles.</p>
                    </div>
                    <button type="button" disabled={busy} onClick={() => void rotate()} className="ia-action"><RefreshCw className="h-4 w-4" />Rotate MSI credential</button>
                  </div>

                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-semibold">Service id<input disabled value={draft.serviceId} className="ia-input mt-2 font-mono text-sm" /></label>
                    <label className="text-sm font-semibold">Label<input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} className="ia-input mt-2 text-sm" /></label>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-4 text-sm">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={draft.networks.includes('testnet')} onChange={(event) => setDraft({ ...draft, networks: event.target.checked ? [...new Set([...draft.networks, 'testnet' as const])] : draft.networks.filter((n) => n !== 'testnet') })} />Testnet</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={draft.networks.includes('public')} onChange={(event) => setDraft({ ...draft, networks: event.target.checked ? [...new Set([...draft.networks, 'public' as const])] : draft.networks.filter((n) => n !== 'public') })} />Mainnet</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />Enabled</label>
                  </div>

                  <label className="mt-4 block text-sm font-semibold">Authorization experience
                    <select value={draft.authorizationExperience} onChange={(event) => setDraft({ ...draft, authorizationExperience: event.target.value as Draft['authorizationExperience'] })} className="ia-select mt-2 text-sm">
                      <option value="hosted">MultiSigTools handles authorization</option>
                      <option value="native">Keep users on my site</option>
                      <option value="headless">Full Headless control</option>
                    </select>
                  </label>

                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <ScopeField title="Classic source accounts" value={draft.classicSourceAccounts} onChange={(value) => setDraft({ ...draft, classicSourceAccounts: value })} placeholder={'G...\nG...'} />
                    <ScopeField title="Classic external execution accounts" value={draft.classicExternalExecutionSourceAccounts} onChange={(value) => setDraft({ ...draft, classicExternalExecutionSourceAccounts: value })} placeholder={'G...'} />
                    <ScopeField title="Soroban contracts" value={draft.sorobanContracts} onChange={(value) => setDraft({ ...draft, sorobanContracts: value })} placeholder={'C...:transfer,reserve -> MST\nC...:claim -> G...'} />
                    <ScopeField title="Allowed Soroban executors" value={draft.sorobanExecutionAccounts} onChange={(value) => setDraft({ ...draft, sorobanExecutionAccounts: value })} placeholder={'G...A\nG...B'} />
                  </div>
                  <label className="mt-4 block text-sm font-semibold">Default Soroban executor<input value={draft.sorobanDefaultExecutor} onChange={(event) => setDraft({ ...draft, sorobanDefaultExecutor: event.target.value })} placeholder="Legacy only; must also be in the executor pool" className="ia-input mt-2 font-mono text-sm" /></label>

                  <div className="mt-6 border-t border-black/10 pt-6 dark:border-white/10">
                    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold">Webhook delivery</h3><p className="mt-1 text-sm text-neutral-500">Optional status delivery. It is independent from authorization experience.</p></div>{editing.webhook && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${editing.webhook.enabled ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-neutral-500/10 text-neutral-500'}`}>{editing.webhook.enabled ? 'Enabled' : 'Disabled'} · secret v{editing.webhook.secretVersion}</span>}</div>
                    <label className="mt-4 block text-sm font-semibold">Webhook URL<input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://fed.network/api/webhooks/multisig-tools" className="ia-input mt-2 font-mono text-sm" /></label>
                    <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={webhookEnabled} onChange={(event) => setWebhookEnabled(event.target.checked)} />Delivery enabled</label>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" disabled={busy || !webhookUrl.trim()} onClick={() => void configureWebhook({ url: webhookUrl.trim(), enabled: webhookEnabled })} className="ia-action ia-action--primary">{editing.webhook ? 'Save webhook' : 'Configure webhook'}</button>
                      {editing.webhook && <button type="button" disabled={busy} onClick={() => void rotateWebhookSecret()} className="ia-action"><RefreshCw className="h-4 w-4" />Rotate webhook secret</button>}
                      {editing.webhook && <button type="button" disabled={busy} onClick={() => void configureWebhook(null)} className="ia-action ia-action--danger">Remove webhook</button>}
                    </div>
                  </div>

                  <div className="mt-6 flex justify-end"><button type="button" disabled={busy || !draft.label.trim()} onClick={() => void save()} className="ia-action ia-action--primary"><Save className="h-4 w-4" />Save advanced configuration</button></div>
                </div>}
              </section>
            : <section className="py-16 text-center">
                <h2 className="text-lg font-bold">Select an Integration Profile</h2>
                <p className="mt-2 text-sm text-neutral-500">Choose an existing profile, or create a new MSI through the guided setup.</p>
              </section>}
        </div>
      </div>}
    </div>
  </main>;
}

function ManagedClassicStatusPanel({
  status,
  busy,
  error,
  onRefresh,
}: {
  status: ManagedClassicExecutionStatus | null;
  busy: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const operational = status?.operationalStatus;
  return <section className="ia-ops mt-6">
    <div className="ia-ops__head">
      <div>
        <p className="ia-kicker">Execution infrastructure</p>
        <h2 className="m-0 text-lg font-bold">Managed Classic channels</h2>
        <p className="ia-muted mt-1 text-sm">Public channel identities, lease capacity, and current native balance. No signing secret is exposed here.</p>
      </div>
      <button type="button" disabled={busy} onClick={onRefresh} className="ia-action">
        <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin motion-reduce:animate-none' : ''}`} />
        Refresh
      </button>
    </div>

    {error && <div className="ia-ops__error">{error}</div>}
    {!error && busy && !status && <div className="ia-muted py-4 text-sm">Loading managed Classic channel status…</div>}
    {!error && status && <>
      <div className="ia-ops__summary">
        <div><span>Network</span><strong>{status.network === 'public' ? 'Mainnet' : 'Testnet'}</strong></div>
        <div><span>Baseline</span><strong>{operational?.capacity ?? status.channelAccounts.length}</strong></div>
        <div><span>Soft limit</span><strong>{operational?.softLimit ?? status.channelAccounts.length}</strong></div>
        <div><span>Active leases</span><strong>{operational?.activeLeaseCount ?? 'Unavailable'}</strong></div>
      </div>

      {!status.configured
        ? <p className="ia-muted py-4 text-sm">Managed Classic execution is not configured on this deployment.</p>
        : operational
          ? <>
            {operational.creator && <div className="ia-channel-row mb-3">
              <div className="min-w-0">
                <div className="font-semibold">Channel creator</div>
                <div className="ia-code mt-1 text-xs">{operational.creator.accountId}</div>
                <div className="ia-muted mt-1 text-xs">
                  {operational.creator.balanceState === 'ready'
                    ? `${operational.creator.nativeBalance ?? 'Unknown'} XLM · low ${operational.creator.lowThreshold} · recover ${operational.creator.recoveryThreshold}`
                    : operational.creator.balanceState === 'missing'
                      ? 'Creator account not found'
                      : 'Creator balance unavailable'}
                </div>
              </div>
              <div className="ia-channel-row__lease">
                <strong>{operational.creator.state === 'ready'
                  ? 'Ready'
                  : operational.creator.state === 'low'
                    ? 'Low balance'
                    : operational.creator.state === 'insufficient'
                      ? 'Capacity exhausted'
                      : 'State unavailable'}</strong>
                {operational.creator.requiredForNextChannel && <span>Next channel requires {operational.creator.requiredForNextChannel} XLM</span>}
              </div>
            </div>}
            <div className="ia-channel-list">
              {operational.channels.map((channel) => <div key={channel.accountId} className="ia-channel-row">
                <div className="min-w-0">
                  <div className="ia-code font-semibold">{channel.accountId}</div>
                  <div className="ia-muted mt-1 text-xs">
                    {channel.balanceState === 'ready'
                      ? `${channel.nativeBalance ?? 'Unknown'} XLM`
                      : channel.balanceState === 'missing'
                        ? 'Account not funded / not found'
                        : 'Balance unavailable'}
                  </div>
                </div>
                <div className="ia-channel-row__lease">
                  <strong>{channel.leaseState === 'active'
                    ? 'Active lease'
                    : channel.leaseState === 'expired'
                      ? 'Expired lease'
                      : channel.leaseState === 'free'
                        ? 'Free'
                        : 'Lease status unavailable'}</strong>
                  {channel.leaseExpiresAt && <span>{channel.leaseState === 'active' ? 'Until ' : 'Expired '}{new Date(channel.leaseExpiresAt).toLocaleString()}</span>}
                </div>
              </div>)}
            </div>
          </>
          : <p className="ia-muted py-4 text-sm">Detailed channel status is unavailable.</p>}
    </>}
  </section>;
}

function IntegrationProfileDetail({ service, onRotate, busy }: { service: ServiceSummary; onRotate: () => void; busy: boolean }) {
  const experience = service.profile.authorizationExperience === 'hosted'
    ? 'MST-hosted'
    : service.profile.authorizationExperience === 'native'
      ? 'On my site'
      : 'Full Headless';
  const externalClassic = new Set(service.classicExternalExecutionSourceAccounts);
  const hasCustomExecution = externalClassic.size > 0
    || service.sorobanExecutionAccounts.length > 0
    || Boolean(service.sorobanDefaultExecutor)
    || service.sorobanContracts.some((contract) => contract.execution?.mode === 'external');

  return <div className="ia-profile-grid">
    <div className="grid gap-4 md:grid-cols-2">
      <ProfileBlock title="Identity">
        <ProfileRow label="Networks" value={service.networks.map((network) => network === 'public' ? 'Mainnet' : 'Testnet').join(', ')} />
        <ProfileRow label="Authorization" value={experience} />
        <ProfileRow label="Execution" value={hasCustomExecution ? 'Custom routing' : 'Managed by MultiSigTools'} />
        <ProfileRow label="Source" value={service.source === 'durable' ? 'Durable profile' : 'Deployment bootstrap'} />
      </ProfileBlock>

      <ProfileBlock title="Credential">
        <ProfileRow label="API identity" value="MSI credential active" />
        <p className="mt-2 text-xs text-neutral-500">Plaintext is never shown again after issuance. Rotate to replace it.</p>
        <button type="button" disabled={busy} onClick={onRotate} className="ia-action mt-3">
          <RefreshCw className="h-4 w-4" />Rotate MSI credential
        </button>
      </ProfileBlock>
    </div>

    <ProfileBlock title="Classic Treasuries">
      {service.classicSourceAccounts.length === 0
        ? <p className="text-sm text-neutral-500">No Classic Treasury scope.</p>
        : <div className="divide-y divide-black/5 dark:divide-white/5">
            {service.classicSourceAccounts.map((accountId) => <div key={accountId} className="grid gap-1 py-3 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-4">
              <span className="min-w-0 break-all font-mono text-xs">{accountId}</span>
              <span className="text-sm font-medium">{hasCustomExecution ? (externalClassic.has(accountId) ? 'My service submits' : 'MST managed') : 'Allowed'}</span>
            </div>)}
          </div>}
    </ProfileBlock>

    <ProfileBlock title="Soroban Contracts">
      {service.sorobanContracts.length === 0
        ? <p className="text-sm text-neutral-500">No Soroban contract scope.</p>
        : <div className="space-y-4">
            {service.sorobanContracts.map((contract) => {
              const execution = contract.execution?.mode === 'multisigtools'
                ? 'MultiSigTools managed'
                : contract.execution?.mode === 'external'
                  ? contract.execution.executor
                  : service.sorobanDefaultExecutor ?? 'Legacy managed fallback';
              return <div key={contract.contractId} className="ia-contract-row">
                <div className="ia-code font-semibold">{contract.contractId}</div>
                <div className="ia-methods">{contract.methods.map((method) => <span key={method} className="ia-method">{method}</span>)}</div>
                {hasCustomExecution && <div className="ia-muted mt-3 text-xs">
                  Execution · <span className="break-all font-mono">{execution}</span>
                </div>}
              </div>;
            })}
            {hasCustomExecution && service.sorobanExecutionAccounts.length > 0 && <div className="border-t border-black/10 pt-3 text-sm dark:border-white/10">
              <span className="text-neutral-500">Executor pool: </span>
              <span className="font-medium">{service.sorobanExecutionAccounts.length}</span>
              <div className="mt-2 space-y-1">
                {service.sorobanExecutionAccounts.map((executor) => <div key={executor} className="break-all font-mono text-xs">{executor}</div>)}
              </div>
            </div>}
          </div>}
    </ProfileBlock>

    <ProfileBlock title="Status updates">
      {service.webhook
        ? <>
            <ProfileRow label="Webhook" value={service.webhook.enabled ? 'Enabled' : 'Disabled'} />
            <div className="mt-2 break-all font-mono text-xs text-neutral-500">{service.webhook.url}</div>
            <div className="mt-1 text-xs text-neutral-400">Signing secret generation {service.webhook.secretVersion}</div>
          </>
        : <p className="text-sm text-neutral-500">Webhook off.</p>}
    </ProfileBlock>
  </div>;
}

function ProfileBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="ia-profile-section">
    <h3 className="ia-profile-section__title">{title}</h3>
    <div>{children}</div>
  </section>;
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4 border-b border-black/5 py-2 text-sm last:border-0 dark:border-white/5">
    <span className="text-neutral-500">{label}</span>
    <span className="text-right font-medium">{value}</span>
  </div>;
}

function ScopeField({ title, value, onChange, placeholder }: { title: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="text-sm font-semibold">{title}<textarea rows={5} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} spellCheck={false} className="ia-textarea mt-2 font-mono text-xs leading-5" /></label>;
}
