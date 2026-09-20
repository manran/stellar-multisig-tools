import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CircleAlert, LoaderCircle, Plus, Trash2, UsersRound } from 'lucide-react';
import { useAddressBook } from './AddressBookContext';
import SigningAccountPicker from './SigningAccountPicker';
import { useStellarWallet } from './StellarWalletContext';
import { NetworkBadge, TransactionLifetimePicker, WorkflowProgress } from './MultiSigUi';
import { AccountNotFoundError, isValidStellarAccountId, loadAccount, loadNetworkParameters } from './stellar/horizon';
import { appendBatchRecipientRow, batchRecipientRowsFromInput, batchRecipientRowsToInput, removeBatchRecipientRow } from './stellar/batchRecipientEditor';
import type { BatchRecipientDraftRow } from './stellar/batchRecipientEditor';
import { MAX_PRIVATE_NOTE_BYTES, normalizePrivateNote, privateNoteByteLength } from './stellar/privateNote';
import { isValidStellarTextMemo, stellarTextMemoByteLength } from './stellar/memo';
import { writeReviewHandoff } from './stellar/reviewHandoff';
import { parseStructuredTransfers, validateTransferRows } from './stellar/structuredTransfers';
import type { TransferIssue } from './stellar/structuredTransfers';
import { buildTransferTransaction, transferDestinationIssues, transferFundingIssues } from './stellar/transferTransactions';
import { clearTransactionTemplateDraft, loadTransactionTemplateDraft, saveTransactionTemplateDraft } from './stellar/transactionTemplateDraft';
import { getDefaultTransactionLifetime } from './stellar/transactionPreferences';
import { hasSharedSigningControl } from './stellar/treasuryModel';
import type { StellarAccountSnapshot, StellarNetwork } from './stellar/types';
import { navigateWorkspace, stellarHref } from './workspaceNavigation';

interface Props {
  network: StellarNetwork;
  mode: 'batch' | 'multi_party';
}

interface StoredDraft {
  source: string;
  input: string;
  memo: string;
  privateNote: string;
  lifetimeSeconds: number;
}

function formatIssue(issue: TransferIssue, mode: 'batch' | 'multi_party'): string {
  if (!issue.line) return issue.message;
  return `${mode === 'batch' ? 'Recipient' : 'Line'} ${issue.line}: ${issue.message}`;
}

function initialSourceFromUrl() {
  const value = new URLSearchParams(window.location.search).get('account')?.trim() ?? '';
  return isValidStellarAccountId(value) ? value : '';
}

async function loadSources(ids: string[], network: StellarNetwork): Promise<Map<string, StellarAccountSnapshot>> {
  const values = await Promise.all(ids.map(async (id) => [id, await loadAccount(id, network)] as const));
  return new Map(values);
}

async function loadDestinations(ids: string[], network: StellarNetwork): Promise<Map<string, StellarAccountSnapshot | null>> {
  const values = await Promise.all(ids.map(async (id) => {
    try {
      return [id, await loadAccount(id, network)] as const;
    } catch (cause) {
      if (cause instanceof AccountNotFoundError) return [id, null] as const;
      throw cause;
    }
  }));
  return new Map(values);
}

