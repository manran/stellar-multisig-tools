import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Account, Networks, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { ArrowLeft, ArrowRight, CircleAlert, Clock3, LoaderCircle, RotateCcw } from 'lucide-react';
import AddressIdentity from './AddressIdentity';
import { useAddressBook } from './AddressBookContext';
import PaymentAssetPicker from './PaymentAssetPicker';
import SigningAccountPicker from './SigningAccountPicker';
import { useStellarWallet } from './StellarWalletContext';
import { NetworkBadge, TransactionLifetimePicker, WorkflowProgress } from './MultiSigUi';
import {
  CLAIMABLE_RECOVERY_CLAIMANT_COUNT,
  CLAIMABLE_RECOVERY_RESERVE_UNITS,
  CLAIM_WINDOW_OPTIONS,
  DEFAULT_CLAIM_WINDOW_SECONDS,
  claimableSourceIssue,
  claimWindowLabel,
  createRecoverableClaimableBalanceOperation,
} from './stellar/claimablePayment';
import { isValidStellarAccountId, loadAccount, loadNetworkParameters } from '../packages/stellar-core/src/horizon';
import type { StellarNetworkParameters } from '../packages/stellar-core/src/horizon';
import { paymentAssetChoices } from '../packages/stellar-core/src/paymentAsset';
import { assessPaymentSpendability } from '../packages/stellar-core/src/paymentPreflight';
import { MAX_PRIVATE_NOTE_BYTES, normalizePrivateNote, privateNoteByteLength } from '../packages/stellar-core/src/privateNote';
import { writeReviewHandoff } from './stellar/reviewHandoff';
import { resolveAddressToken } from '../packages/stellar-core/src/structuredTransfers';
import { clearTransactionTemplateDraft, loadTransactionTemplateDraft, saveTransactionTemplateDraft } from './stellar/transactionTemplateDraft';
import { getDefaultTransactionLifetime, transactionLifetimeLabel } from '../packages/stellar-core/src/transactionPreferences';
import { hasSharedSigningControl } from '../packages/stellar-core/src/treasuryModel';
import type { StellarAccountSnapshot, StellarNetwork } from '../packages/stellar-core/src/types';
import { navigateWorkspace, stellarHref } from './workspaceNavigation';

interface Props {
  network: StellarNetwork;
}

interface StoredDraft {
  source: string;
  recipient: string;
  amount: string;
  assetKey: string;
  claimWindowSeconds: number;
  lifetimeSeconds: number;
  privateNote: string;
}

const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/;

function networkPassphrase(network: StellarNetwork) {
  return network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
}

function initialSourceFromUrl() {
  const value = new URLSearchParams(window.location.search).get('account')?.trim() ?? '';
  return isValidStellarAccountId(value) ? value : '';
}

