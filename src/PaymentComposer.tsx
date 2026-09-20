import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CircleAlert, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import AddressAliasEditor from './AddressAliasEditor';
import { useAddressBook } from './AddressBookContext';
import PaymentAssetPicker from './PaymentAssetPicker';
import SigningAccountPicker from './SigningAccountPicker';
import { useStellarWallet } from './StellarWalletContext';
import { NetworkBadge, TransactionLifetimePicker, WorkflowProgress } from './MultiSigUi';
import { isValidStellarAccountId, loadAccount, loadNetworkParameters } from './stellar/horizon';
import type { StellarNetworkParameters } from './stellar/horizon';
import { paymentAssetChoices } from './stellar/paymentAsset';
import type { PaymentAssetChoice } from './stellar/paymentAsset';
import { clearPaymentDraft, loadPaymentDraft, paymentDraftStorageKey, savePaymentDraft } from './stellar/paymentDraft';
import type { PaymentDraftAction, PaymentRecipientDraft } from './stellar/paymentDraft';
import { assessPaymentSpendability, paymentSourceIssue } from './stellar/paymentPreflight';
import { peekAccountsForSigner } from './stellar/signerAccounts';
import { isValidStellarTextMemo, stellarTextMemoByteLength } from './stellar/memo';
import { normalizePrivateNote, MAX_PRIVATE_NOTE_BYTES, privateNoteByteLength } from './stellar/privateNote';
import { createPrivateCommitment } from './stellar/privateCommitment';
import { stellarAmountToStroops, stroopsToStellarAmount } from './stellar/reserve';
import { writeReviewHandoff } from './stellar/reviewHandoff';
import { getDefaultTransactionLifetime, setDefaultTransactionLifetime, transactionLifetimeLabel } from './stellar/transactionPreferences';
import { parseStructuredTransfers, validateTransferRows } from './stellar/structuredTransfers';
import { hasSharedSigningControl } from './stellar/treasuryModel';
import { prepareClassicPayment } from './stellar/classicPaymentPrepare';
import { prepareClassicCreateAccount } from './stellar/classicCreateAccountPrepare';
import type { StellarAccountSnapshot, StellarNetwork } from './stellar/types';
import { navigateWorkspace, stellarHref } from './workspaceNavigation';

interface Props {
  network: StellarNetwork;
}

function shortAddress(address: string) {
  return address.length <= 18 ? address : `${address.slice(0, 7)}…${address.slice(-6)}`;
}

function validAmount(value: string) {
  return /^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/.test(value) && Number(value) > 0;
}

function emptyRecipient(): PaymentRecipientDraft {
  return { destination: '', amount: '', assetKey: 'native' };
}

function assetToken(asset: Pick<PaymentAssetChoice, 'code' | 'issuer'>) {
  return asset.issuer ? `${asset.code}:${asset.issuer}` : 'XLM';
}