export default function TransferComposer({ network, mode }: Props) {
  const wallet = useStellarWallet();
  const { entries } = useAddressBook();
  const kind = mode === 'batch' ? 'batch' : 'multi-party';
  const title = mode === 'batch' ? 'Send to multiple recipients' : 'Multi-party transaction';
  const returnPath = mode === 'batch' ? '/new/batch' : '/new/multi-party';
  const [source, setSource] = useState(() => initialSourceFromUrl());
  const [input, setInput] = useState('');
  const [batchRows, setBatchRows] = useState<BatchRecipientDraftRow[]>(() => batchRecipientRowsFromInput(''));
  const [pasteInput, setPasteInput] = useState('');
  const [memo, setMemo] = useState('');
  const [privateNote, setPrivateNote] = useState('');
  const [lifetimeSeconds, setLifetimeSeconds] = useState(() => getDefaultTransactionLifetime(localStorage));
  const [hydratedKey, setHydratedKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const memoTrimmed = memo.trim();
  const memoBytes = stellarTextMemoByteLength(memoTrimmed);
  const memoValid = isValidStellarTextMemo(memoTrimmed);
  const privateNoteTrimmed = privateNote.trim();
  const privateNoteBytes = privateNoteByteLength(privateNoteTrimmed);
  const privateNoteValid = privateNoteBytes <= MAX_PRIVATE_NOTE_BYTES;

  useEffect(() => {
    if (!wallet.sessionAddress) return;
    const storageKey = `${kind}:${network}:${wallet.sessionAddress}`;
    const url = new URL(window.location.href);
    const fresh = url.searchParams.get('fresh') === '1';
    if (fresh) {
      clearTransactionTemplateDraft(sessionStorage, wallet.sessionAddress, network, kind);
      url.searchParams.delete('fresh');
      window.history.replaceState(window.history.state, '', url.toString());
    }
    const draft = fresh ? null : loadTransactionTemplateDraft<StoredDraft>(sessionStorage, wallet.sessionAddress, network, kind);
    setSource(draft?.source ?? initialSourceFromUrl());
    const draftInput = draft?.input ?? '';
    const nextBatchRows = batchRecipientRowsFromInput(draftInput);
    setInput(mode === 'batch' ? batchRecipientRowsToInput(nextBatchRows) : draftInput);
    setBatchRows(nextBatchRows);
    setPasteInput('');
    setMemo(draft?.memo ?? '');
    setPrivateNote(draft?.privateNote ?? '');
    setLifetimeSeconds(draft?.lifetimeSeconds ?? getDefaultTransactionLifetime(localStorage));
    setError('');
    setHydratedKey(storageKey);
  }, [wallet.sessionAddress, network, kind]);

  useEffect(() => {
    if (!wallet.sessionAddress) return;
    const storageKey = `${kind}:${network}:${wallet.sessionAddress}`;
    if (storageKey !== hydratedKey) return;
    saveTransactionTemplateDraft(sessionStorage, wallet.sessionAddress, network, kind, {
      source,
      input,
      memo,
      privateNote,
      lifetimeSeconds,
    } satisfies StoredDraft);
  }, [wallet.sessionAddress, network, kind, hydratedKey, source, input, memo, privateNote, lifetimeSeconds]);

  const structural = useMemo(() => parseStructuredTransfers(mode, input, entries), [mode, input, entries]);
  const accountAliases = useMemo(() => entries.filter((entry) => entry.subjectType === 'account'), [entries]);
  const aliasesAvailable = accountAliases.length > 0;
  const example = mode === 'batch'
    ? 'Alice, 150, USDC\nBob, 27.5, XLM\nGABC...XYZ, 300, USDC'
    : 'Alice, Bob, 100, XLM\nBob, Alice, 50, USDC';

  function changeInput(value: string) {
    setInput(value);
    setError('');
  }

  function commitBatchRows(next: BatchRecipientDraftRow[]) {
    setBatchRows(next);
    setInput(batchRecipientRowsToInput(next));
    setError('');
  }

  function changeBatchRow(index: number, field: keyof BatchRecipientDraftRow, value: string) {
    commitBatchRows(batchRows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  }

  function importPastedRecipients() {
    if (!pasteInput.trim()) return;
    const next = batchRecipientRowsFromInput(pasteInput);
    commitBatchRows(next);
    setPasteInput('');
  }

  async function reviewDraft() {
    setError('');
    if (structural.issues.length > 0) {
      setError(structural.issues.map((issue) => formatIssue(issue, mode)).join('\n'));
      return;
    }
    if (mode === 'batch' && !isValidStellarAccountId(source)) {
      setError('Choose a valid source Treasury.');
      return;
    }
    if (!memoValid) {
      setError('Stellar text memos can contain at most 28 UTF-8 bytes.');
      return;
    }
    if (!privateNoteValid) {
      setError(`Private Note can contain at most ${MAX_PRIVATE_NOTE_BYTES} UTF-8 bytes.`);
      return;
    }

    setBusy(true);
    try {
      const sourceIds = mode === 'batch'
        ? [source.trim()]
        : [...new Set(structural.rows.map((row) => row.source).filter((value): value is string => Boolean(value)))];
      const [accounts, parameters] = await Promise.all([
        loadSources(sourceIds, network),
        loadNetworkParameters(network),
      ]);

      if (mode === 'batch') {
        const account = accounts.get(source.trim());
        if (!account || !hasSharedSigningControl(account)) {
          throw new Error('Multiple-recipient payments in MultiSig Tools are prepared from Treasuries with shared signing control.');
        }
      }

      const validated = validateTransferRows(mode, structural.rows, accounts, mode === 'batch' ? source.trim() : undefined);
      if (validated.issues.length > 0) throw new Error(validated.issues.map((issue) => formatIssue(issue, mode)).join('\n'));
      const transactionSource = mode === 'batch' ? source.trim() : validated.rows[0]?.source;
      if (!transactionSource) throw new Error('Transaction source could not be determined.');

      const destinationIds = [...new Set(validated.rows.map((row) => row.destination))];
      const destinations = await loadDestinations(destinationIds, network);
      const destinationProblems = transferDestinationIssues(validated.rows, destinations);
      const fundingProblems = transferFundingIssues(validated.rows, accounts, transactionSource, parameters);
      const deterministicProblems = [...destinationProblems, ...fundingProblems];
      if (deterministicProblems.length > 0) throw new Error(deterministicProblems.map((issue) => formatIssue(issue, mode)).join('\n'));

      const transactionSourceAccount = accounts.get(transactionSource);
      if (!transactionSourceAccount) throw new Error('Transaction source account could not be loaded.');
      const transaction = buildTransferTransaction({
        rows: validated.rows,
        transactionSource,
        transactionSourceSequence: transactionSourceAccount.sequence,
        parameters,
        network,
        lifetimeSeconds,
        explicitOperationSources: mode === 'multi_party',
        memo: memoTrimmed || undefined,
      });
      writeReviewHandoff(sessionStorage, {
        xdr: transaction.toXDR(),
        network,
        privateNote: privateNoteTrimmed ? normalizePrivateNote(privateNoteTrimmed) : null,
      });
      navigateWorkspace('/signing-room', { state: { returnTo: stellarHref(returnPath), returnLabel: `Edit ${mode === 'batch' ? 'multiple recipients' : 'multi-party transaction'}` } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to prepare this transaction.');
    } finally {
      setBusy(false);
    }
  }


  const testnet = network === 'testnet';

  return (
    <main className={`mst-transaction-composer px-4 py-7 sm:px-6 lg:px-8 lg:py-8 ${testnet ? 'mst-testnet-page' : ''}`}>
      <div className="mx-auto max-w-5xl">
        <div className="mb-6"><WorkflowProgress current="prepare" /></div>
        <a href={stellarHref('/new')} className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-600 hover:text-black dark:text-neutral-300 dark:hover:text-white"><ArrowLeft className="h-4 w-4" />New</a>
        <div className="mt-4 flex items-start gap-3">
          <div className="mst-transaction-icon"><UsersRound className="h-5 w-5" /></div>
          <div>
            <div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl font-bold tracking-tight">{title}</h1><NetworkBadge network={network} /></div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-600 dark:text-neutral-300">
              {mode === 'batch'
                ? 'Add each recipient explicitly. MultiSigTools resolves saved names and assets, validates every payment deterministically, then builds one exact Stellar transaction.'
                : 'Paste transfers from two or more source accounts. Each source keeps its own Stellar authorization policy; all operations succeed or fail together.'}
            </p>
          </div>
        </div>

        <div className="mst-transaction-form mt-6">
          {mode === 'batch' && (
            <SigningAccountPicker
              id="batch-source"
              label="From treasury"
              network={network}
              value={source}
              onChange={(value) => { setSource(value); setError(''); }}
              disabled={busy}
              placeholder="G... treasury account"
              sharedControlOnly
            />
          )}

          {mode === 'batch' ? (
            <div>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">Recipients</div>
                  <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Each recipient becomes one payment operation in this Proposal.</div>
                </div>
                <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">{batchRows.length} {batchRows.length === 1 ? 'row' : 'rows'}</span>
              </div>
              <datalist id="batch-recipient-suggestions">
                {accountAliases.map((entry) => <option key={`${entry.address}:${entry.label}`} value={entry.label}>{entry.address}</option>)}
              </datalist>
              <div className="mt-3 grid gap-3">
                {batchRows.map((row, index) => (
                  <div key={index} className="mst-transaction-recipient-row">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">Recipient {index + 1}</div>
                      <button type="button" disabled={busy} aria-label={`Remove recipient ${index + 1}`} onClick={() => commitBatchRows(removeBatchRecipientRow(batchRows, index))} className="rounded-lg p-1.5 text-neutral-400 hover:bg-black/5 hover:text-red-700 disabled:opacity-40 dark:hover:bg-white/10 dark:hover:text-red-300"><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1.8fr)_minmax(8rem,0.7fr)_minmax(9rem,0.8fr)]">
                      <label className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Recipient
                        <input value={row.recipient} list="batch-recipient-suggestions" disabled={busy} onChange={(event) => changeBatchRow(index, 'recipient', event.target.value)} placeholder="Saved name or G... address" spellCheck={false} className="mst-transaction-control mt-1.5 w-full disabled:opacity-50" />
                      </label>
                      <label className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Amount
                        <input value={row.amount} disabled={busy} onChange={(event) => changeBatchRow(index, 'amount', event.target.value)} placeholder="0.00" inputMode="decimal" className="mst-transaction-control mt-1.5 w-full disabled:opacity-50" />
                      </label>
                      <label className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Asset
                        <input value={row.asset} disabled={busy} onChange={(event) => changeBatchRow(index, 'asset', event.target.value)} placeholder="XLM or USDC" spellCheck={false} className="mst-transaction-control mt-1.5 w-full disabled:opacity-50" />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" disabled={busy || batchRows.length >= 100} onClick={() => commitBatchRows(appendBatchRecipientRow(batchRows))} className="mst-action-secondary mt-3 disabled:opacity-40"><Plus className="h-4 w-4" />Add recipient</button>
              <div className="mt-3 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Use XLM, a unique held asset code such as USDC, or CODE:ISSUER when the code is ambiguous.{aliasesAvailable ? ' Saved Address Book names are suggested as you type.' : ' Unlock the private workspace to use saved names.'}</div>
              <details className="mst-transaction-disclosure mt-4">
                <summary className="cursor-pointer text-sm font-semibold">Paste a recipient list</summary>
                <p className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Optional shortcut for CSV, tab-separated, or one whitespace-separated recipient per line. Imported rows become the same editable fields above.</p>
                <textarea value={pasteInput} onChange={(event) => setPasteInput(event.target.value)} rows={5} spellCheck={false} placeholder={example} className="mst-transaction-control mt-2 w-full resize-y font-mono leading-6" />
                <div className="mt-2 flex justify-end"><button type="button" disabled={busy || !pasteInput.trim()} onClick={importPastedRecipients} className="mst-action-secondary disabled:opacity-40">Use pasted rows</button></div>
              </details>
            </div>
          ) : (
            <div>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <label htmlFor={`${kind}-input`} className="text-sm font-semibold">Transfers</label>
                <span className="text-xs text-neutral-400">CSV · tab-separated · one whitespace-separated row per line</span>
              </div>
              <textarea id={`${kind}-input`} value={input} onChange={(event) => changeInput(event.target.value)} rows={9} spellCheck={false} placeholder={example} className="mst-transaction-control mt-2 w-full resize-y font-mono leading-6" />
              <div className="mt-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Columns: source, destination, amount, asset. The first source account pays the transaction fee and supplies the sequence number. Use XLM, a unique held asset code such as USDC, or CODE:ISSUER when the code is ambiguous.{aliasesAvailable ? ' Saved Address Book names are accepted.' : ' Unlock the private workspace to use saved names.'}</div>
            </div>
          )}

          <div>
            <div className="flex items-baseline justify-between gap-3"><label htmlFor={`${kind}-memo`} className="text-sm font-semibold">Stellar memo <span className="font-normal text-neutral-400">Optional · public on-chain</span></label><span className={`text-xs ${memoValid ? 'text-neutral-400' : 'font-semibold text-red-700 dark:text-red-300'}`}>{memoBytes}/28 bytes</span></div>
            <input id={`${kind}-memo`} value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="Short public memo" className="mst-transaction-control mt-2 w-full" />
            {!memoValid && <div className="mt-2 text-sm text-red-700 dark:text-red-300">Stellar text memos can contain at most 28 UTF-8 bytes.</div>}
          </div>

          <div>
            <div className="flex items-baseline justify-between gap-3"><label htmlFor={`${kind}-private-note`} className="text-sm font-semibold">Private Note <span className="font-normal text-neutral-400">Optional · private</span></label><span className={`text-xs ${privateNoteValid ? 'text-neutral-400' : 'font-semibold text-red-700 dark:text-red-300'}`}>{privateNoteBytes}/{MAX_PRIVATE_NOTE_BYTES} bytes</span></div>
            <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">Stored privately by MultiSig Tools · not end-to-end encrypted.</p>
            <textarea id={`${kind}-private-note`} value={privateNote} onChange={(event) => setPrivateNote(event.target.value)} rows={3} placeholder="Context for people reviewing this Proposal." className="mst-transaction-control mt-2 w-full resize-y leading-6" />
            {!privateNoteValid && <div className="mt-2 text-sm text-red-700 dark:text-red-300">Private Note can contain at most {MAX_PRIVATE_NOTE_BYTES} UTF-8 bytes.</div>}
          </div>

          <TransactionLifetimePicker network={network} value={lifetimeSeconds} onChange={setLifetimeSeconds} disabled={busy} />

          {error && <div className="whitespace-pre-line rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm leading-6 text-red-800 dark:text-red-200"><div className="flex gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div></div>}

          <div className="mst-transaction-actions">
            <button type="button" disabled={busy || !input.trim() || !memoValid || !privateNoteValid} onClick={() => void reviewDraft()} className="mst-action-primary disabled:opacity-40">{busy && <LoaderCircle className="h-4 w-4 animate-spin" />}{busy ? 'Preparing review…' : 'Review transaction'} <ArrowRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
    </main>
  );
}
