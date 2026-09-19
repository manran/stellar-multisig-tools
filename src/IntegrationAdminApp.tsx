import { useMemo, useState } from 'react';
import { Check, ClipboardCopy, KeyRound, LoaderCircle, Plus, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import IntegrationProfileWizard, { type IntegrationProfileWizardResult } from './IntegrationProfileWizard';
import { PageHeader } from './MultiSigUi';

interface ContractScope { contractId: string; methods: string[]; }
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
    const separator = line.indexOf(':');
    return { contractId: separator < 0 ? line : line.slice(0, separator).trim(), methods: separator < 0 ? [] : lines(line.slice(separator + 1)) };
  });
}

function draftFrom(service: ServiceSummary): Draft {
  return {
    serviceId: service.serviceId, label: service.label, enabled: service.enabled, networks: service.networks,
    classicSourceAccounts: service.classicSourceAccounts.join('\n'),
    classicExternalExecutionSourceAccounts: service.classicExternalExecutionSourceAccounts.join('\n'),
    sorobanContracts: service.sorobanContracts.map((item) => `${item.contractId}:${item.methods.join(',')}`).join('\n'),
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
  const editing = useMemo(() => services.find((item) => item.serviceId === editingId), [services, editingId]);

  const headers = () => ({ Authorization: `Bearer ${adminSecret.trim()}`, 'Content-Type': 'application/json' });

  async function load(preserveGeneratedSecrets = false): Promise<ServiceSummary[]> {
    setBusy(true); setError('');
    if (!preserveGeneratedSecrets) { setGeneratedKey(''); setGeneratedWebhookSecret(''); }
    try {
      const body = await apiJson<{ services: ServiceSummary[] }>(await fetch('/api/integration-admin', { headers: { Authorization: `Bearer ${adminSecret.trim()}` }, cache: 'no-store' }));
      setServices(body.services); setLoaded(true);
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

  return <main className="min-h-screen bg-[#f6f6f2] px-4 py-10 text-[#171717] dark:bg-[#090909] dark:text-[#f5f5f0] sm:px-6 lg:px-8">
    <div className="mx-auto max-w-6xl space-y-7">
      <PageHeader eyebrow="Operator" title="Integration administration" description="Provision non-signer Service identities, scope what they may coordinate, and rotate credentials. This surface is deployment-operator only." />

      <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex items-center gap-2 font-bold"><ShieldCheck className="h-5 w-5" />Operator access</div>
        <p className="mt-2 text-sm text-neutral-500">Enter the deployment <code>mia_...</code> secret. It remains only in this page's memory and is not saved by the browser.</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row"><input type="password" autoComplete="off" value={adminSecret} onChange={(event) => setAdminSecret(event.target.value)} placeholder="mia_..." className="min-w-0 flex-1 rounded-xl border border-black/10 bg-transparent px-4 py-3 font-mono text-sm dark:border-white/10" /><button type="button" disabled={busy || !adminSecret.trim()} onClick={() => void load(false)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}Load services</button></div>
      </section>

      {error && <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">{error}</div>}
      {generatedKey && <section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5"><div className="font-bold">API credential — shown once</div><p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">Store this value in your server-side secret store. The Integration Profile can be viewed later, but this credential cannot.</p><p className="mt-3 break-all font-mono text-sm">{generatedKey}</p><button type="button" onClick={() => void copyKey()} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-white/10">{copied ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}{copied ? 'Copied' : 'Copy credential'}</button></section>}
      {generatedWebhookSecret && <section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5"><div className="font-bold">Webhook signing secret</div><p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">Store this value in the webhook receiver and use it to verify Standard Webhooks signatures.</p><p className="mt-3 break-all font-mono text-sm">{generatedWebhookSecret}</p><button type="button" onClick={() => void copyWebhookSecret()} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold dark:border-white/10">{webhookCopied ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}{webhookCopied ? 'Copied' : 'Copy webhook secret'}</button></section>}

      {loaded && <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <section className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex items-center justify-between gap-2"><h2 className="font-bold">Services</h2><button type="button" onClick={createNew} className="inline-flex items-center gap-1 rounded-lg border border-black/10 px-2.5 py-2 text-xs font-semibold dark:border-white/10"><Plus className="h-3.5 w-3.5" />New</button></div>
          <div className="mt-3 space-y-2">{services.map((service) => <button key={service.serviceId} type="button" onClick={() => select(service)} className={`w-full rounded-xl border p-3 text-left ${editingId === service.serviceId ? 'border-emerald-500/50 bg-emerald-500/[0.06]' : 'border-black/10 dark:border-white/10'}`}><div className="flex items-center justify-between gap-2"><span className="font-semibold">{service.label}</span><span className={`text-xs ${service.enabled ? 'text-emerald-700 dark:text-emerald-300' : 'text-neutral-400'}`}>{service.enabled ? 'Enabled' : 'Disabled'}</span></div><div className="mt-1 font-mono text-xs text-neutral-500">{service.serviceId}</div><div className="mt-1 text-xs text-neutral-400">{service.source}</div></button>)}</div>
        </section>

        {creatingNew
          ? <IntegrationProfileWizard
              adminSecret={adminSecret}
              onCreated={createdFromWizard}
              onCancel={() => setCreatingNew(false)}
            />
          : editing
            ? <section className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-bold">{editing.label}</h2>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${editing.enabled ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-neutral-500/10 text-neutral-500'}`}>{editing.enabled ? 'Enabled' : 'Disabled'}</span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-neutral-500">{editing.serviceId}</p>
                    <p className="mt-2 text-sm text-neutral-500">{editing.source === 'bootstrap' ? 'Bootstrap profile · saving creates a durable override.' : 'Durable Integration Profile'}</p>
                  </div>
                  <button type="button" onClick={() => setAdvancedOpen((value) => !value)} className="whitespace-nowrap rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-white/10">
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
                    <button type="button" disabled={busy} onClick={() => void rotate()} className="inline-flex whitespace-nowrap items-center gap-2 rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40 dark:border-white/10"><RefreshCw className="h-4 w-4" />Rotate MSI credential</button>
                  </div>

                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-semibold">Service id<input disabled value={draft.serviceId} className="mt-2 w-full rounded-xl border border-black/10 bg-transparent px-3 py-3 font-mono text-sm opacity-60 dark:border-white/10" /></label>
                    <label className="text-sm font-semibold">Label<input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} className="mt-2 w-full rounded-xl border border-black/10 bg-transparent px-3 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-white/10" /></label>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-4 text-sm">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={draft.networks.includes('testnet')} onChange={(event) => setDraft({ ...draft, networks: event.target.checked ? [...new Set([...draft.networks, 'testnet' as const])] : draft.networks.filter((n) => n !== 'testnet') })} />Testnet</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={draft.networks.includes('public')} onChange={(event) => setDraft({ ...draft, networks: event.target.checked ? [...new Set([...draft.networks, 'public' as const])] : draft.networks.filter((n) => n !== 'public') })} />Mainnet</label>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />Enabled</label>
                  </div>

                  <label className="mt-4 block text-sm font-semibold">Authorization experience
                    <select value={draft.authorizationExperience} onChange={(event) => setDraft({ ...draft, authorizationExperience: event.target.value as Draft['authorizationExperience'] })} className="mt-2 w-full rounded-xl border border-black/10 bg-transparent px-3 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-white/10">
                      <option value="hosted">MultiSigTools handles authorization</option>
                      <option value="native">Keep users on my site</option>
                      <option value="headless">Full Headless control</option>
                    </select>
                  </label>

                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <ScopeField title="Classic source accounts" value={draft.classicSourceAccounts} onChange={(value) => setDraft({ ...draft, classicSourceAccounts: value })} placeholder={'G...\nG...'} />
                    <ScopeField title="Classic external execution accounts" value={draft.classicExternalExecutionSourceAccounts} onChange={(value) => setDraft({ ...draft, classicExternalExecutionSourceAccounts: value })} placeholder={'G...'} />
                    <ScopeField title="Soroban contracts" value={draft.sorobanContracts} onChange={(value) => setDraft({ ...draft, sorobanContracts: value })} placeholder={'C...:transfer,reserve\nC...:claim'} />
                    <ScopeField title="Allowed Soroban executors" value={draft.sorobanExecutionAccounts} onChange={(value) => setDraft({ ...draft, sorobanExecutionAccounts: value })} placeholder={'G...A\nG...B'} />
                  </div>
                  <label className="mt-4 block text-sm font-semibold">Default Soroban executor<input value={draft.sorobanDefaultExecutor} onChange={(event) => setDraft({ ...draft, sorobanDefaultExecutor: event.target.value })} placeholder="Optional G...; must also be allowed above" className="mt-2 w-full rounded-xl border border-black/10 bg-transparent px-3 py-3 font-mono text-sm focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-white/10" /></label>

                  <div className="mt-6 border-t border-black/10 pt-6 dark:border-white/10">
                    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold">Webhook delivery</h3><p className="mt-1 text-sm text-neutral-500">Optional status delivery. It is independent from authorization experience.</p></div>{editing.webhook && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${editing.webhook.enabled ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-neutral-500/10 text-neutral-500'}`}>{editing.webhook.enabled ? 'Enabled' : 'Disabled'} · secret v{editing.webhook.secretVersion}</span>}</div>
                    <label className="mt-4 block text-sm font-semibold">Webhook URL<input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://fed.network/api/webhooks/multisig-tools" className="mt-2 w-full rounded-xl border border-black/10 bg-transparent px-3 py-3 font-mono text-sm focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-white/10" /></label>
                    <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={webhookEnabled} onChange={(event) => setWebhookEnabled(event.target.checked)} />Delivery enabled</label>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" disabled={busy || !webhookUrl.trim()} onClick={() => void configureWebhook({ url: webhookUrl.trim(), enabled: webhookEnabled })} className="whitespace-nowrap rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40">{editing.webhook ? 'Save webhook' : 'Configure webhook'}</button>
                      {editing.webhook && <button type="button" disabled={busy} onClick={() => void rotateWebhookSecret()} className="inline-flex whitespace-nowrap items-center gap-2 rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-white/10"><RefreshCw className="h-4 w-4" />Rotate webhook secret</button>}
                      {editing.webhook && <button type="button" disabled={busy} onClick={() => void configureWebhook(null)} className="whitespace-nowrap rounded-xl border border-red-500/20 px-4 py-2.5 text-sm font-semibold text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-red-300">Remove webhook</button>}
                    </div>
                  </div>

                  <div className="mt-6 flex justify-end"><button type="button" disabled={busy || !draft.label.trim()} onClick={() => void save()} className="inline-flex whitespace-nowrap items-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40"><Save className="h-4 w-4" />Save advanced configuration</button></div>
                </div>}
              </section>
            : <section className="rounded-2xl border border-dashed border-black/15 bg-white p-8 text-center dark:border-white/15 dark:bg-white/[0.03]">
                <h2 className="text-lg font-bold">Select an Integration Profile</h2>
                <p className="mt-2 text-sm text-neutral-500">Choose an existing profile, or create a new MSI through the guided setup.</p>
              </section>}
      </div>}
    </div>
  </main>;
}

function IntegrationProfileDetail({ service, onRotate, busy }: { service: ServiceSummary; onRotate: () => void; busy: boolean }) {
  const experience = service.profile.authorizationExperience === 'hosted'
    ? 'MultiSigTools handles authorization'
    : service.profile.authorizationExperience === 'native'
      ? 'Keep users on my site'
      : 'Full Headless control';
  const externalClassic = new Set(service.classicExternalExecutionSourceAccounts);

  return <div className="mt-6 space-y-5">
    <div className="grid gap-4 md:grid-cols-2">
      <ProfileBlock title="Identity">
        <ProfileRow label="Networks" value={service.networks.map((network) => network === 'public' ? 'Mainnet' : 'Testnet').join(', ')} />
        <ProfileRow label="Authorization" value={experience} />
        <ProfileRow label="Source" value={service.source === 'durable' ? 'Durable profile' : 'Deployment bootstrap'} />
      </ProfileBlock>

      <ProfileBlock title="Credential">
        <ProfileRow label="API identity" value="MSI credential active" />
        <p className="mt-2 text-xs text-neutral-500">Plaintext is never shown again after issuance. Rotate to replace it.</p>
        <button type="button" disabled={busy} onClick={onRotate} className="mt-3 inline-flex whitespace-nowrap items-center gap-2 rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40 dark:border-white/10">
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
              <span className="text-sm font-medium">{externalClassic.has(accountId) ? 'My service submits' : 'MultiSigTools submits'}</span>
            </div>)}
          </div>}
    </ProfileBlock>

    <ProfileBlock title="Soroban Contracts">
      {service.sorobanContracts.length === 0
        ? <p className="text-sm text-neutral-500">No Soroban contract scope.</p>
        : <div className="space-y-4">
            {service.sorobanContracts.map((contract) => <div key={contract.contractId} className="rounded-xl border border-black/10 p-3 dark:border-white/10">
              <div className="break-all font-mono text-xs font-semibold">{contract.contractId}</div>
              <div className="mt-2 flex flex-wrap gap-2">{contract.methods.map((method) => <span key={method} className="rounded-full border border-black/10 px-2.5 py-1 font-mono text-xs dark:border-white/10">{method}</span>)}</div>
            </div>)}
            <div className="border-t border-black/10 pt-3 text-sm dark:border-white/10">
              <span className="text-neutral-500">Execution: </span>
              {service.sorobanDefaultExecutor
                ? <><span className="font-medium">My service</span><span className="ml-2 break-all font-mono text-xs">{service.sorobanDefaultExecutor}</span></>
                : <span className="font-medium">MultiSigTools managed fallback</span>}
            </div>
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
  return <section className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
    <h3 className="font-bold">{title}</h3>
    <div className="mt-3">{children}</div>
  </section>;
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4 border-b border-black/5 py-2 text-sm last:border-0 dark:border-white/5">
    <span className="text-neutral-500">{label}</span>
    <span className="text-right font-medium">{value}</span>
  </div>;
}

function ScopeField({ title, value, onChange, placeholder }: { title: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="text-sm font-semibold">{title}<textarea rows={5} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} spellCheck={false} className="mt-2 w-full rounded-xl border border-black/10 bg-transparent px-3 py-3 font-mono text-xs leading-5 dark:border-white/10" /></label>;
}
