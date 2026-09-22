import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, LoaderCircle, ShieldAlert } from 'lucide-react';
import SignerIdentityList from './SignerIdentityList';
import { useStellarWallet } from './StellarWalletContext';
import { assessAccountControlPolicyTransition } from './stellar/accountControlReview';
import type { AccountSigningIntent } from './stellar/accountSigningFlow';
import { normalizeDesignerQuorums } from './stellar/designerUi';
import { loadAccount, loadNetworkParameters } from '../packages/stellar-core/src/horizon';
import type { StellarNetworkParameters } from '../packages/stellar-core/src/horizon';
import { assessExistingMultisigSource, designExistingMultisigPolicy } from './stellar/multisigDesigner';
import { writeReviewHandoff } from './stellar/reviewHandoff';
import { analyzeSignerInputs } from './stellar/signerInputs';
import { buildMultisigSetupXdr, validateDesignerSignerKeys } from './stellar/multisigSetupXdr';
import { assessMultisigReserve, stroopsToXlm } from '../packages/stellar-core/src/reserve';
import { getDefaultTransactionLifetime } from '../packages/stellar-core/src/transactionPreferences';
import type { StellarAccountSnapshot, StellarNetwork } from '../packages/stellar-core/src/types';
import { treasuryOverviewHref } from './treasuryNavigation';
import { navigateWorkspace } from './workspaceNavigation';

type ChangeSeverity = 'normal' | 'warning';
type EditStep = 'signers' | 'approvals' | 'review';

interface PolicyChangeSummary {
  key: string;
  title: string;
  detail: string;
  severity: ChangeSeverity;
}

function policyFingerprint(account: StellarAccountSnapshot) {
  const signers = account.signers
    .filter((signer) => signer.weight > 0)
    .map((signer) => `${signer.type}:${signer.key}:${signer.weight}`)
    .sort();
  return JSON.stringify({ thresholds: account.thresholds, signers });
}

function currentAdditionalSigners(account: StellarAccountSnapshot) {
  return account.signers
    .filter((signer) => signer.type === 'ed25519_public_key' && signer.key !== account.accountId && signer.weight > 0)
    .map((signer) => signer.key);
}

function currentMasterIncluded(account: StellarAccountSnapshot) {
  return (account.signers.find((signer) => signer.key === account.accountId)?.weight ?? 0) > 0;
}

function policyChanges(
  account: StellarAccountSnapshot,
  signerKeys: string[],
  keepMaster: boolean,
  paymentQuorum: number,
  adminQuorum: number,
): PolicyChangeSummary[] {
  const currentAdditional = new Set(currentAdditionalSigners(account));
  const targetAdditional = new Set(signerKeys);
  const changes: PolicyChangeSummary[] = [];
  for (const key of currentAdditional) {
    if (!targetAdditional.has(key)) changes.push({ key: `remove:${key}`, title: 'Remove signer', detail: key, severity: 'warning' });
  }
  for (const key of targetAdditional) {
    if (!currentAdditional.has(key)) changes.push({ key: `add:${key}`, title: 'Add signer', detail: key, severity: 'normal' });
  }
  const masterWasIncluded = currentMasterIncluded(account);
  if (masterWasIncluded !== keepMaster) {
    changes.push({
      key: 'master',
      title: keepMaster ? 'Add account key as a signer' : 'Remove account key as a signer',
      detail: keepMaster ? 'Account key: no approval power -> approval power 1' : 'Account key: approval power 1 -> no approval power',
      severity: keepMaster ? 'normal' : 'warning',
    });
  }
  if (account.thresholds.medium !== paymentQuorum) changes.push({ key: 'payment', title: 'Standard transactions', detail: `Approval power ${account.thresholds.medium} -> ${paymentQuorum}`, severity: 'warning' });
  if (account.thresholds.high !== adminQuorum) changes.push({ key: 'admin', title: 'Core account control', detail: `Approval power ${account.thresholds.high} -> ${adminQuorum}`, severity: 'warning' });
  return changes;
}

function shortKey(key: string) {
  return key.length <= 32 ? key : `${key.slice(0, 16)}...${key.slice(-10)}`;
}

