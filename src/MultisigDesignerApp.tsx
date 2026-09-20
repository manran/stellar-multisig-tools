import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, LoaderCircle, ShieldCheck } from 'lucide-react';
import ExistingMultisigPolicyEditor from './ExistingMultisigPolicyEditor';
import { NetworkBadge, WorkflowProgress } from './MultiSigUi';
import SignerIdentityList from './SignerIdentityList';
import SigningAccountPicker from './SigningAccountPicker';
import StellarWorkspaceShell from './StellarWorkspaceShell';
import { useStellarWallet } from './StellarWalletContext';
import { analyzeAccountAuthorization } from './stellar/authorization';
import { accountSigningIntentForRoute } from './stellar/accountSigningFlow';
import type { AccountSigningIntent } from './stellar/accountSigningFlow';
import { humanAuthorizationRequirement } from './stellar/authorizationPresentation';
import { normalizeDesignerQuorums } from './stellar/designerUi';
import { isValidStellarAccountId, loadAccount, loadNetworkParameters } from './stellar/horizon';
import type { StellarNetworkParameters } from './stellar/horizon';
import { assessExistingMultisigSource, assessSetupSource, designExactMultisigPolicy } from './stellar/multisigDesigner';
import { resolveStellarNetwork } from './stellar/networkPreference';
import { writeReviewHandoff } from './stellar/reviewHandoff';
import { analyzeSignerInputs } from './stellar/signerInputs';
import { buildMultisigSetupXdr, validateDesignerSignerKeys } from './stellar/multisigSetupXdr';
import { assessMultisigReserve, stroopsToXlm } from './stellar/reserve';
import { getDefaultTransactionLifetime } from './stellar/transactionPreferences';
import type { StellarAccountSnapshot, StellarNetwork } from './stellar/types';
import { treasurySigningBackHrefForLocation } from './treasuryNavigation';
import { navigateWorkspace, stellarHref, stellarHrefWithSearch } from './workspaceNavigation';

type DesignerStep = 'signers' | 'approvals' | 'review';

function shortKey(key: string) { return key.length <= 28 ? key : `${key.slice(0, 14)}…${key.slice(-10)}`; }