export default function PaymentComposer({ network }: Props) {
  const { privateUnlocked, sessionAddress } = useStellarWallet();
  const { entries, labelFor } = useAddressBook();
  const [action, setAction] = useState<PaymentDraftAction>(() =>
    window.location.pathname.endsWith('/new/create-account')
      || new URLSearchParams(window.location.search).get('action') === 'create-account'
      ? 'create_account'
      : 'payment',
  );
  const [source, setSource] = useState('');
  const [sourceAccount, setSourceAccount] = useState<StellarAccountSnapshot | null>(null);
  const [sourceParameters, setSourceParameters] = useState<StellarNetworkParameters | null>(null);
  const [recipients, setRecipients] = useState<PaymentRecipientDraft[]>(() => [emptyRecipient()]);
  const [pasteInput, setPasteInput] = useState('');
  const [memo, setMemo] = useState('');
  const [privateNote, setPrivateNote] = useState('');
  const [addOnChainProof, setAddOnChainProof] = useState(false);
  const [memoClearArmed, setMemoClearArmed] = useState(false);
  const [defaultSigningWindowSeconds, setDefaultSigningWindowSeconds] = useState(() => getDefaultTransactionLifetime(localStorage));
  const [signingWindowSeconds, setSigningWindowSeconds] = useState(() => getDefaultTransactionLifetime(localStorage));
  const [hydratedDraftKey, setHydratedDraftKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const sourceValid = useMemo(() => isValidStellarAccountId(source), [source]);
  const memoBytes = useMemo(() => stellarTextMemoByteLength(memo), [memo]);
  const memoValid = useMemo(() => isValidStellarTextMemo(memo), [memo]);
  const privateNoteBytes = useMemo(() => privateNoteByteLength(privateNote.trim()), [privateNote]);
  const privateNotePresent = privateNote.trim().length > 0;
  const privateNoteValid = !privateNotePresent || privateNoteBytes <= MAX_PRIVATE_NOTE_BYTES;
  const proofNeedsNote = addOnChainProof && !privateNotePresent;
  const memoProofConflict = addOnChainProof && memo.trim().length > 0;
  const contextValid = memoValid && privateNoteValid && !proofNeedsNote && !memoProofConflict;
  const sourceHasSharedSigning = Boolean(sourceAccount && hasSharedSigningControl(sourceAccount));
  const assets = useMemo(() => paymentAssetChoices(sourceAccount), [sourceAccount]);
  const savedAccounts = useMemo(
    () => entries
      .filter((entry) => entry.subjectType === 'account')
      .sort((left, right) => left.label.localeCompare(right.label) || left.address.localeCompare(right.address)),
    [entries],
  );
  const recipientDetails = useMemo(() => recipients.map((recipient) => ({
    recipient,
    destinationValid: isValidStellarAccountId(recipient.destination),
    amountValid: validAmount(recipient.amount),
    asset: assets.find((asset) => asset.key === recipient.assetKey) ?? null,
  })), [recipients, assets]);
  const recipientsValid = recipientDetails.length > 0 && recipientDetails.every((row) => row.destinationValid && row.amountValid && row.asset);
  const multipleRecipients = recipients.length > 1;
  const canConvertToCreateAccount = recipients.length === 1 && recipients[0]?.assetKey === 'native';
  const actionShapeValid = action === 'payment' || canConvertToCreateAccount;

  const fundingState = useMemo(() => {
    if (!sourceAccount || !sourceParameters) return { error: '' };
    const totals = new Map<string, bigint>();
    for (const row of recipientDetails) {
      if (!row.asset || !row.amountValid) continue;
      try {
        totals.set(row.asset.key, (totals.get(row.asset.key) ?? 0n) + stellarAmountToStroops(row.recipient.amount));
      } catch {
        // Field validation owns malformed amounts.
      }
    }
    try {
      for (const [assetKey, total] of totals) {
        const asset = assets.find((choice) => choice.key === assetKey);
        if (!asset) continue;
        const spendability = assessPaymentSpendability(sourceAccount, asset, sourceParameters, Math.max(1, recipients.length));
        const issue = paymentSourceIssue(spendability, asset, stroopsToStellarAmount(total));
        if (issue) return { error: issue };
      }
      return { error: '' };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : 'Unable to calculate the spendable balance.' };
    }
  }, [sourceAccount, sourceParameters, recipientDetails, assets, recipients.length]);

  const canContinue = sourceValid && sourceHasSharedSigning && recipientsValid && contextValid
    && actionShapeValid && !fundingState.error && !busy;
  const testnet = network === 'testnet';

  function saveSelectedTransactionLifetimeAsDefault() {
    setDefaultTransactionLifetime(localStorage, signingWindowSeconds);
    setDefaultSigningWindowSeconds(signingWindowSeconds);
  }

  function switchAction(next: PaymentDraftAction) {
    if (next === action) return;
    if (next === 'create_account' && !canConvertToCreateAccount) {
      setError('Create account is a single-recipient XLM action. Keep one recipient and select XLM before switching; your current payment rows were not changed.');
      return;
    }
    setAction(next);
    setError('');
    const current = new URL(window.location.href);
    const target = new URL(stellarHref(next === 'create_account' ? '/new/create-account' : '/new/payment'));
    target.search = current.search;
    target.searchParams.delete('action');
    target.searchParams.delete('fresh');
    window.history.replaceState(window.history.state, '', target.toString());
  }

  function updateRecipient(index: number, patch: Partial<PaymentRecipientDraft>) {
    setRecipients((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
    setError('');
  }

  function addRecipient() {
    setError('');
    if (action === 'create_account') {
      setError('Switch to Payment before adding another recipient. Account creation is one explicit CreateAccount operation.');
      return;
    }
    if (addOnChainProof) {
      setError('Turn off on-chain proof before adding recipients. A Stellar transaction has one memo field, so MultiSig Tools does not silently change the proof format when a payment becomes multi-recipient.');
      return;
    }
    setRecipients((current) => current.length >= 100 ? current : [...current, emptyRecipient()]);
  }

  function removeRecipient(index: number) {
    setRecipients((current) => {
      const next = current.filter((_, rowIndex) => rowIndex !== index);
      return next.length > 0 ? next : [emptyRecipient()];
    });
    setError('');
  }

  function importRecipientList() {
    if (action === 'create_account') {
      setError('Switch to Payment before importing a recipient list.');
      return;
    }
    if (!sourceAccount || !sourceValid || !pasteInput.trim()) return;
    const parsed = parseStructuredTransfers('batch', pasteInput, entries);
    if (parsed.issues.length > 0) {
      setError(parsed.issues.map((issue) => issue.line ? `Recipient ${issue.line}: ${issue.message}` : issue.message).join('\n'));
      return;
    }
    const validated = validateTransferRows('batch', parsed.rows, new Map([[sourceAccount.accountId, sourceAccount]]), sourceAccount.accountId);
    if (validated.issues.length > 0) {
      setError(validated.issues.map((issue) => issue.line ? `Recipient ${issue.line}: ${issue.message}` : issue.message).join('\n'));
      return;
    }
    setRecipients(validated.rows.map((row) => ({
      destination: row.destination,
      amount: row.amount,
      assetKey: row.asset.key,
    })));
    setPasteInput('');
    setAddOnChainProof(false);
    setError('');
  }

  useEffect(() => {
    if (!sessionAddress) {
      setHydratedDraftKey('');
      return;
    }
    const key = paymentDraftStorageKey(sessionAddress, network);
    const url = new URL(window.location.href);
    const freshStart = url.searchParams.get('fresh') === '1';
    if (freshStart) {
      clearPaymentDraft(sessionStorage, sessionAddress, network);
      url.searchParams.delete('fresh');
      window.history.replaceState(window.history.state, '', url.toString());
    }
    const draft = freshStart ? null : loadPaymentDraft(sessionStorage, sessionAddress, network);
    const requestedSource = url.searchParams.get('account')?.trim() ?? '';
    const requestedAction: PaymentDraftAction | null = window.location.pathname.endsWith('/new/create-account') || url.searchParams.get('action') === 'create-account' ? 'create_account' : null;
    setError('');
    setAction(requestedAction ?? draft?.action ?? 'payment');
    setSourceAccount(null);
    setSourceParameters(null);
    setSource(draft?.source ?? (isValidStellarAccountId(requestedSource) ? requestedSource : ''));
    setRecipients(draft?.recipients?.length ? draft.recipients : [emptyRecipient()]);
    setPasteInput('');
    setMemo(draft?.memo ?? '');
    setPrivateNote(draft?.privateNote ?? '');
    setAddOnChainProof(draft?.addOnChainProof ?? false);
    setSigningWindowSeconds(draft?.signingWindowSeconds ?? getDefaultTransactionLifetime(localStorage));
    setHydratedDraftKey(key);
  }, [sessionAddress, network]);

  useEffect(() => {
    if (!sessionAddress) return;
    const key = paymentDraftStorageKey(sessionAddress, network);
    if (hydratedDraftKey !== key) return;
    savePaymentDraft(sessionStorage, sessionAddress, network, {
      version: 4,
      action,
      source,
      recipients,
      memo,
      privateNote,
      addOnChainProof,
      signingWindowSeconds,
    });
  }, [sessionAddress, network, hydratedDraftKey, action, source, recipients, memo, privateNote, addOnChainProof, signingWindowSeconds]);

  useEffect(() => {
    if (!sourceValid) {
      setSourceAccount(null);
      setSourceParameters(null);
      setRecipients((current) => current.map((row) => ({ ...row, assetKey: 'native' })));
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const cachedAccount = sessionAddress
      ? peekAccountsForSigner(sessionAddress, network)?.find((account) => account.accountId === source) ?? null
      : null;
    if (cachedAccount) setSourceAccount(cachedAccount);
    void Promise.all([
      cachedAccount ? Promise.resolve(cachedAccount) : loadAccount(source, network, controller.signal),
      sourceParameters ? Promise.resolve(sourceParameters) : loadNetworkParameters(network, controller.signal),
    ])
      .then(([account, parameters]) => {
        if (cancelled) return;
        setSourceAccount(account);
        setSourceParameters(parameters);
        const nextAssets = paymentAssetChoices(account);
        setRecipients((current) => current.map((row) => ({
          ...row,
          assetKey: nextAssets.some((asset) => asset.key === row.assetKey) ? row.assetKey : 'native',
        })));
      })
      .catch(() => {
        if (!cancelled) {
          setSourceAccount(null);
          setSourceParameters(null);
        }
      });
    return () => { cancelled = true; controller.abort(); };
  }, [source, network, sourceValid]);

  async function buildPayment(event: FormEvent) {
    event.preventDefault();
    if (!canContinue) return;
    setBusy(true);
    setError('');
    try {
      const [freshSourceAccount, parameters] = await Promise.all([
        loadAccount(source.trim(), network),
        loadNetworkParameters(network),
      ]);
      if (!hasSharedSigningControl(freshSourceAccount)) {
        throw new Error('Payments and account creation in MultiSig Tools are prepared from treasuries with shared signing control. This account is currently single-signature.');
      }

      const freshAssets = paymentAssetChoices(freshSourceAccount);
      const accountCache = new Map<string, Promise<StellarAccountSnapshot>>([
        [freshSourceAccount.accountId, Promise.resolve(freshSourceAccount)],
      ]);
      const accountLoader = (accountId: string, requestedNetwork: StellarNetwork) => {
        const key = accountId;
        const cached = accountCache.get(key);
        if (cached) return cached;
        const pending = loadAccount(accountId, requestedNetwork);
        accountCache.set(key, pending);
        return pending;
      };
      const dependencies = {
        accountLoader,
        networkParametersLoader: async () => parameters,
      };

      const privateCommitment = addOnChainProof ? createPrivateCommitment(privateNote) : null;
      const requestPrivateNote = privateNotePresent && !addOnChainProof ? normalizePrivateNote(privateNote) : '';
      const memoInput = addOnChainProof
        ? { memoHashHex: privateCommitment!.hashHex }
        : { memo: memo.trim() || undefined };

      let xdr: string;
      if (action === 'create_account') {
        if (!canConvertToCreateAccount) {
          throw new Error('Create account requires exactly one recipient and XLM. Switch back to Payment to keep multiple recipients or issued assets.');
        }
        const recipient = recipients[0];
        const prepared = await prepareClassicCreateAccount({
          network,
          sourceAccount: freshSourceAccount.accountId,
          destination: recipient.destination.trim(),
          startingBalance: recipient.amount.trim(),
          ...memoInput,
          lifetimeSeconds: signingWindowSeconds,
        }, dependencies);
        xdr = prepared.xdr;
      } else {
        const payments = recipients.map((recipient, index) => {
          const asset = freshAssets.find((choice) => choice.key === recipient.assetKey);
          if (!asset) throw new Error(`Recipient ${index + 1}: the selected asset is no longer available in this treasury.`);
          return {
            destination: recipient.destination.trim(),
            amount: recipient.amount.trim(),
            asset: asset.issuer
              ? { type: 'credit' as const, code: asset.code, issuer: asset.issuer }
              : { type: 'native' as const },
          };
        });
        const prepared = await prepareClassicPayment({
          network,
          sourceAccount: freshSourceAccount.accountId,
          payments,
          ...memoInput,
          lifetimeSeconds: signingWindowSeconds,
        }, dependencies);
        xdr = prepared.xdr;
      }

      writeReviewHandoff(sessionStorage, {
        xdr,
        network,
        privateNote: requestPrivateNote || null,
        privateCommitment,
      });
      navigateWorkspace('/signing-room', {
        state: {
          returnTo: stellarHref(action === 'create_account' ? '/new/create-account' : '/new/payment'),
          returnLabel: action === 'create_account' ? 'Edit account creation' : 'Edit payment',
        },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Unable to prepare this ${action === 'create_account' ? 'account creation' : 'payment'}.`);
      setBusy(false);
    }
  }

  return (
    <main className={`mst-transaction-composer px-4 py-7 sm:px-6 lg:px-8 lg:py-8 ${testnet ? 'mst-testnet-page' : ''}`}>
      <div className="mx-auto max-w-4xl">
        <div className="mb-6"><WorkflowProgress current="prepare" /></div>
        <a href={stellarHref('/new')} className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-600 hover:text-black dark:text-neutral-300 dark:hover:text-white"><ArrowLeft className="h-4 w-4" />New</a>
        <div className="mt-4 flex flex-wrap items-center gap-3"><h1 className="text-3xl font-bold tracking-tight">{action === 'create_account' ? 'Create Stellar account' : 'Send payment'}</h1><NetworkBadge network={network} /></div>
        <div className="mst-transaction-choice-group mt-4" role="group" aria-label="Classic action">
          <button type="button" aria-pressed={action === 'payment'} onClick={() => switchAction('payment')} className="mst-transaction-choice">Payment</button>
          <button type="button" aria-pressed={action === 'create_account'} onClick={() => switchAction('create_account')} className="mst-transaction-choice">Create account</button>
        </div>
        <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">{action === 'create_account' ? 'CreateAccount is explicit: the destination must not exist yet and the starting balance is XLM. Switch back to Payment without losing these fields.' : 'Payment requires an active destination. For a new G-address, switch explicitly to Create account; MultiSig Tools will never change the operation automatically.'}</p>

        <form onSubmit={buildPayment} className="mst-transaction-form mt-6">
          <div className="lg:col-span-2">
            <SigningAccountPicker
              id="payment-source"
              label="From treasury"
              network={network}
              value={source}
              onChange={setSource}
              disabled={busy}
              placeholder="G... treasury account"
              sharedControlOnly
            />
            {source && sourceAccount && !sourceHasSharedSigning && <div className="mt-2 text-sm text-red-700 dark:text-red-300">This account is currently single-signature. Choose a treasury with shared signing control.</div>}
          </div>

          <section className="mst-transaction-section" aria-labelledby="payment-recipients-heading">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="payment-recipients-heading" className="text-sm font-semibold">{action === 'create_account' ? 'New account' : 'Recipients'}</h2>
                <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">{action === 'create_account' ? 'Enter the inactive G-address and its starting XLM balance.' : 'Add another recipient to include multiple payments in the same proposal.'}</p>
              </div>
              {action === 'payment' && <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">{recipients.length} {recipients.length === 1 ? 'recipient' : 'recipients'}</span>}
            </div>

            <div className="mst-transaction-recipient-list mt-3">
              {recipientDetails.map(({ recipient, destinationValid, amountValid, asset }, index) => {
                const destinationLabel = destinationValid ? labelFor(recipient.destination, 'account') : '';
                return (
                  <div key={index} className="mst-transaction-recipient-row">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">Recipient {index + 1}</div>
                      {recipients.length > 1 && (
                        <button type="button" disabled={busy} aria-label={`Remove recipient ${index + 1}`} onClick={() => removeRecipient(index)} className="rounded-lg p-1.5 text-neutral-400 hover:bg-black/5 hover:text-red-700 disabled:opacity-40 dark:hover:bg-white/10 dark:hover:text-red-300"><Trash2 className="h-4 w-4" /></button>
                      )}
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label htmlFor={`payment-destination-${index}`} className="text-sm font-semibold">To</label>
                        {privateUnlocked && savedAccounts.length > 0 ? (
                          <select aria-label={`Choose saved recipient ${index + 1}`} value="" onChange={(event) => { if (event.target.value) updateRecipient(index, { destination: event.target.value }); }} className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs font-semibold text-neutral-600 outline-none dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-300">
                            <option value="">Address Book…</option>
                            {savedAccounts.map((entry) => <option key={entry.address} value={entry.address}>{labelFor(entry.address, 'account') || entry.label} · {shortAddress(entry.address)}</option>)}
                          </select>
                        ) : (
                          <span className="text-xs text-neutral-400">Unlock to use Address Book</span>
                        )}
                      </div>
                      <input id={`payment-destination-${index}`} value={recipient.destination} onChange={(event) => updateRecipient(index, { destination: event.target.value.trim() })} placeholder="G... destination" spellCheck={false} className="mst-transaction-control mt-2 w-full font-mono" />
                      {destinationValid && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                          {destinationLabel && <span>Saved as <span className="font-semibold text-neutral-700 dark:text-neutral-200">{destinationLabel}</span></span>}
                          <AddressAliasEditor address={recipient.destination} subjectType="account" compact={Boolean(destinationLabel)} />
                        </div>
                      )}
                      {recipient.destination && !destinationValid && <div className="mt-2 text-sm text-red-700 dark:text-red-300">Enter a valid Stellar G... account.</div>}
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,0.9fr)]">
                      <label htmlFor={`payment-amount-${index}`} className="text-sm font-semibold">Amount
                        <input id={`payment-amount-${index}`} inputMode="decimal" value={recipient.amount} onChange={(event) => updateRecipient(index, { amount: event.target.value })} placeholder="0.0000000" className="mst-transaction-control mt-2 w-full text-base" />
                      </label>
                      <div>
                        <div className="mb-2 text-sm font-semibold">Asset</div>
                        {action === 'create_account' ? <div className="mst-transaction-static-field">XLM <span className="ml-1 font-normal text-neutral-400">required for CreateAccount</span></div> : <PaymentAssetPicker assets={assets} value={asset?.key ?? 'native'} onChange={(assetKey) => updateRecipient(index, { assetKey })} disabled={!sourceAccount} ariaLabel={`Recipient ${index + 1} asset`} />}
                      </div>
                    </div>
                    {recipient.amount && !amountValid && <div className="mt-2 text-sm text-red-700 dark:text-red-300">Enter an amount greater than 0 with up to 7 decimal places.</div>}
                  </div>
                );
              })}
            </div>

            {action === 'payment' && <>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" disabled={busy || recipients.length >= 100} onClick={addRecipient} className="mst-action-secondary disabled:opacity-40"><Plus className="h-4 w-4" />Add recipient</button>
                <span className="text-xs text-neutral-500 dark:text-neutral-400">Up to 100 payment operations in one Stellar transaction.</span>
              </div>

              <details className="mst-transaction-disclosure mt-4">
                <summary className="cursor-pointer text-sm font-semibold">Paste a recipient list</summary>
                <p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Optional shortcut. Use recipient, amount, asset as CSV, tab-separated, or whitespace-separated rows. Saved Address Book names and held asset codes are resolved into the same editable rows above.</p>
                <textarea value={pasteInput} onChange={(event) => setPasteInput(event.target.value)} rows={5} spellCheck={false} placeholder={'Alice, 150, USDC\nBob, 27.5, XLM'} className="mst-transaction-control mt-2 w-full resize-y font-mono leading-6" />
                <div className="mt-2 flex justify-end"><button type="button" disabled={busy || !pasteInput.trim() || !sourceAccount} onClick={importRecipientList} className="mst-action-secondary disabled:opacity-40">Use pasted rows</button></div>
              </details>
            </>}

            {fundingState.error && <div className="mt-3 text-sm text-red-700 dark:text-red-300">{fundingState.error}</div>}
          </section>

          <div className="mst-transaction-section">
            <div className="mb-3 text-sm font-semibold">Transaction context <span className="font-normal text-neutral-400">Optional</span></div>
            <div className="mst-transaction-context-list">
              <div className="mst-transaction-context-section">
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor="payment-memo" className="text-sm font-semibold">Stellar memo <span className="font-normal text-neutral-400">Public · on-chain</span></label>
                  <span className={`text-xs ${memoValid ? 'text-neutral-400' : 'font-semibold text-red-700 dark:text-red-300'}`}>{memoBytes}/28 bytes</span>
                </div>
                <input id="payment-memo" value={memo} onChange={(event) => { setMemo(event.target.value); setMemoClearArmed(false); }} placeholder="Short public memo" className="mst-transaction-control mt-2 w-full" />
                {!memoValid && <div className="mt-2 text-sm text-red-700 dark:text-red-300">Stellar text memos can contain at most 28 UTF-8 bytes.</div>}
              </div>

              <div className="mst-transaction-context-section">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div><label htmlFor="private-note" className="text-sm font-semibold">Private Note <span className="font-normal text-neutral-400">Private</span></label><p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Stored privately by MultiSig Tools · not end-to-end encrypted.</p></div>
                  <span className={`text-xs ${privateNoteValid ? 'text-neutral-400' : 'font-semibold text-red-700 dark:text-red-300'}`}>{privateNoteBytes}/{MAX_PRIVATE_NOTE_BYTES} bytes</span>
                </div>
                <textarea id="private-note" value={privateNote} onChange={(event) => setPrivateNote(event.target.value)} rows={7} placeholder="Why are we making this payment? Add any private context signers should see." className="mst-transaction-control mt-3 w-full resize-y leading-6" />
                <label className={`mst-transaction-option-row mt-3 ${multipleRecipients ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                  <input type="checkbox" checked={addOnChainProof} disabled={multipleRecipients} onChange={(event) => setAddOnChainProof(event.target.checked)} className="mt-1" />
                  <span className="text-sm">
                    <span className="font-semibold">Add on-chain proof</span>
                    <span className="mt-1 block text-xs leading-5 text-neutral-500 dark:text-neutral-400">{multipleRecipients ? 'Available for single-recipient payments only.' : 'Anchor a hash of this note to Stellar. The note stays private.'}</span>
                  </span>
                </label>
                {!privateNoteValid && <div className="mt-2 text-sm text-red-700 dark:text-red-300">Private Note can contain at most {MAX_PRIVATE_NOTE_BYTES} UTF-8 bytes.</div>}
                {proofNeedsNote && <div className="mt-2 text-sm text-red-700 dark:text-red-300">Enter Private Note text before adding on-chain proof.</div>}
              </div>
            </div>
            {memoProofConflict && (
              <div className="mt-3 flex gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div>Stellar has one memo field. Keep either the public memo or the on-chain proof.</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!memoClearArmed ? (
                      <button type="button" onClick={() => setMemoClearArmed(true)} className="rounded-lg border border-amber-600/30 bg-white/70 px-3 py-2 text-xs font-semibold text-amber-900 dark:bg-black/10 dark:text-amber-100">Remove public memo</button>
                    ) : (
                      <>
                        <button type="button" onClick={() => setMemoClearArmed(false)} className="rounded-lg border border-amber-600/20 px-3 py-2 text-xs font-semibold">Keep memo</button>
                        <button type="button" onClick={() => { setMemo(''); setMemoClearArmed(false); }} className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white">Confirm remove memo</button>
                      </>
                    )}
                    <button type="button" onClick={() => { setAddOnChainProof(false); setMemoClearArmed(false); }} className="rounded-lg border border-amber-600/30 bg-white/70 px-3 py-2 text-xs font-semibold text-amber-900 dark:bg-black/10 dark:text-amber-100">Turn off on-chain proof</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="mst-transaction-section">
            <TransactionLifetimePicker network={network} value={signingWindowSeconds} onChange={setSigningWindowSeconds} disabled={busy} />
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-neutral-500 dark:text-neutral-400">
              <span>Default for new transactions: {transactionLifetimeLabel(defaultSigningWindowSeconds)}. This transaction can override it.</span>
              {signingWindowSeconds !== defaultSigningWindowSeconds && (
                <button type="button" onClick={saveSelectedTransactionLifetimeAsDefault} className="font-semibold text-neutral-700 underline decoration-black/20 underline-offset-4 dark:text-neutral-200 dark:decoration-white/20">Use {transactionLifetimeLabel(signingWindowSeconds)} as default</button>
              )}
            </div>
          </div>

          {error && <div className="whitespace-pre-line rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-800 dark:text-red-200 lg:col-span-2"><div className="flex gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div></div>}

          <div className="mst-transaction-actions">
            <button type="submit" disabled={!canContinue} className="mst-action-primary disabled:opacity-40">{busy && <LoaderCircle className="h-4 w-4 animate-spin" />}{action === 'create_account' ? 'Review account creation' : 'Review payment'} <ArrowRight className="h-4 w-4" /></button>
          </div>
        </form>
      </div>
    </main>
  );
}