function shortAddress(address: string) {
  return address.length <= 18 ? address : `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export default function ClaimablePaymentComposer({ network }: Props) {
  const wallet = useStellarWallet();
  const { entries } = useAddressBook();
  const [source, setSource] = useState(() => initialSourceFromUrl());
  const [sourceAccount, setSourceAccount] = useState<StellarAccountSnapshot | null>(null);
  const [parameters, setParameters] = useState<StellarNetworkParameters | null>(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [assetKey, setAssetKey] = useState('native');
  const [claimWindowSeconds, setClaimWindowSeconds] = useState(DEFAULT_CLAIM_WINDOW_SECONDS);
  const [lifetimeSeconds, setLifetimeSeconds] = useState(() => getDefaultTransactionLifetime(localStorage));
  const [privateNote, setPrivateNote] = useState('');
  const [hydratedKey, setHydratedKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const sourceValid = isValidStellarAccountId(source);
  const sourceHasSharedSigning = Boolean(sourceAccount && hasSharedSigningControl(sourceAccount));
  const assets = useMemo(() => paymentAssetChoices(sourceAccount), [sourceAccount]);
  const selectedAsset = assets.find((asset) => asset.key === assetKey) ?? assets[0];
  const recipientResolved = useMemo(() => recipient.trim() ? resolveAddressToken(recipient, entries) : {}, [recipient, entries]);
  const recipientAddress = recipientResolved.address ?? '';
  const amountValid = AMOUNT_PATTERN.test(amount) && Number(amount) > 0;
  const privateNoteBytes = privateNoteByteLength(privateNote.trim());
  const privateNoteValid = privateNoteBytes <= MAX_PRIVATE_NOTE_BYTES;
  const reserveIncrease = parameters
    ? (BigInt(parameters.baseReserveInStroops) * BigInt(CLAIMABLE_RECOVERY_RESERVE_UNITS))
    : null;
  const spendability = useMemo(() => {
    if (!sourceAccount || !parameters || !selectedAsset) return null;
    try {
      return assessPaymentSpendability(sourceAccount, selectedAsset, parameters, 1, CLAIMABLE_RECOVERY_RESERVE_UNITS, true);
    } catch {
      return null;
    }
  }, [sourceAccount, parameters, selectedAsset]);
  const sourceIssue = sourceAccount && parameters && selectedAsset && amountValid
    ? claimableSourceIssue(sourceAccount, selectedAsset, amount, parameters)
    : null;
  const canContinue = sourceValid
    && sourceHasSharedSigning
    && Boolean(recipientAddress)
    && recipientAddress !== source
    && amountValid
    && privateNoteValid
    && Boolean(selectedAsset)
    && Boolean(parameters)
    && !sourceIssue
    && !busy;

  useEffect(() => {
    if (!wallet.sessionAddress) return;
    const storageKey = `claimable:${network}:${wallet.sessionAddress}`;
    const url = new URL(window.location.href);
    const fresh = url.searchParams.get('fresh') === '1';
    if (fresh) {
      clearTransactionTemplateDraft(sessionStorage, wallet.sessionAddress, network, 'claimable');
      url.searchParams.delete('fresh');
      window.history.replaceState(window.history.state, '', url.toString());
    }
    const draft = fresh ? null : loadTransactionTemplateDraft<StoredDraft>(sessionStorage, wallet.sessionAddress, network, 'claimable');
    setSource(draft?.source ?? initialSourceFromUrl());
    setRecipient(draft?.recipient ?? '');
    setAmount(draft?.amount ?? '');
    setAssetKey(draft?.assetKey ?? 'native');
    setClaimWindowSeconds(draft?.claimWindowSeconds ?? DEFAULT_CLAIM_WINDOW_SECONDS);
    setLifetimeSeconds(draft?.lifetimeSeconds ?? getDefaultTransactionLifetime(localStorage));
    setPrivateNote(draft?.privateNote ?? '');
    setError('');
    setHydratedKey(storageKey);
  }, [wallet.sessionAddress, network]);

  useEffect(() => {
    if (!wallet.sessionAddress) return;
    const storageKey = `claimable:${network}:${wallet.sessionAddress}`;
    if (storageKey !== hydratedKey) return;
    saveTransactionTemplateDraft(sessionStorage, wallet.sessionAddress, network, 'claimable', {
      source,
      recipient,
      amount,
      assetKey,
      claimWindowSeconds,
      lifetimeSeconds,
      privateNote,
    } satisfies StoredDraft);
  }, [wallet.sessionAddress, network, hydratedKey, source, recipient, amount, assetKey, claimWindowSeconds, lifetimeSeconds, privateNote]);

  useEffect(() => {
    if (!sourceValid) {
      setSourceAccount(null);
      setParameters(null);
      setAssetKey('native');
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    void Promise.all([
      loadAccount(source, network, controller.signal),
      loadNetworkParameters(network, controller.signal),
    ])
      .then(([account, nextParameters]) => {
        if (cancelled) return;
        setSourceAccount(account);
        setParameters(nextParameters);
        const nextAssets = paymentAssetChoices(account);
        setAssetKey((current) => nextAssets.some((asset) => asset.key === current) ? current : 'native');
      })
      .catch(() => {
        if (!cancelled) {
          setSourceAccount(null);
          setParameters(null);
        }
      });
    return () => { cancelled = true; controller.abort(); };
  }, [source, network, sourceValid]);

  async function buildClaimablePayment(event: FormEvent) {
    event.preventDefault();
    if (!canContinue || !selectedAsset) return;
    setBusy(true);
    setError('');
    try {
      const resolvedRecipient = resolveAddressToken(recipient, entries);
      if (!resolvedRecipient.address) throw new Error(resolvedRecipient.issue ?? 'Recipient could not be resolved.');
      const [freshSource, freshParameters] = await Promise.all([
        loadAccount(source.trim(), network),
        loadNetworkParameters(network),
      ]);
      if (!hasSharedSigningControl(freshSource)) {
        throw new Error('Claimable payments in MultiSig Tools are prepared from treasuries with shared signing control.');
      }
      const freshAsset = paymentAssetChoices(freshSource).find((asset) => asset.key === assetKey);
      if (!freshAsset) throw new Error('The selected asset is no longer available in this treasury.');
      const problem = claimableSourceIssue(freshSource, freshAsset, amount, freshParameters);
      if (problem) throw new Error(problem);

      const builder = new TransactionBuilder(new Account(freshSource.accountId, freshSource.sequence), {
        fee: String(freshParameters.baseFeeInStroops),
        networkPassphrase: networkPassphrase(network),
      });
      builder.addOperation(createRecoverableClaimableBalanceOperation({
        source: freshSource.accountId,
        destination: resolvedRecipient.address,
        asset: freshAsset,
        amount,
        claimWindowSeconds,
      }));
      const transaction = builder.setTimeout(lifetimeSeconds).build();
      writeReviewHandoff(sessionStorage, {
        xdr: transaction.toXDR(),
        network,
        privateNote: privateNote.trim() ? normalizePrivateNote(privateNote) : null,
      });
      navigateWorkspace('/signing-room', { state: { returnTo: stellarHref('/new/claimable'), returnLabel: 'Edit claimable payment' } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to prepare this claimable payment.');
      setBusy(false);
    }
  }

  const testnet = network === 'testnet';

  return (
    <main className={`mst-transaction-composer px-4 py-7 sm:px-6 lg:px-8 lg:py-8 ${testnet ? 'mst-testnet-page' : ''}`}>
      <div className="mx-auto max-w-4xl">
        <div className="mb-6"><WorkflowProgress current="prepare" /></div>
        <a href={stellarHref('/new')} className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-600 hover:text-black dark:text-neutral-300 dark:hover:text-white"><ArrowLeft className="h-4 w-4" />New</a>
        <div className="mt-4 flex items-start gap-3">
          <div className="mst-transaction-icon"><Clock3 className="h-5 w-5" /></div>
          <div><div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl font-bold tracking-tight">Claimable payment</h1><NetworkBadge network={network} /></div><p className="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-300">Send now, let the recipient claim later. If they do not claim in time, the treasury can take it back.</p></div>
        </div>

        <form onSubmit={buildClaimablePayment} className="mst-transaction-form mt-6">
          <div className="lg:col-span-2">
            <SigningAccountPicker id="claimable-source" label="From treasury" network={network} value={source} onChange={setSource} disabled={busy} placeholder="G... treasury account" sharedControlOnly />
            {source && sourceAccount && !sourceHasSharedSigning && <div className="mt-2 text-sm text-red-700 dark:text-red-300">This account is currently single-signature. Choose a treasury with shared signing control.</div>}
          </div>

          <div className="lg:col-span-2">
            <label htmlFor="claimable-recipient" className="text-sm font-semibold">Recipient</label>
            <input id="claimable-recipient" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="G... address or saved name" spellCheck={false} className="mst-transaction-control mt-2 w-full" />
            {recipientAddress && <div className="mt-2"><AddressIdentity address={recipientAddress} subjectType="account" /></div>}
            {recipient.trim() && !recipientAddress && <div className="mt-2 text-sm text-red-700 dark:text-red-300">{recipientResolved.issue}</div>}
            {recipientAddress === source && sourceValid && <div className="mt-2 text-sm text-red-700 dark:text-red-300">Choose a different recipient. The treasury is already the recovery claimant.</div>}
          </div>

          <div className="lg:col-span-2">
            <label htmlFor="claimable-amount" className="text-sm font-semibold">Amount</label>
            <div className="mt-2 grid max-w-2xl gap-2 sm:grid-cols-[minmax(0,1fr)_16rem]">
              <input id="claimable-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.0000000" className="mst-transaction-control min-w-0 text-base" />
              <PaymentAssetPicker assets={assets} value={selectedAsset?.key ?? 'native'} onChange={setAssetKey} disabled={!sourceAccount} />
            </div>
            {spendability && selectedAsset && <div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">Available after the recovery balance reserve: <span className="font-semibold text-neutral-700 dark:text-neutral-200">{spendability.assetAvailable} {selectedAsset.code}</span></div>}
            {amount && !amountValid && <div className="mt-2 text-sm text-red-700 dark:text-red-300">Enter an amount greater than 0 with up to 7 decimal places.</div>}
            {sourceIssue && <div className="mt-2 text-sm text-red-700 dark:text-red-300">{sourceIssue}</div>}
          </div>

          <div className="lg:col-span-2">
            <div className="mb-2 text-sm font-semibold">Claim window</div>
            <div className="flex flex-wrap gap-2">
              {CLAIM_WINDOW_OPTIONS.map((option) => <button key={option.seconds} type="button" aria-pressed={claimWindowSeconds === option.seconds} onClick={() => setClaimWindowSeconds(option.seconds)} className="mst-transaction-choice">{option.label}</button>)}
            </div>
            <div className="mst-claim-window-facts mt-3">
              <div><div className="font-semibold">Recipient</div><div className="mt-1 leading-6 text-neutral-600 dark:text-neutral-300">May claim for {claimWindowLabel(claimWindowSeconds)} after this balance is created.</div></div>
              <div><div className="flex items-center gap-1.5 font-semibold"><RotateCcw className="h-4 w-4" />Recovery</div><div className="mt-1 leading-6 text-neutral-600 dark:text-neutral-300">If still unclaimed, this treasury may reclaim it after {claimWindowLabel(claimWindowSeconds)}.</div></div>
            </div>
            {reserveIncrease !== null && <div className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">This recoverable balance reserves one unit for the balance entry plus one for each of its {CLAIMABLE_RECOVERY_CLAIMANT_COUNT} claimants, increasing this treasury's minimum reserve by {Number(reserveIncrease) / 10_000_000} XLM while the balance exists.</div>}
            {selectedAsset?.issuer && <div className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">The recipient does not need to receive this asset now. They must satisfy the asset's trustline and authorization requirements when they claim it.</div>}
          </div>

          <div className="lg:col-span-2">
            <div className="flex items-baseline justify-between gap-3"><label htmlFor="claimable-private-note" className="text-sm font-semibold">Private Note <span className="font-normal text-neutral-400">Optional · private</span></label><span className={`text-xs ${privateNoteValid ? 'text-neutral-400' : 'font-semibold text-red-700 dark:text-red-300'}`}>{privateNoteBytes}/{MAX_PRIVATE_NOTE_BYTES} bytes</span></div>
            <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Stored privately by MultiSig Tools · not end-to-end encrypted.</p>
            <textarea id="claimable-private-note" value={privateNote} onChange={(event) => setPrivateNote(event.target.value)} rows={4} placeholder="Why is this payment claimable?" className="mst-transaction-control mt-2 w-full resize-y leading-6" />
            {!privateNoteValid && <div className="mt-2 text-sm text-red-700 dark:text-red-300">Private Note can contain at most {MAX_PRIVATE_NOTE_BYTES} UTF-8 bytes.</div>}
          </div>

          <div className="lg:col-span-2">
            <TransactionLifetimePicker network={network} value={lifetimeSeconds} onChange={setLifetimeSeconds} disabled={busy} />
            <div className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">This is only how long the proposal itself can collect signatures and be submitted. It is separate from the {claimWindowLabel(claimWindowSeconds)} claim window, which starts after submission creates the claimable balance. Default transaction lifetime: {transactionLifetimeLabel(getDefaultTransactionLifetime(localStorage))}.</div>
          </div>

          {error && <div className="flex whitespace-pre-line gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-800 dark:text-red-200 lg:col-span-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

          <div className="mst-transaction-actions">
            <button type="submit" disabled={!canContinue} className="mst-action-primary disabled:opacity-40">{busy && <LoaderCircle className="h-4 w-4 animate-spin" />}Review transaction <ArrowRight className="h-4 w-4" /></button>
          </div>
        </form>
      </div>
    </main>
  );
}