function StepBar({ step, onStep }: { step: DesignerStep; onStep: (step: DesignerStep) => void }) {
  const steps: Array<{ id: DesignerStep; label: string }> = [{ id: 'signers', label: 'Signers' }, { id: 'approvals', label: 'Approval rules' }, { id: 'review', label: 'Check policy' }];
  const activeIndex = steps.findIndex((item) => item.id === step);
  return <div className="mb-5 flex items-center gap-2 text-xs font-semibold text-neutral-400">{steps.map((item, index) => <div key={item.id} className="flex min-w-0 items-center gap-2">{index > 0 && <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-35" />}<button type="button" onClick={() => index <= activeIndex && onStep(item.id)} className={index === activeIndex ? 'text-neutral-900 dark:text-white' : index < activeIndex ? 'text-emerald-700 dark:text-emerald-300' : ''}>{item.label}</button></div>)}</div>;
}

export default function MultisigDesignerApp() {
  const { network: walletNetwork } = useStellarWallet();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialNetwork = resolveStellarNetwork(params.get('network'), walletNetwork);
  const initialAccount = params.get('account') ?? '';
  const createTreasuryIntent = params.get('intent') === 'create-treasury';
  const accountSigningIntent: AccountSigningIntent = createTreasuryIntent
    ? 'treasury'
    : accountSigningIntentForRoute(window.location.pathname, params.get('intent'), params.get('mode'));
  const [network] = useState<StellarNetwork>(initialNetwork);
  const [accountId, setAccountId] = useState(initialAccount);
  const [account, setAccount] = useState<StellarAccountSnapshot | null>(null);
  const [accountPickerOpen, setAccountPickerOpen] = useState(!initialAccount);
  const [networkParameters, setNetworkParameters] = useState<StellarNetworkParameters | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [signerInputs, setSignerInputs] = useState<string[]>(['']);
  const [keepMaster, setKeepMaster] = useState(true);
  const [paymentQuorum, setPaymentQuorum] = useState(2);
  const [adminQuorum, setAdminQuorum] = useState(2);
  const [transactionLifetimeSeconds] = useState(() => getDefaultTransactionLifetime(localStorage));
  const [step, setStep] = useState<DesignerStep>('signers');
  const initialAccountLoadStarted = useRef(false);

  const signerInputState = useMemo(() => analyzeSignerInputs(signerInputs, account?.accountId ?? ''), [signerInputs, account?.accountId]);
  const signerKeys = signerInputState.signerKeys;
  const signerErrors = signerInputState.errors;
  const signerError = signerErrors.find(Boolean) ?? '';
  const participantCount = signerKeys.length + (keepMaster ? 1 : 0);
  const sourceAssessment = useMemo(() => account ? assessSetupSource(account) : null, [account]);
  const existingAssessment = useMemo(() => account ? assessExistingMultisigSource(account) : null, [account]);
  const designState = useMemo(() => {
    if (!account || signerError || participantCount < 2) return { design: null, error: '' };
    try { return { design: designExactMultisigPolicy(account, { additionalSignerKeys: signerKeys, keepMaster, paymentQuorum, adminQuorum }), error: '' }; }
    catch (cause) { return { design: null, error: cause instanceof Error ? cause.message : 'Unable to build this multisig policy.' }; }
  }, [account, signerError, participantCount, signerKeys, keepMaster, paymentQuorum, adminQuorum]);
  const targetAnalysis = useMemo(() => designState.design ? analyzeAccountAuthorization(designState.design.targetAccount) : null, [designState.design]);
  const reservePreflight = useMemo(() => {
    if (!account || !designState.design || !networkParameters) return null;
    try { return assessMultisigReserve(account, designState.design.reserveSubentriesAdded, networkParameters.baseReserveInStroops, networkParameters.baseFeeInStroops); }
    catch { return null; }
  }, [account, designState.design, networkParameters]);
  const returnAccountId = account?.accountId ?? accountId.trim();
  const backHref = accountSigningIntent === 'treasury'
    ? treasurySigningBackHrefForLocation(
        window.location.href,
        returnAccountId,
        network,
        createTreasuryIntent ? 'create-treasury' : undefined,
      )
    : stellarHrefWithSearch('/account/signing', {
        mode: accountSigningIntent === 'offline' ? 'offline' : null,
        network,
      });
  const backLabel = accountSigningIntent === 'treasury' ? 'Treasury' : 'Account signing';
  const requestReturnLabel = accountSigningIntent === 'treasury'
    ? createTreasuryIntent ? 'Back to Treasuries' : 'Back to Treasury'
    : 'Back to Account signing';
  const canConfigure = Boolean(sourceAssessment?.supported);
  const signerStepValid = Boolean(canConfigure && !signerError && participantCount >= 2);
  const approvalStepValid = Boolean(signerStepValid && designState.design && !designState.error);
  const canContinue = Boolean(approvalStepValid && reservePreflight?.sufficient);

  function resetPolicy() { setSignerInputs(['']); setKeepMaster(true); setPaymentQuorum(2); setAdminQuorum(2); setStep('signers'); }
  async function loadSelectedAccount(targetAccount: string, targetNetwork: StellarNetwork, shouldResetPolicy: boolean) {
    if (!targetAccount.trim()) return;
    setLoading(true); setError('');
    try {
      const [loaded, parameters] = await Promise.all([loadAccount(targetAccount.trim(), targetNetwork), loadNetworkParameters(targetNetwork)]);
      if (shouldResetPolicy) resetPolicy();
      setAccount(loaded); setNetworkParameters(parameters); setAccountId(loaded.accountId); setAccountPickerOpen(false);
      const url = new URL(window.location.href); url.searchParams.set('account', loaded.accountId); url.searchParams.set('network', targetNetwork); window.history.replaceState({}, '', url);
    } catch (cause) { setAccount(null); setNetworkParameters(null); setError(cause instanceof Error ? cause.message : 'Unable to load this account.'); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    if (!initialAccount || initialAccountLoadStarted.current) return;
    initialAccountLoadStarted.current = true;
    void loadSelectedAccount(initialAccount, initialNetwork, true);
  }, []);
  function inspect(event: FormEvent) { event.preventDefault(); void loadSelectedAccount(accountId, network, true); }
  function normalizeForParticipants(nextParticipantCount: number) { if (nextParticipantCount < 2) return; const normalized = normalizeDesignerQuorums(nextParticipantCount, paymentQuorum, adminQuorum); setPaymentQuorum(normalized.payment); setAdminQuorum(normalized.admin); }
  function changeSignerInputs(next: string[]) { setSignerInputs(next); normalizeForParticipants(analyzeSignerInputs(next, account?.accountId ?? '').signerKeys.length + (keepMaster ? 1 : 0)); }
  function setMasterParticipation(checked: boolean) { const nextParticipantCount = signerKeys.length + (checked ? 1 : 0); if (nextParticipantCount >= 2) { const normalized = normalizeDesignerQuorums(nextParticipantCount, paymentQuorum, adminQuorum); setPaymentQuorum(normalized.payment); setAdminQuorum(normalized.admin); } setKeepMaster(checked); }
  function setPaymentApprovals(value: number) { const normalized = normalizeDesignerQuorums(participantCount, value, Math.max(adminQuorum, value)); setPaymentQuorum(normalized.payment); setAdminQuorum(normalized.admin); }
  function setAdminApprovals(value: number) { const normalized = normalizeDesignerQuorums(participantCount, paymentQuorum, value); setPaymentQuorum(normalized.payment); setAdminQuorum(normalized.admin); }

  async function continueToReview() {
    if (!account || !sourceAssessment?.supported || !designState.design) return;
    setGenerating(true); setError('');
    try {
      validateDesignerSignerKeys(signerKeys);
      const [freshAccount, freshParameters] = await Promise.all([loadAccount(account.accountId, network), loadNetworkParameters(network)]);
      const freshAssessment = assessSetupSource(freshAccount); if (!freshAssessment.supported) throw new Error(freshAssessment.reasons.join(' '));
      const normalized = normalizeDesignerQuorums(participantCount, paymentQuorum, adminQuorum);
      const freshDesign = designExactMultisigPolicy(freshAccount, { additionalSignerKeys: signerKeys, keepMaster, paymentQuorum: normalized.payment, adminQuorum: normalized.admin });
      const freshReserve = assessMultisigReserve(freshAccount, freshDesign.reserveSubentriesAdded, freshParameters.baseReserveInStroops, freshParameters.baseFeeInStroops);
      if (!freshReserve.sufficient) throw new Error(`Add at least ${stroopsToXlm(freshReserve.shortfallStroops)} XLM before continuing.`);
      const xdr = buildMultisigSetupXdr(freshAccount, network, freshDesign, freshParameters.baseFeeInStroops, transactionLifetimeSeconds);
      writeReviewHandoff(sessionStorage, {
        xdr,
        network,
        createTreasuryAccountId: createTreasuryIntent ? freshAccount.accountId : null,
        accountSigningIntent,
      });
      navigateWorkspace('/signing-room', {
        state: {
          requestReturnTo: backHref,
          requestReturnLabel,
        },
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to prepare this multisig setup.'); setGenerating(false); }
  }

  const currentAuthorization = useMemo(() => account ? analyzeAccountAuthorization(account) : null, [account]);
  const statusLabel = sourceAssessment?.supported
    ? 'Single-signature account'
    : existingAssessment?.supported && currentAuthorization
      ? humanAuthorizationRequirement(currentAuthorization.thresholds.medium)
      : account ? 'Advanced signing policy' : '';

  return <StellarWorkspaceShell active={accountSigningIntent === 'treasury' ? 'treasury' : 'detail'} networkContext={network}><main className="px-4 py-8 sm:px-6 lg:px-8 lg:py-10"><div className="mx-auto max-w-5xl">
    <div className="mb-6"><WorkflowProgress current="prepare" /></div>
    <a href={backHref} className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-600 hover:text-black dark:text-neutral-300 dark:hover:text-white"><ArrowLeft className="h-4 w-4" />{backLabel}</a>
    <section className="mt-5 max-w-3xl"><div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{createTreasuryIntent ? 'Create a treasury' : accountSigningIntent === 'offline' ? 'Set up multisig offline' : accountSigningIntent === 'standalone' ? (existingAssessment?.existing ? 'Change multisig' : 'Set up multisig') : 'Change account signing'}</h1><NetworkBadge network={network} /></div><p className="mt-2 text-base leading-7 text-neutral-600 dark:text-neutral-300">{createTreasuryIntent ? 'Add shared control to this account, then review the exact Stellar account-change transaction before signing.' : accountSigningIntent === 'offline' ? 'Configure the account signing policy here, then review and export the exact transaction for an authorized signer.' : accountSigningIntent === 'standalone' ? 'Choose the signers and approval rules for this account. Review decides whether this wallet can continue to signing or should export XDR for another signer.' : 'Choose who can approve transactions and how many approvals the account should require. The exact change is reviewed before anything is signed.'}</p></section>

    {account && <section className="mst-designer-account-summary mt-6 max-w-3xl"><div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">Account</span><NetworkBadge network={network} /><span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">{statusLabel}</span></div><div className="mt-1 break-all font-mono text-xs text-neutral-600 dark:text-neutral-300">{account.accountId}</div></div><button type="button" onClick={() => setAccountPickerOpen((open) => !open)} className="text-sm font-semibold text-neutral-600 hover:text-black dark:text-neutral-300 dark:hover:text-white">{accountPickerOpen ? 'Hide account picker' : 'Use another account'}</button></div></section>}

    {(!account || accountPickerOpen) && <form onSubmit={inspect} className="mst-designer-account-picker mt-4 max-w-3xl"><div className="flex flex-wrap items-end gap-4"><div className="min-w-[18rem] flex-1"><SigningAccountPicker id="designer-account" label="Account" network={network} value={accountId} onChange={setAccountId} disabled={loading || generating} placeholder="G... account to configure" /></div><button disabled={loading || !isValidStellarAccountId(accountId)} className="mst-action-primary disabled:opacity-40">{loading && <LoaderCircle className="h-4 w-4 animate-spin" />}Load</button></div></form>}

    {error && <div className="mt-4 max-w-3xl flex gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm"><CircleAlert className="h-5 w-5 shrink-0 text-red-500" />{error}</div>}

    {account && !sourceAssessment?.supported && !existingAssessment?.supported && <section className="mt-6 max-w-3xl rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-5 text-sm"><div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" /><div><div className="font-semibold">Guided changes are not available for this advanced signing policy.</div><div className="mt-2 space-y-1 text-neutral-600 dark:text-neutral-300">{[...(sourceAssessment?.reasons ?? []), ...(existingAssessment?.reasons ?? [])].filter((reason, index, all) => all.indexOf(reason) === index).map((reason) => <div key={reason}>{reason}</div>)}</div><a href={stellarHref('/new/import')} className="mt-4 inline-flex font-semibold text-amber-800 dark:text-amber-200">Use technical transaction import instead</a></div></div></section>}

    {account && existingAssessment?.existing && existingAssessment.supported && networkParameters && <div className="mt-6"><ExistingMultisigPolicyEditor key={`${network}:${account.accountId}:${account.sequence}`} account={account} network={network} networkParameters={networkParameters} accountSigningIntent={accountSigningIntent} requestReturnTo={backHref} requestReturnLabel={requestReturnLabel} /></div>}

    {account && sourceAssessment?.supported && <div className="mt-6 max-w-3xl"><StepBar step={step} onStep={setStep} />
      {step === 'signers' && <section className="mst-designer-step"><h2 className="text-xl font-bold">Who should control this account?</h2><p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Add the people or wallets that should approve transactions.</p><div className="mst-designer-current-key mt-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-sm font-semibold">Current account key</div><div className="mt-1 font-mono text-xs opacity-55">{shortKey(account.accountId)}</div></div><label className="flex cursor-pointer items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={keepMaster} onChange={(event) => setMasterParticipation(event.target.checked)} />Keep as signer</label></div></div><SignerIdentityList values={signerInputs} errors={signerErrors} masterAccountId={account.accountId} onChange={changeSignerInputs} />{!signerError && participantCount < 2 && <div className="mt-3 text-sm text-amber-700 dark:text-amber-300">{keepMaster ? 'Add at least one other signer.' : 'Add at least two signers if the current account key will be removed.'}</div>}<div className="mst-designer-step-actions mt-6"><button type="button" disabled={!signerStepValid} onClick={() => setStep('approvals')} className="mst-action-primary disabled:opacity-40">Continue <ArrowRight className="h-4 w-4" /></button></div></section>}
      {step === 'approvals' && <section className="mst-designer-step"><h2 className="text-xl font-bold">How many approvals should be required?</h2><p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Account-control changes cannot require fewer approvals than normal payments in this guided setup.</p><div className="mst-designer-approval-grid mt-5"><label className="mst-designer-approval-cell"><div className="text-sm font-semibold">Standard transactions</div><select value={paymentQuorum} onChange={(event) => setPaymentApprovals(Number(event.target.value))} className="mst-designer-control mt-3 w-full text-lg font-bold">{Array.from({ length: participantCount }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count} of {participantCount}</option>)}</select></label><label className="mst-designer-approval-cell"><div className="text-sm font-semibold">Core account control</div><select value={adminQuorum} onChange={(event) => setAdminApprovals(Number(event.target.value))} className="mst-designer-control mt-3 w-full text-lg font-bold">{Array.from({ length: participantCount - paymentQuorum + 1 }, (_, index) => paymentQuorum + index).map((count) => <option key={count} value={count}>{count} of {participantCount}</option>)}</select></label></div>{designState.error && <div className="mt-3 flex gap-2 text-sm text-amber-700 dark:text-amber-300"><AlertTriangle className="h-4 w-4" />{designState.error}</div>}<div className="mst-designer-step-actions mst-designer-step-actions--split mt-6"><button type="button" onClick={() => setStep('signers')} className="mst-action-secondary">Back</button><button type="button" disabled={!approvalStepValid} onClick={() => setStep('review')} className="mst-action-primary disabled:opacity-40">Check policy <ArrowRight className="h-4 w-4" /></button></div></section>}
      {step === 'review' && <section className="mst-designer-step">{designState.design && targetAnalysis ? <><h2 className="text-xl font-bold">{accountSigningIntent === 'treasury' ? 'Check the treasury signing policy' : 'Check the signing policy'}</h2><div className="mst-designer-review-grid mt-5"><div className="mst-designer-review-cell"><div className="text-xs opacity-50">Payments</div><div className="mt-1 text-xl font-bold">{humanAuthorizationRequirement(targetAnalysis.thresholds.medium)}</div></div><div className="mst-designer-review-cell"><div className="text-xs opacity-50">Core account control</div><div className="mt-1 text-xl font-bold">{humanAuthorizationRequirement(targetAnalysis.thresholds.high)}</div></div><div className="mst-designer-review-cell"><div className="text-xs opacity-50">Signers</div><div className="mt-1 text-xl font-bold">{designState.design.participantCount}</div></div></div>{reservePreflight && <div className={`mt-5 flex gap-3 rounded-xl p-4 text-sm ${reservePreflight.sufficient ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>{reservePreflight.sufficient ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />}<div><div className="font-semibold">{reservePreflight.sufficient ? 'Account balance is sufficient.' : `Add at least ${stroopsToXlm(reservePreflight.shortfallStroops)} XLM before continuing.`}</div><div className="mt-1 opacity-55">Stellar reserve and network fees are checked again immediately before the transaction is created.</div></div></div>}<button type="button" onClick={() => void continueToReview()} disabled={generating || !canContinue} className="mst-action-primary mst-designer-review-action mt-6 disabled:opacity-40">{generating && <LoaderCircle className="h-4 w-4 animate-spin" />}{generating ? 'Preparing review...' : <>Create transaction & review <ArrowRight className="h-4 w-4" /></>}</button><p className="mt-2 text-center text-xs opacity-45">Nothing is sent to Stellar until the transaction is reviewed, signed, and submitted.</p><details className="mt-6 border-t border-black/10 pt-5 dark:border-white/10"><summary className="cursor-pointer text-sm font-semibold">Technical Stellar details</summary><div className="mt-4 space-y-3">{designState.design.setupSteps.map((item, index) => <div key={`${item.kind}-${item.signerKey ?? index}`} className="flex gap-3"><div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black text-xs font-bold text-white dark:bg-white dark:text-black">{index + 1}</div><div><div className="text-sm font-semibold">{item.title}</div><div className="mt-1 text-xs leading-5 opacity-55">{item.detail}</div></div></div>)}<div className="rounded-xl bg-black/[0.035] p-4 text-xs dark:bg-white/[0.04]"><div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><div>low / medium / high = {designState.design.thresholds.low} / {designState.design.thresholds.medium} / {designState.design.thresholds.high}; current account key weight = {designState.design.masterWeight}.</div></div></div></div></details></> : <div className="text-sm text-neutral-500">Complete the previous steps first.</div>}<div className="mt-5"><button type="button" onClick={() => setStep('approvals')} className="mst-action-secondary">Back</button></div></section>}
    </div>}
  </div></main></StellarWorkspaceShell>;
}