function StepBar({ step, onStep }: { step: EditStep; onStep: (step: EditStep) => void }) {
  const steps: Array<{ id: EditStep; label: string }> = [
    { id: 'signers', label: 'Signers' },
    { id: 'approvals', label: 'Approval rules' },
    { id: 'review', label: 'Check changes' },
  ];
  const activeIndex = steps.findIndex((item) => item.id === step);
  return (
    <div className="mb-5 flex items-center gap-2 text-xs font-semibold text-neutral-400">
      {steps.map((item, index) => (
        <div key={item.id} className="flex min-w-0 items-center gap-2">
          {index > 0 && <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-35" />}
          <button type="button" onClick={() => index <= activeIndex && onStep(item.id)} className={index === activeIndex ? 'text-neutral-900 dark:text-white' : index < activeIndex ? 'text-emerald-700 dark:text-emerald-300' : ''}>{item.label}</button>
        </div>
      ))}
    </div>
  );
}

export default function ExistingMultisigPolicyEditor({ account, network, networkParameters, accountSigningIntent = 'treasury', requestReturnTo, requestReturnLabel = 'Back to Treasury' }: { account: StellarAccountSnapshot; network: StellarNetwork; networkParameters: StellarNetworkParameters; accountSigningIntent?: AccountSigningIntent; requestReturnTo?: string; requestReturnLabel?: string }) {
  const { address: walletAddress } = useStellarWallet();
  const initialAdditional = useMemo(() => currentAdditionalSigners(account), [account]);
  const [guardAccepted, setGuardAccepted] = useState(false);
  const [step, setStep] = useState<EditStep>('signers');
  const [signerInputs, setSignerInputs] = useState<string[]>([...initialAdditional, '']);
  const [keepMaster, setKeepMaster] = useState(currentMasterIncluded(account));
  const [paymentQuorum, setPaymentQuorum] = useState(account.thresholds.medium);
  const [adminQuorum, setAdminQuorum] = useState(account.thresholds.high);
  const [transactionLifetimeSeconds] = useState(() => getDefaultTransactionLifetime(localStorage));
  const [acknowledged, setAcknowledged] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const signerInputState = useMemo(() => analyzeSignerInputs(signerInputs, account.accountId), [signerInputs, account.accountId]);
  const signerKeys = signerInputState.signerKeys;
  const signerErrors = signerInputState.errors;
  const signerError = signerErrors.find(Boolean) ?? '';
  const participantCount = signerKeys.length + (keepMaster ? 1 : 0);
  const changes = useMemo(() => policyChanges(account, signerKeys, keepMaster, paymentQuorum, adminQuorum), [account, signerKeys, keepMaster, paymentQuorum, adminQuorum]);
  const targetSignerSet = useMemo(() => new Set([...(keepMaster ? [account.accountId] : []), ...signerKeys]), [keepMaster, account.accountId, signerKeys]);
  const connectedWalletRemoved = Boolean(walletAddress && account.signers.some((signer) => signer.key === walletAddress && signer.weight > 0) && !targetSignerSet.has(walletAddress));
  const designState = useMemo(() => {
    if (signerError || participantCount < 2) return { design: null, error: '' };
    try {
      return { design: designExistingMultisigPolicy(account, { additionalSignerKeys: signerKeys, keepMaster, paymentQuorum, adminQuorum }), error: '' };
    } catch (cause) {
      return { design: null, error: cause instanceof Error ? cause.message : 'Unable to build this signing-policy change.' };
    }
  }, [account, signerError, participantCount, signerKeys, keepMaster, paymentQuorum, adminQuorum]);
  const reservePreflight = useMemo(() => {
    if (!designState.design) return null;
    try {
      return assessMultisigReserve(account, designState.design.reserveSubentriesAdded, networkParameters.baseReserveInStroops, networkParameters.baseFeeInStroops, designState.design.operationCount);
    } catch {
      return null;
    }
  }, [account, designState.design, networkParameters]);
  const policyRisks = useMemo(() => {
    if (!designState.design) return [];
    const masterSigner = account.signers.find((signer) => signer.key === account.accountId);
    const targetAccount: StellarAccountSnapshot = {
      ...account,
      thresholds: { ...designState.design.thresholds },
      signers: [
        {
          key: account.accountId,
          type: masterSigner?.type ?? 'ed25519_public_key',
          weight: designState.design.masterWeight,
          ...(masterSigner?.sponsor ? { sponsor: masterSigner.sponsor } : {}),
        },
        ...signerKeys.map((key) => ({ key, type: 'ed25519_public_key', weight: 1 })),
      ],
    };
    return assessAccountControlPolicyTransition(account, targetAccount);
  }, [account, designState.design, signerKeys]);
  const hasCriticalPolicyRisk = policyRisks.some((risk) => risk.severity === 'critical');
  const signerStepValid = !signerError && participantCount >= 2;
  const approvalStepValid = signerStepValid && Boolean(designState.design) && !designState.error;
  const canCreate = approvalStepValid && Boolean(reservePreflight?.sufficient) && !hasCriticalPolicyRisk && changes.length > 0 && acknowledged;

  function normalizeForParticipants(nextParticipantCount: number) {
    if (nextParticipantCount < 2) return;
    const normalized = normalizeDesignerQuorums(nextParticipantCount, paymentQuorum, adminQuorum);
    setPaymentQuorum(normalized.payment);
    setAdminQuorum(normalized.admin);
  }
  function changeSignerInputs(next: string[]) {
    setAcknowledged(false);
    setSignerInputs(next);
    normalizeForParticipants(analyzeSignerInputs(next, account.accountId).signerKeys.length + (keepMaster ? 1 : 0));
  }
  function changeMaster(checked: boolean) {
    setAcknowledged(false);
    normalizeForParticipants(signerKeys.length + (checked ? 1 : 0));
    setKeepMaster(checked);
  }
  function changePayment(value: number) {
    setAcknowledged(false);
    const normalized = normalizeDesignerQuorums(participantCount, value, Math.max(adminQuorum, value));
    setPaymentQuorum(normalized.payment);
    setAdminQuorum(normalized.admin);
  }
  function changeAdmin(value: number) {
    setAcknowledged(false);
    const normalized = normalizeDesignerQuorums(participantCount, paymentQuorum, value);
    setPaymentQuorum(normalized.payment);
    setAdminQuorum(normalized.admin);
  }

  async function continueToReview() {
    if (!canCreate || !designState.design) return;
    setGenerating(true);
    setError('');
    try {
      validateDesignerSignerKeys(signerKeys);
      const [freshAccount, freshParameters] = await Promise.all([loadAccount(account.accountId, network), loadNetworkParameters(network)]);
      if (policyFingerprint(freshAccount) !== policyFingerprint(account)) throw new Error('The account signing configuration changed since this page was loaded. Reload it before creating a transaction.');
      const assessment = assessExistingMultisigSource(freshAccount);
      if (!assessment.supported) throw new Error(assessment.reasons.join(' '));
      const freshDesign = designExistingMultisigPolicy(freshAccount, { additionalSignerKeys: signerKeys, keepMaster, paymentQuorum, adminQuorum });
      const freshReserve = assessMultisigReserve(freshAccount, freshDesign.reserveSubentriesAdded, freshParameters.baseReserveInStroops, freshParameters.baseFeeInStroops, freshDesign.operationCount);
      if (!freshReserve.sufficient) throw new Error(`Add at least ${stroopsToXlm(freshReserve.shortfallStroops)} XLM before continuing.`);
      const xdr = buildMultisigSetupXdr(freshAccount, network, freshDesign, freshParameters.baseFeeInStroops, transactionLifetimeSeconds);
      writeReviewHandoff(sessionStorage, { xdr, network, accountSigningIntent });
      navigateWorkspace('/signing-room', {
        state: {
          requestReturnTo: requestReturnTo ?? treasuryOverviewHref(account.accountId, network),
          requestReturnLabel,
        },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to prepare this signing-policy change.');
      setGenerating(false);
    }
  }

  if (!guardAccepted) {
    return (
      <section className="max-w-3xl rounded-2xl border border-amber-500/30 bg-amber-500/[0.07] p-5 sm:p-6">
        <div className="flex gap-3"><ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-amber-600 dark:text-amber-300" /><div>
          <h2 className="text-xl font-bold">Change an existing multisig configuration?</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-700 dark:text-neutral-200">This account already has shared control. Changing signers or approval rules changes who can control it and can remove access if configured incorrectly.</p>
          <ul className="mt-4 space-y-2 text-sm text-neutral-600 dark:text-neutral-300"><li>- Removing a signer removes that key's future access.</li><li>- Changing approval rules changes future authorization requirements.</li><li>- Removing the account key as a signer changes recovery and control.</li></ul>
          <button type="button" onClick={() => setGuardAccepted(true)} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-amber-600 px-5 py-3 text-sm font-semibold text-white hover:bg-amber-700">Continue carefully <ArrowRight className="h-4 w-4" /></button>
        </div></div>
      </section>
    );
  }

  return (
    <div className="max-w-3xl">
      <StepBar step={step} onStep={setStep} />
      {error && <div className="mb-4 flex gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

      {step === 'signers' && <section className="mst-designer-step">
        <h2 className="text-xl font-bold">Who should control this account?</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">Current signers are pre-filled. Remove or add only the keys you intend to change.</p>
        <div className="mst-designer-current-key mt-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-sm font-semibold">Account key</div><div className="mt-1 font-mono text-xs opacity-55">{shortKey(account.accountId)}</div></div><label className="flex cursor-pointer items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={keepMaster} onChange={(event) => changeMaster(event.target.checked)} />Keep as signer</label></div></div>
        <SignerIdentityList values={signerInputs} errors={signerErrors} masterAccountId={account.accountId} onChange={changeSignerInputs} />
        {!signerError && participantCount < 2 && <div className="mt-3 text-sm text-amber-700 dark:text-amber-300">Keep at least two active signers in the resulting multisig policy.</div>}
        <div className="mst-designer-step-actions mt-6"><button type="button" disabled={!signerStepValid} onClick={() => setStep('approvals')} className="mst-action-primary disabled:opacity-40">Continue <ArrowRight className="h-4 w-4" /></button></div>
      </section>}

      {step === 'approvals' && <section className="mst-designer-step">
        <h2 className="text-xl font-bold">Set approval rules</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">Choose how many of the resulting {participantCount} signers must approve normal activity and account-control changes.</p>
        <div className="mst-designer-approval-grid mt-5"><label className="mst-designer-approval-cell"><div className="text-sm font-semibold">Standard transactions</div><select value={paymentQuorum} onChange={(event) => changePayment(Number(event.target.value))} className="mst-designer-control mt-3 w-full text-lg font-bold">{Array.from({ length: participantCount }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count} of {participantCount}</option>)}</select></label><label className="mst-designer-approval-cell"><div className="text-sm font-semibold">Core account control</div><select value={adminQuorum} onChange={(event) => changeAdmin(Number(event.target.value))} className="mst-designer-control mt-3 w-full text-lg font-bold">{Array.from({ length: participantCount - paymentQuorum + 1 }, (_, index) => paymentQuorum + index).map((count) => <option key={count} value={count}>{count} of {participantCount}</option>)}</select></label></div>
        {designState.error && <div className="mt-3 flex gap-2 text-sm text-amber-700 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{designState.error}</div>}
        <div className="mst-designer-step-actions mst-designer-step-actions--split mt-6"><button type="button" onClick={() => setStep('signers')} className="mst-action-secondary"><ArrowLeft className="h-4 w-4" />Back</button><button type="button" disabled={!approvalStepValid} onClick={() => { setAcknowledged(false); setStep('review'); }} className="mst-action-primary disabled:opacity-40">Check changes <ArrowRight className="h-4 w-4" /></button></div>
      </section>}

      {step === 'review' && <section className="mst-designer-step">
        <h2 className="text-xl font-bold">Check control changes</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">These are the account-control changes the transaction will make. The account's current signing policy must authorize them.</p>
        <div className="mt-5 space-y-2">{changes.length === 0 ? <div className="rounded-xl bg-black/[0.035] p-4 text-sm text-neutral-500 dark:bg-white/[0.04] dark:text-neutral-400">No control changes have been made.</div> : changes.map((change) => <div key={change.key} className={`rounded-xl border p-4 ${change.severity === 'warning' ? 'border-amber-500/20 bg-amber-500/[0.06]' : 'border-black/10 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.03]'}`}><div className="text-sm font-semibold">{change.title}</div><div className={`mt-1 break-all ${change.detail.startsWith('G') ? 'font-mono text-xs' : 'text-sm'} text-neutral-600 dark:text-neutral-300`}>{change.detail}</div></div>)}</div>
        {policyRisks.map((risk) => <div key={risk.key} className={`mt-4 flex gap-3 rounded-xl border p-4 text-sm ${risk.severity === 'critical' ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300' : 'border-amber-500/25 bg-amber-500/[0.07] text-amber-800 dark:text-amber-200'}`}><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" /><div><div className="font-semibold">{risk.title}</div><div className="mt-1 leading-6">{risk.detail}</div></div></div>)}
        {connectedWalletRemoved && <div className="mt-4 flex gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" /><div><div className="font-semibold">This removes the wallet you are using now.</div><div className="mt-1">After the change succeeds, this wallet will no longer authorize the account unless another signer grants access again.</div></div></div>}
        {reservePreflight && <div className={`mt-4 flex gap-3 rounded-xl p-4 text-sm ${reservePreflight.sufficient ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>{reservePreflight.sufficient ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />}<div><div className="font-semibold">{reservePreflight.sufficient ? 'Account balance is sufficient.' : `Add at least ${stroopsToXlm(reservePreflight.shortfallStroops)} XLM before continuing.`}</div><div className="mt-1 opacity-55">Reserve and network fees are checked again against fresh Horizon state before the transaction is created.</div></div></div>}
        {changes.length > 0 && !hasCriticalPolicyRisk && <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-black/10 p-4 text-sm dark:border-white/10"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-0.5" /><span><span className="font-semibold">I understand this changes who can control the account.</span><span className="mt-1 block text-neutral-500 dark:text-neutral-400">Check the signer and approval changes above before creating the transaction.</span></span></label>}
        <div className="mst-designer-step-actions mst-designer-step-actions--split mt-6"><button type="button" onClick={() => setStep('approvals')} className="mst-action-secondary"><ArrowLeft className="h-4 w-4" />Back</button><button type="button" onClick={() => void continueToReview()} disabled={generating || !canCreate} className="mst-action-primary disabled:opacity-40">{generating && <LoaderCircle className="h-4 w-4 animate-spin" />}{generating ? 'Preparing review...' : <>Create change transaction <ArrowRight className="h-4 w-4" /></>}</button></div>
      </section>}
    </div>
  );
}
