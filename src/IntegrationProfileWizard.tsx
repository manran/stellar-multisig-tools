/* Hallmark · macrostructure: Narrative Workflow · tone: operational-minimal · anchor hue: existing network semantic · pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleDot,
  LoaderCircle,
  Plus,
  Server,
  ShieldCheck,
  Trash2,
  WalletCards,
} from 'lucide-react';
import { analyzeAccountAuthorization } from './stellar/authorization';
import { isValidContractId } from './stellar/contractSpec';
import { isValidStellarAccountId, loadAccount } from './stellar/horizon';
import { buildIntegrationAdminConfiguration } from './stellar/integrationProvisioning';
import type { AccountAuthorizationAnalysis, StellarAccountSnapshot, StellarNetwork } from './stellar/types';

type AuthorizationExperience = 'hosted' | 'native' | 'headless';
type ExecutionOwner = 'multisigtools' | 'integration';

interface TreasuryEntry {
  accountId: string;
  snapshot: StellarAccountSnapshot;
  analysis: AccountAuthorizationAnalysis;
  executionOwner: ExecutionOwner;
}

interface ContractMethod {
  name: string;
  doc?: string;
  guided?: boolean;
}

interface ContractEntry {
  contractId: string;
  methods: ContractMethod[];
  selectedMethods: string[];
}

interface ApiError {
  error?: string;
}

interface CreateResult {
  service: { serviceId: string };
  apiKey: string;
  webhookSecret?: string;
}

export interface IntegrationProfileWizardResult {
  serviceId: string;
  apiKey: string;
  webhookSecret?: string;
}

interface Props {
  adminSecret: string;
  onCreated: (result: IntegrationProfileWizardResult) => Promise<void> | void;
  onCancel: () => void;
}

const STEPS = ['Identity', 'Classic', 'Contracts', 'Integration', 'Review'] as const;

async function apiJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T | ApiError;
  if (!response.ok) throw new Error((body as ApiError).error || `HTTP ${response.status}`);
  return body as T;
}

function compactAddress(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-8)}` : value;
}

function ownerLabel(owner: ExecutionOwner): string {
  return owner === 'multisigtools' ? 'MultiSigTools submits' : 'My service submits';
}

export default function IntegrationProfileWizard({ adminSecret, onCreated, onCancel }: Props) {
  const [step, setStep] = useState(0);
  const [serviceId, setServiceId] = useState('');
  const [label, setLabel] = useState('');
  const [network, setNetwork] = useState<StellarNetwork>('testnet');
  const [fixedNetwork, setFixedNetwork] = useState<StellarNetwork | null>(null);

  const [treasuryInput, setTreasuryInput] = useState('');
  const [treasuries, setTreasuries] = useState<TreasuryEntry[]>([]);
  const [treasuryBusy, setTreasuryBusy] = useState(false);

  const [contractInput, setContractInput] = useState('');
  const [contracts, setContracts] = useState<ContractEntry[]>([]);
  const [contractBusy, setContractBusy] = useState(false);
  const [sorobanExecutionOwner, setSorobanExecutionOwner] = useState<ExecutionOwner>('multisigtools');
  const [sorobanExecutor, setSorobanExecutor] = useState('');

  const [authorizationExperience, setAuthorizationExperience] = useState<AuthorizationExperience>('hosted');
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');

  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch('/api/runtime-config', { cache: 'no-store' })
      .then((response) => apiJson<{ fixedNetwork: StellarNetwork | null }>(response))
      .then((body) => {
        if (!active) return;
        setFixedNetwork(body.fixedNetwork);
        if (body.fixedNetwork) resetNetwork(body.fixedNetwork);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const selectedMethodCount = useMemo(
    () => contracts.reduce((sum, item) => sum + item.selectedMethods.length, 0),
    [contracts],
  );

  const hasBusinessScope = treasuries.length > 0 || selectedMethodCount > 0;
  const sorobanExecutionValid = sorobanExecutionOwner === 'multisigtools' || isValidStellarAccountId(sorobanExecutor);
  const webhookValid = !webhookEnabled || /^https:\/\//i.test(webhookUrl.trim());
  const basicsValid = Boolean(serviceId.trim() && label.trim());
  const readyToCreate = basicsValid && hasBusinessScope && sorobanExecutionValid && webhookValid;

  function resetNetwork(next: StellarNetwork) {
    if (next === network) return;
    setNetwork(next);
    setTreasuries([]);
    setContracts([]);
    setTreasuryInput('');
    setContractInput('');
    setError('');
  }

  async function addTreasury() {
    const accountId = treasuryInput.trim();
    if (!isValidStellarAccountId(accountId)) {
      setError('Enter a valid Stellar G... Treasury address.');
      return;
    }
    if (treasuries.some((item) => item.accountId === accountId)) {
      setError('This Treasury is already in the Integration profile.');
      return;
    }
    setTreasuryBusy(true);
    setError('');
    try {
      const snapshot = await loadAccount(accountId, network);
      const analysis = analyzeAccountAuthorization(snapshot);
      setTreasuries((current) => [...current, {
        accountId: snapshot.accountId,
        snapshot,
        analysis,
        executionOwner: 'multisigtools',
      }]);
      setTreasuryInput('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to inspect this Treasury.');
    } finally {
      setTreasuryBusy(false);
    }
  }

  async function addContract() {
    const contractId = contractInput.trim();
    if (!isValidContractId(contractId)) {
      setError('Enter a valid Stellar C... contract address.');
      return;
    }
    if (contracts.some((item) => item.contractId === contractId)) {
      setError('This contract is already in the Integration profile.');
      return;
    }
    setContractBusy(true);
    setError('');
    try {
      const query = new URLSearchParams({ network, contract: contractId });
      const body = await apiJson<{ contractId: string; methods: ContractMethod[] }>(
        await fetch(`/api/contract-interface?${query.toString()}`, { cache: 'no-store' }),
      );
      setContracts((current) => [...current, {
        contractId: body.contractId,
        methods: body.methods,
        selectedMethods: [],
      }]);
      setContractInput('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to inspect this contract.');
    } finally {
      setContractBusy(false);
    }
  }

  function setTreasuryExecution(accountId: string, executionOwner: ExecutionOwner) {
    setTreasuries((current) => current.map((item) => (
      item.accountId === accountId ? { ...item, executionOwner } : item
    )));
  }

  function toggleMethod(contractId: string, method: string) {
    setContracts((current) => current.map((item) => {
      if (item.contractId !== contractId) return item;
      const selected = item.selectedMethods.includes(method)
        ? item.selectedMethods.filter((value) => value !== method)
        : [...item.selectedMethods, method];
      return { ...item, selectedMethods: selected };
    }));
  }

  function next() {
    setError('');
    if (step === 0 && !basicsValid) {
      setError('Service id and label are required.');
      return;
    }
    if (step === 2 && !hasBusinessScope) {
      setError('Add a Classic Treasury or select at least one contract method.');
      return;
    }
    if (step === 2 && !sorobanExecutionValid) {
      setError('Enter a valid Stellar G... executor, or let MultiSigTools submit.');
      return;
    }
    if (step === 3 && !webhookValid) {
      setError('Webhook URL must use HTTPS.');
      return;
    }
    setStep((current) => Math.min(STEPS.length - 1, current + 1));
  }

  async function create() {
    if (!readyToCreate || creating) return;
    setCreating(true);
    setError('');
    try {
      const body = buildIntegrationAdminConfiguration({
        serviceId,
        label,
        network,
        treasuries: treasuries.map((item) => ({ accountId: item.accountId, executionOwner: item.executionOwner })),
        contracts: contracts.map((item) => ({ contractId: item.contractId, methods: item.selectedMethods })),
        sorobanExecutionOwner,
        sorobanExecutor,
        authorizationExperience,
        ...(webhookEnabled ? { webhook: { url: webhookUrl, enabled: true } } : {}),
      });
      const result = await apiJson<CreateResult>(await fetch('/api/integration-admin', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminSecret.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }));
      await onCreated({
        serviceId: result.service.serviceId,
        apiKey: result.apiKey,
        ...(result.webhookSecret ? { webhookSecret: result.webhookSecret } : {}),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create this Integration profile.');
    } finally {
      setCreating(false);
    }
  }

  return <section className="rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-white/[0.03]">
    <div className="border-b border-black/10 p-5 dark:border-white/10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">New Integration</div>
          <h2 className="mt-1 text-2xl font-bold">Define the profile before issuing a credential</h2>
          <p className="mt-2 max-w-3xl text-sm text-neutral-500">
            Scope the accounts and contracts first. The MSI credential is generated only after review.
          </p>
        </div>
        <button type="button" onClick={onCancel} className="whitespace-nowrap rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/[0.03] active:bg-black/[0.05] hover:border-black/20 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-white/10 dark:hover:border-white/20 dark:hover:bg-white/[0.04] dark:active:bg-white/[0.07]">
          Cancel
        </button>
      </div>

      <div className="mt-5 flex flex-wrap gap-2" aria-label="Integration setup steps">
        {STEPS.map((item, index) => <button
          key={item}
          type="button"
          onClick={() => index <= step && setStep(index)}
          disabled={index > step}
          className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${index === step ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200' : 'border-black/10 text-neutral-500 dark:border-white/10'}`}
        >
          {index + 1}. {item}
        </button>)}
      </div>
    </div>

    {error && <div className="mx-5 mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error}</div>}

    <div className="p-5">
      {step === 0 && <div className="max-w-3xl space-y-5">
        <div>
          <h3 className="text-lg font-bold">Identity and network</h3>
          <p className="mt-1 text-sm text-neutral-500">The guided flow uses one network per profile. Expert configuration can expand this later.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold">Service id
            <input value={serviceId} onChange={(event) => setServiceId(event.target.value)} placeholder="fednetwork" className="mt-2 w-full rounded-xl border border-black/10 bg-transparent px-3 py-3 font-mono text-sm hover:border-black/20 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-white/10 dark:hover:border-white/20" />
          </label>
          <label className="text-sm font-semibold">Display name
            <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="FedNetwork" className="mt-2 w-full rounded-xl border border-black/10 bg-transparent px-3 py-3 text-sm hover:border-black/20 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-white/10 dark:hover:border-white/20" />
          </label>
        </div>
        <div>
          <div className="text-sm font-semibold">Network</div>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <ChoiceCard selected={network === 'testnet'} disabled={fixedNetwork === 'public'} onClick={() => resetNetwork('testnet')} title="Testnet" description={fixedNetwork === 'public' ? 'Unavailable on this deployment.' : 'Recommended while building and validating the integration.'} />
            <ChoiceCard selected={network === 'public'} disabled={fixedNetwork === 'testnet'} onClick={() => resetNetwork('public')} title="Mainnet" description={fixedNetwork === 'testnet' ? 'Unavailable on this deployment.' : 'Production Stellar network.'} />
          </div>
        </div>
      </div>}

      {step === 1 && <div className="space-y-5">
        <div>
          <h3 className="text-lg font-bold">Classic Treasuries</h3>
          <p className="mt-1 text-sm text-neutral-500">Add the accounts this Integration may coordinate. MST reads the live signer policy; it does not redefine it.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={treasuryInput} onChange={(event) => setTreasuryInput(event.target.value)} placeholder="G..." className="min-w-0 flex-1 rounded-xl border border-black/10 bg-transparent px-3 py-3 font-mono text-sm hover:border-black/20 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-white/10 dark:hover:border-white/20" />
          <button type="button" disabled={treasuryBusy || !treasuryInput.trim()} onClick={() => void addTreasury()} className="inline-flex whitespace-nowrap items-center justify-center gap-2 rounded-xl border border-black/10 px-4 py-3 text-sm font-semibold hover:bg-black/[0.03] active:bg-black/[0.05] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/[0.04] dark:active:bg-white/[0.07]">
            {treasuryBusy ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Plus className="h-4 w-4" />}Inspect Treasury
          </button>
        </div>

        {treasuries.length === 0
          ? <EmptyState icon={<WalletCards className="h-5 w-5" />} text="No Classic Treasury added. You can create a Soroban-only Integration." />
          : <div className="space-y-4">{treasuries.map((item) => <article key={item.accountId} className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-sm font-semibold break-all">{item.accountId}</div>
                  <div className="mt-1 text-sm text-neutral-500">
                    Low {item.analysis.thresholds.low.policyLabel} · Medium {item.analysis.thresholds.medium.policyLabel} · High {item.analysis.thresholds.high.policyLabel}
                  </div>
                </div>
                <button type="button" onClick={() => setTreasuries((current) => current.filter((entry) => entry.accountId !== item.accountId))} className="inline-flex whitespace-nowrap items-center gap-1 rounded-lg border border-red-500/20 px-2.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-500/5 active:bg-red-500/10 focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-red-300">
                  <Trash2 className="h-3.5 w-3.5" />Remove
                </button>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_280px]">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">Current signers</div>
                  <div className="mt-2 divide-y divide-black/5 rounded-xl border border-black/10 dark:divide-white/5 dark:border-white/10">
                    {item.snapshot.signers.filter((signer) => signer.weight > 0).map((signer) => <div key={signer.key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate font-mono" title={signer.key}>{compactAddress(signer.key)}</span>
                      <span className="whitespace-nowrap text-neutral-500">weight {signer.weight}</span>
                    </div>)}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">When ready</div>
                  <div className="mt-2 space-y-2">
                    <SmallChoice selected={item.executionOwner === 'multisigtools'} onClick={() => setTreasuryExecution(item.accountId, 'multisigtools')} title="MultiSigTools submits" />
                    <SmallChoice selected={item.executionOwner === 'integration'} onClick={() => setTreasuryExecution(item.accountId, 'integration')} title="My service submits" />
                  </div>
                </div>
              </div>
            </article>)}</div>}
      </div>}

      {step === 2 && <div className="space-y-5">
        <div>
          <h3 className="text-lg font-bold">Soroban contracts</h3>
          <p className="mt-1 text-sm text-neutral-500">Inspect deployed ABI and explicitly select the methods this Integration may create Intents for.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={contractInput} onChange={(event) => setContractInput(event.target.value)} placeholder="C..." className="min-w-0 flex-1 rounded-xl border border-black/10 bg-transparent px-3 py-3 font-mono text-sm hover:border-black/20 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-white/10 dark:hover:border-white/20" />
          <button type="button" disabled={contractBusy || !contractInput.trim()} onClick={() => void addContract()} className="inline-flex whitespace-nowrap items-center justify-center gap-2 rounded-xl border border-black/10 px-4 py-3 text-sm font-semibold hover:bg-black/[0.03] active:bg-black/[0.05] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/[0.04] dark:active:bg-white/[0.07]">
            {contractBusy ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Plus className="h-4 w-4" />}Inspect contract
          </button>
        </div>

        {contracts.length === 0
          ? <EmptyState icon={<Server className="h-5 w-5" />} text="No Soroban contract added. You can create a Classic-only Integration." />
          : <div className="space-y-4">{contracts.map((item) => <article key={item.contractId} className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-sm font-semibold break-all">{item.contractId}</div>
                  <div className="mt-1 text-sm text-neutral-500">{item.methods.length} methods discovered · {item.selectedMethods.length} allowed</div>
                </div>
                <button type="button" onClick={() => setContracts((current) => current.filter((entry) => entry.contractId !== item.contractId))} className="inline-flex whitespace-nowrap items-center gap-1 rounded-lg border border-red-500/20 px-2.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-500/5 active:bg-red-500/10 focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-red-300">
                  <Trash2 className="h-3.5 w-3.5" />Remove
                </button>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {item.methods.map((method) => <label key={method.name} className="flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border border-black/10 p-3 dark:border-white/10">
                  <input type="checkbox" className="mt-1" checked={item.selectedMethods.includes(method.name)} onChange={() => toggleMethod(item.contractId, method.name)} />
                  <span className="min-w-0">
                    <span className="block font-mono text-sm font-semibold break-all">{method.name}</span>
                    <span className="mt-1 block text-xs text-neutral-500">{method.guided === false ? 'Raw/advanced inputs' : method.doc || 'Callable contract method'}</span>
                  </span>
                </label>)}
              </div>
            </article>)}</div>}

        {contracts.length > 0 && <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
          <div className="font-bold">Soroban execution</div>
          <p className="mt-1 text-sm text-neutral-500">Current runtime executor scope is Integration-wide. MST does not pretend this setting is isolated per contract.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <ChoiceCard selected={sorobanExecutionOwner === 'multisigtools'} onClick={() => setSorobanExecutionOwner('multisigtools')} title="MultiSigTools submits" description="Use the deployment-managed executor when execution is prepared." />
            <ChoiceCard selected={sorobanExecutionOwner === 'integration'} onClick={() => setSorobanExecutionOwner('integration')} title="My service submits" description="Bind a server-side Stellar execution account." />
          </div>
          {sorobanExecutionOwner === 'integration' && <label className="mt-4 block text-sm font-semibold">Execution account
            <input value={sorobanExecutor} onChange={(event) => setSorobanExecutor(event.target.value)} placeholder="G..." className="mt-2 w-full rounded-xl border border-black/10 bg-transparent px-3 py-3 font-mono text-sm hover:border-black/20 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-white/10 dark:hover:border-white/20" />
          </label>}
        </div>}
      </div>}

      {step === 3 && <div className="max-w-4xl space-y-6">
        <div>
          <h3 className="text-lg font-bold">How deeply do you want to integrate?</h3>
          <p className="mt-1 text-sm text-neutral-500">The Headless Core is the same. This choice controls how much product complexity MST exposes by default.</p>
        </div>
        <div className="grid gap-3">
          <ChoiceCard selected={authorizationExperience === 'hosted'} onClick={() => setAuthorizationExperience('hosted')} title="MultiSigTools handles authorization" description="Lowest integration effort. Send signers to the hosted authorization experience when needed." />
          <ChoiceCard selected={authorizationExperience === 'native'} onClick={() => setAuthorizationExperience('native')} title="Keep users on my site" description="Use your own wallet and signing UI while MultiSigTools coordinates and verifies authorization." />
          <ChoiceCard selected={authorizationExperience === 'headless'} onClick={() => setAuthorizationExperience('headless')} title="Full Headless control" description="Expose the full supported orchestration, execution and automation surface." />
        </div>

        <div className="border-t border-black/10 pt-5 dark:border-white/10">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-bold">Status updates</div>
              <p className="mt-1 text-sm text-neutral-500">Webhook is optional and independent from the authorization experience.</p>
            </div>
            <label className="flex whitespace-nowrap items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={webhookEnabled} onChange={(event) => setWebhookEnabled(event.target.checked)} />Webhook
            </label>
          </div>
          {webhookEnabled && <label className="mt-4 block text-sm font-semibold">Webhook URL
            <input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://example.com/webhooks/multisig-tools" className="mt-2 w-full rounded-xl border border-black/10 bg-transparent px-3 py-3 font-mono text-sm hover:border-black/20 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-white/10 dark:hover:border-white/20" />
          </label>}
        </div>
      </div>}

      {step === 4 && <div className="space-y-5">
        <div>
          <h3 className="text-lg font-bold">Review Integration Profile</h3>
          <p className="mt-1 text-sm text-neutral-500">Creating the profile will issue the MSI credential once. Runtime signer authority still comes from Stellar.</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <ReviewBlock title="Identity">
            <ReviewRow label="Service" value={label || '—'} />
            <ReviewRow label="ID" value={serviceId.trim().toLowerCase() || '—'} mono />
            <ReviewRow label="Network" value={network === 'public' ? 'Mainnet' : 'Testnet'} />
          </ReviewBlock>
          <ReviewBlock title="Integration">
            <ReviewRow label="Authorization" value={authorizationExperience === 'hosted' ? 'MST-hosted' : authorizationExperience === 'native' ? 'Keep users on my site' : 'Full Headless'} />
            <ReviewRow label="Webhook" value={webhookEnabled ? webhookUrl.trim() : 'Off'} mono={webhookEnabled} />
          </ReviewBlock>
          <ReviewBlock title="Classic">
            {treasuries.length === 0 ? <p className="text-sm text-neutral-500">No Treasury scope.</p> : treasuries.map((item) => <ReviewRow key={item.accountId} label={compactAddress(item.accountId)} value={ownerLabel(item.executionOwner)} mono />)}
          </ReviewBlock>
          <ReviewBlock title="Soroban">
            {contracts.filter((item) => item.selectedMethods.length > 0).length === 0
              ? <p className="text-sm text-neutral-500">No contract scope.</p>
              : contracts.filter((item) => item.selectedMethods.length > 0).map((item) => <div key={item.contractId} className="border-b border-black/5 py-2 last:border-0 dark:border-white/5">
                  <div className="font-mono text-xs break-all">{item.contractId}</div>
                  <div className="mt-1 text-sm">{item.selectedMethods.join(', ')}</div>
                </div>)}
            {contracts.length > 0 && <div className="mt-3 text-sm text-neutral-500">
              Execution: {sorobanExecutionOwner === 'multisigtools' ? 'MultiSigTools' : compactAddress(sorobanExecutor)}
            </div>}
          </ReviewBlock>
        </div>

        {!hasBusinessScope && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">Add at least one Classic Treasury or one allowed contract method.</div>}

        <button type="button" disabled={!readyToCreate || creating} onClick={() => void create()} className="inline-flex whitespace-nowrap items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800 active:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40">
          {creating ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <ShieldCheck className="h-4 w-4" />}Create profile & issue MSI
        </button>
      </div>}
    </div>

    <div className="flex items-center justify-between border-t border-black/10 p-5 dark:border-white/10">
      <button type="button" disabled={step === 0 || creating} onClick={() => { setError(''); setStep((current) => Math.max(0, current - 1)); }} className="inline-flex whitespace-nowrap items-center gap-2 rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold hover:bg-black/[0.03] active:bg-black/[0.05] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/[0.04] dark:active:bg-white/[0.07]">
        <ArrowLeft className="h-4 w-4" />Back
      </button>
      {step < STEPS.length - 1 && <button type="button" disabled={creating} onClick={next} className="inline-flex whitespace-nowrap items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 active:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40">
        Continue<ArrowRight className="h-4 w-4" />
      </button>}
    </div>
  </section>;
}

function ChoiceCard({ selected, disabled = false, onClick, title, description }: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  description: string;
}) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`min-w-0 rounded-2xl border p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 hover:bg-black/[0.03] active:bg-black/[0.05] disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.04] dark:active:bg-white/[0.07] ${selected ? 'border-emerald-500/60 bg-emerald-500/[0.07]' : 'border-black/10 dark:border-white/10'}`}>
    <div className="flex items-start gap-3">
      {selected ? <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-300" /> : <CircleDot className="mt-0.5 h-5 w-5 shrink-0 text-neutral-400" />}
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        <span className="mt-1 block text-sm text-neutral-500">{description}</span>
      </span>
    </div>
  </button>;
}

function SmallChoice({ selected, onClick, title }: { selected: boolean; onClick: () => void; title: string }) {
  return <button type="button" onClick={onClick} className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold hover:bg-black/[0.03] active:bg-black/[0.05] focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-white/[0.04] dark:active:bg-white/[0.07] ${selected ? 'border-emerald-500/60 bg-emerald-500/[0.07]' : 'border-black/10 dark:border-white/10'}`}>
    {selected ? <Check className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" /> : <CircleDot className="h-4 w-4 shrink-0 text-neutral-400" />}
    <span>{title}</span>
  </button>;
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return <div className="flex items-center gap-3 rounded-2xl border border-dashed border-black/15 p-4 text-sm text-neutral-500 dark:border-white/15">
    {icon}<span>{text}</span>
  </div>;
}

function ReviewBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
    <h4 className="font-bold">{title}</h4>
    <div className="mt-3">{children}</div>
  </section>;
}

function ReviewRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="flex min-w-0 items-start justify-between gap-4 border-b border-black/5 py-2 text-sm last:border-0 dark:border-white/5">
    <span className={mono ? 'min-w-0 truncate font-mono text-xs' : 'text-neutral-500'} title={label}>{label}</span>
    <span className={mono ? 'max-w-[62%] break-all text-right font-mono text-xs' : 'text-right font-medium'}>{value}</span>
  </div>;
}
