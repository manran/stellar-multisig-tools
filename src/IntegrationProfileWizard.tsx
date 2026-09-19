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
  executionOwner: ExecutionOwner;
  executor?: string;
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
  const [executorInput, setExecutorInput] = useState('');
  const [executorPool, setExecutorPool] = useState<string[]>([]);

  const [authorizationExperience, setAuthorizationExperience] = useState<AuthorizationExperience>('hosted');
  const [manageExecution, setManageExecution] = useState(false);
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
  const contractExecutionValid = !manageExecution || contracts.every((item) => (
    item.executionOwner === 'multisigtools'
    || Boolean(item.executor && executorPool.includes(item.executor) && isValidStellarAccountId(item.executor))
  ));
  const webhookValid = !webhookEnabled || /^https:\/\//i.test(webhookUrl.trim());
  const basicsValid = Boolean(serviceId.trim() && label.trim());
  const readyToCreate = basicsValid && hasBusinessScope && contractExecutionValid && webhookValid;

  function resetNetwork(next: StellarNetwork) {
    if (next === network) return;
    setNetwork(next);
    setTreasuries([]);
    setContracts([]);
    setExecutorPool([]);
    setManageExecution(false);
    setTreasuryInput('');
    setContractInput('');
    setExecutorInput('');
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
        executionOwner: 'multisigtools',
      }]);
      setContractInput('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to inspect this contract.');
    } finally {
      setContractBusy(false);
    }
  }

  function setExecutionManagement(enabled: boolean) {
    setManageExecution(enabled);
    if (enabled) return;
    setTreasuries((current) => current.map((item) => ({ ...item, executionOwner: 'multisigtools' })));
    setContracts((current) => current.map((item) => ({
      ...item,
      executionOwner: 'multisigtools',
      executor: undefined,
    })));
    setExecutorPool([]);
    setExecutorInput('');
    setError('');
  }

  function setTreasuryExecution(accountId: string, executionOwner: ExecutionOwner) {
    setTreasuries((current) => current.map((item) => (
      item.accountId === accountId ? { ...item, executionOwner } : item
    )));
  }

  function addExecutor() {
    const executor = executorInput.trim();
    if (!isValidStellarAccountId(executor)) {
      setError('Enter a valid Stellar G... executor account.');
      return;
    }
    if (executorPool.includes(executor)) {
      setError('This executor is already in the pool.');
      return;
    }
    setExecutorPool((current) => [...current, executor]);
    setExecutorInput('');
    setError('');
  }

  function removeExecutor(executor: string) {
    if (contracts.some((item) => item.executionOwner === 'integration' && item.executor === executor)) {
      setError('This executor is still assigned to a contract. Reassign that contract first.');
      return;
    }
    setExecutorPool((current) => current.filter((item) => item !== executor));
    setError('');
  }

  function setContractExecutor(contractId: string, value: string) {
    setContracts((current) => current.map((item) => {
      if (item.contractId !== contractId) return item;
      if (value === 'multisigtools') return { ...item, executionOwner: 'multisigtools', executor: undefined };
      return { ...item, executionOwner: 'integration', executor: value };
    }));
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
    if (step === 3 && !contractExecutionValid) {
      setError('Each externally executed contract must use one executor from the global pool.');
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
        treasuries: treasuries.map((item) => ({
          accountId: item.accountId,
          executionOwner: manageExecution ? item.executionOwner : 'multisigtools',
        })),
        contracts: contracts.map((item) => ({
          contractId: item.contractId,
          methods: item.selectedMethods,
          executionOwner: manageExecution ? item.executionOwner : 'multisigtools',
          ...(manageExecution && item.executor ? { executor: item.executor } : {}),
        })),
        executorPool: manageExecution ? executorPool : [],
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

  return <section className="ia-wizard">
    <div className="ia-wizard__header">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="ia-kicker">New Integration</div>
          <h2 className="ia-workspace__title">Define the profile before issuing a credential</h2>
          <p className="ia-muted mt-2 max-w-3xl text-sm">
            Scope the accounts and contracts first. The MSI credential is generated only after review.
          </p>
        </div>
        <button type="button" onClick={onCancel} className="ia-action">
          Cancel
        </button>
      </div>

      <div className="ia-wizard__steps" aria-label="Integration setup steps">
        {STEPS.map((item, index) => <button
          key={item}
          type="button"
          onClick={() => index <= step && setStep(index)}
          disabled={index > step}
          data-active={index === step}
          className="ia-step"
        >
          {index + 1}. {item}
        </button>)}
      </div>
    </div>

    {error && <div className="mt-4 border-y border-red-500/30 bg-red-500/[0.06] px-1 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>}

    <div className="ia-wizard__stage">
      {step === 0 && <div className="max-w-3xl space-y-5">
        <div>
          <h3 className="text-lg font-bold">Identity and network</h3>
          <p className="mt-1 text-sm text-neutral-500">The guided flow uses one network per profile. Expert configuration can expand this later.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold">Service id
            <input value={serviceId} onChange={(event) => setServiceId(event.target.value)} placeholder="fednetwork" className="ia-input mt-2 font-mono text-sm" />
          </label>
          <label className="text-sm font-semibold">Display name
            <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="FedNetwork" className="ia-input mt-2 text-sm" />
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
          <input value={treasuryInput} onChange={(event) => setTreasuryInput(event.target.value)} placeholder="G..." className="ia-input min-w-0 flex-1 font-mono text-sm" />
          <button type="button" disabled={treasuryBusy || !treasuryInput.trim()} onClick={() => void addTreasury()} className="ia-action">
            {treasuryBusy ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Plus className="h-4 w-4" />}Inspect Treasury
          </button>
        </div>

        {treasuries.length === 0
          ? <EmptyState icon={<WalletCards className="h-5 w-5" />} text="No Classic Treasury added. You can create a Soroban-only Integration." />
          : <div>{treasuries.map((item) => <article key={item.accountId} className="ia-subframe">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-sm font-semibold break-all">{item.accountId}</div>
                  <div className="mt-1 text-sm text-neutral-500">
                    Low {item.analysis.thresholds.low.policyLabel} · Medium {item.analysis.thresholds.medium.policyLabel} · High {item.analysis.thresholds.high.policyLabel}
                  </div>
                </div>
                <button type="button" onClick={() => setTreasuries((current) => current.filter((entry) => entry.accountId !== item.accountId))} className="ia-action ia-action--danger text-xs">
                  <Trash2 className="h-3.5 w-3.5" />Remove
                </button>
              </div>

              <div className="mt-4">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">Current signers</div>
                <div className="mt-2 divide-y divide-black/5 rounded-xl border border-black/10 dark:divide-white/5 dark:border-white/10">
                  {item.snapshot.signers.filter((signer) => signer.weight > 0).map((signer) => <div key={signer.key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate font-mono" title={signer.key}>{compactAddress(signer.key)}</span>
                    <span className="whitespace-nowrap text-neutral-500">weight {signer.weight}</span>
                  </div>)}
                </div>
              </div>
            </article>)}</div>}
      </div>}

      {step === 2 && <div className="space-y-5">
        <div>
          <h3 className="text-lg font-bold">Soroban contracts</h3>
          <p className="mt-1 text-sm text-neutral-500">Inspect deployed ABI and choose the methods this Integration may use. MultiSigTools handles execution by default.</p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={contractInput} onChange={(event) => setContractInput(event.target.value)} placeholder="C..." className="ia-input min-w-0 flex-1 font-mono text-sm" />
          <button type="button" disabled={contractBusy || !contractInput.trim()} onClick={() => void addContract()} className="ia-action">
            {contractBusy ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Plus className="h-4 w-4" />}Inspect contract
          </button>
        </div>

        {contracts.length === 0
          ? <EmptyState icon={<Server className="h-5 w-5" />} text="No Soroban contract added. You can create a Classic-only Integration." />
          : <div>{contracts.map((item) => <article key={item.contractId} className="ia-subframe">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-sm font-semibold break-all">{item.contractId}</div>
                  <div className="mt-1 text-sm text-neutral-500">{item.methods.length} methods discovered · {item.selectedMethods.length} allowed</div>
                </div>
                <button type="button" onClick={() => setContracts((current) => current.filter((entry) => entry.contractId !== item.contractId))} className="ia-action ia-action--danger text-xs">
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
      </div>}

      {step === 3 && <div className="max-w-4xl space-y-6">
        <div>
          <h3 className="text-lg font-bold">How deeply do you want to integrate?</h3>
          <p className="mt-1 text-sm text-neutral-500">The Headless Core is the same. This choice controls how much product complexity MST exposes by default.</p>
        </div>
        <div className="grid gap-3">
          <ChoiceCard selected={authorizationExperience === 'hosted'} onClick={() => setAuthorizationExperience('hosted')} title="MST-hosted" description="MultiSigTools handles signer interaction. Lowest integration effort." />
          <ChoiceCard selected={authorizationExperience === 'native'} onClick={() => setAuthorizationExperience('native')} title="On my site" description="Use your own wallet and signing UI while MultiSigTools coordinates and verifies authorization." />
          <ChoiceCard selected={authorizationExperience === 'headless'} onClick={() => setAuthorizationExperience('headless')} title="Full Headless" description="Expose the full supported orchestration, execution and automation surface." />
        </div>

        <div className="border-t border-black/10 pt-5 dark:border-white/10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="font-bold">Execution</div>
              <p className="mt-1 max-w-2xl text-sm text-neutral-500">
                MultiSigTools manages transaction sources, sequence, fees and submission by default.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setExecutionManagement(!manageExecution)}
              className="ia-action"
            >
              {manageExecution ? 'Use MultiSigTools managed' : 'Manage execution myself'}
            </button>
          </div>

          {!manageExecution && <div className="mt-4 flex items-center gap-2 text-sm font-semibold">
            <Check className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
            Managed by MultiSigTools
          </div>}

          {manageExecution && <div className="mt-5 space-y-6">
            {treasuries.length > 0 && <section className="ia-subframe">
              <div className="font-bold">Classic routing</div>
              <p className="mt-1 text-sm text-neutral-500">Choose which Treasury transactions your service will submit itself.</p>
              <div className="mt-3 divide-y divide-black/5 dark:divide-white/5">
                {treasuries.map((item) => <div key={item.accountId} className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
                  <div className="min-w-0">
                    <div className="break-all font-mono text-xs font-semibold">{item.accountId}</div>
                    <div className="mt-1 text-xs text-neutral-500">Signer authority remains the live Stellar account policy.</div>
                  </div>
                  <div>
                    <SmallChoice selected={item.executionOwner === 'multisigtools'} onClick={() => setTreasuryExecution(item.accountId, 'multisigtools')} title="MultiSigTools managed" />
                    <SmallChoice selected={item.executionOwner === 'integration'} onClick={() => setTreasuryExecution(item.accountId, 'integration')} title="My service submits" />
                  </div>
                </div>)}
              </div>
            </section>}

            {contracts.length > 0 && <section className="ia-subframe">
              <div className="font-bold">Soroban executors</div>
              <p className="mt-1 text-sm text-neutral-500">Add reusable server-side execution accounts, then bind only the contracts you want to execute yourself.</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input value={executorInput} onChange={(event) => setExecutorInput(event.target.value)} placeholder="G..." className="ia-input min-w-0 flex-1 font-mono text-sm" />
                <button type="button" disabled={!executorInput.trim()} onClick={addExecutor} className="ia-action">
                  <Plus className="h-4 w-4" />Add executor
                </button>
              </div>
              {executorPool.length > 0 && <div className="ia-pool">
                {executorPool.map((executor) => <div key={executor} className="ia-pool__row">
                  <span className="ia-code" title={executor}>{executor}</span>
                  <button type="button" onClick={() => removeExecutor(executor)} className="ia-action ia-action--danger text-xs">Remove</button>
                </div>)}
              </div>}

              <div className="mt-5 divide-y divide-black/5 dark:divide-white/5">
                {contracts.map((item) => <label key={item.contractId} className="block py-3 text-sm font-semibold">
                  <span className="ia-code block">{item.contractId}</span>
                  <select
                    value={item.executionOwner === 'multisigtools' ? 'multisigtools' : item.executor ?? ''}
                    onChange={(event) => setContractExecutor(item.contractId, event.target.value)}
                    className="ia-select mt-2 text-sm"
                  >
                    <option value="multisigtools">MultiSigTools managed</option>
                    {executorPool.map((executor) => <option key={executor} value={executor}>{compactAddress(executor)}</option>)}
                  </select>
                </label>)}
              </div>
            </section>}
          </div>}
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
            <input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://example.com/webhooks/multisig-tools" className="ia-input mt-2 font-mono text-sm" />
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
            <ReviewRow label="Authorization" value={authorizationExperience === 'hosted' ? 'MST-hosted' : authorizationExperience === 'native' ? 'On my site' : 'Full Headless'} />
            <ReviewRow label="Execution" value={manageExecution ? 'Custom routing' : 'Managed by MultiSigTools'} />
            <ReviewRow label="Webhook" value={webhookEnabled ? webhookUrl.trim() : 'Off'} mono={webhookEnabled} />
          </ReviewBlock>
          <ReviewBlock title="Classic">
            {treasuries.length === 0
              ? <p className="text-sm text-neutral-500">No Treasury scope.</p>
              : treasuries.map((item) => <ReviewRow
                  key={item.accountId}
                  label={compactAddress(item.accountId)}
                  value={manageExecution ? ownerLabel(item.executionOwner) : 'Allowed'}
                  mono
                />)}
          </ReviewBlock>
          <ReviewBlock title="Soroban">
            {contracts.filter((item) => item.selectedMethods.length > 0).length === 0
              ? <p className="text-sm text-neutral-500">No contract scope.</p>
              : contracts.filter((item) => item.selectedMethods.length > 0).map((item) => <div key={item.contractId} className="border-b border-black/5 py-2 last:border-0 dark:border-white/5">
                  <div className="font-mono text-xs break-all">{item.contractId}</div>
                  <div className="mt-1 text-sm">{item.selectedMethods.join(', ')}</div>
                  {manageExecution && <div className="mt-1 text-xs text-neutral-500">
                    Execution: {item.executionOwner === 'multisigtools' ? 'MultiSigTools managed' : compactAddress(item.executor ?? '')}
                  </div>}
                </div>)}
            {manageExecution && executorPool.length > 0 && <div className="mt-3 text-xs text-neutral-500">{executorPool.length} executor{executorPool.length === 1 ? '' : 's'} in global pool.</div>}
          </ReviewBlock>
        </div>

        {!hasBusinessScope && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">Add at least one Classic Treasury or one allowed contract method.</div>}

        <button type="button" disabled={!readyToCreate || creating} onClick={() => void create()} className="ia-action ia-action--primary">
          {creating ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <ShieldCheck className="h-4 w-4" />}Create profile & issue MSI
        </button>
      </div>}
    </div>

    <div className="ia-wizard__footer">
      <button type="button" disabled={step === 0 || creating} onClick={() => { setError(''); setStep((current) => Math.max(0, current - 1)); }} className="ia-action">
        <ArrowLeft className="h-4 w-4" />Back
      </button>
      {step < STEPS.length - 1 && <button type="button" disabled={creating} onClick={next} className="ia-action ia-action--primary">
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
  return <div className="ia-choice-wrap">
    <button type="button" disabled={disabled} data-selected={selected} onClick={onClick} className="ia-choice">
      {selected ? <Check className="ia-choice__mark h-5 w-5 shrink-0" /> : <CircleDot className="ia-choice__mark h-5 w-5 shrink-0" />}
      <span className="ia-choice__title min-w-0">{title}</span>
    </button>
    <span className="ia-choice__description">{description}</span>
  </div>;
}

function SmallChoice({ selected, onClick, title }: { selected: boolean; onClick: () => void; title: string }) {
  return <button type="button" data-selected={selected} onClick={onClick} className="ia-choice py-2 text-sm">
    {selected ? <Check className="ia-choice__mark h-4 w-4 shrink-0" /> : <CircleDot className="ia-choice__mark h-4 w-4 shrink-0" />}
    <span className="font-semibold">{title}</span>
  </button>;
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return <div className="flex items-center gap-3 rounded-2xl border border-dashed border-black/15 p-4 text-sm text-neutral-500 dark:border-white/15">
    {icon}<span>{text}</span>
  </div>;
}

function ReviewBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="ia-profile-section">
    <h4 className="ia-profile-section__title">{title}</h4>
    <div>{children}</div>
  </section>;
}

function ReviewRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="flex min-w-0 items-start justify-between gap-4 border-b border-black/5 py-2 text-sm last:border-0 dark:border-white/5">
    <span className={mono ? 'min-w-0 truncate font-mono text-xs' : 'text-neutral-500'} title={label}>{label}</span>
    <span className={mono ? 'max-w-[62%] break-all text-right font-mono text-xs' : 'text-right font-medium'}>{value}</span>
  </div>;
}
