import { projectTransactionSemantics } from './stellar/transactionSemantics';
import { inspectedAssetIdentity } from './stellar/assetPresentation';
import type { PortableEvidenceHistoryEvent, PortableEvidenceRecord } from './stellar/portableEvidence';
import type { TransactionXdrInspection } from '../packages/stellar-core/src/transactionXdr';

function displayRequestId(id: string) { return id.match(/.{1,4}/g)?.join('-') ?? id; }

function assetLabel(asset: string) {
  const identity = inspectedAssetIdentity(asset);
  return identity.issuer ? `${identity.code}:${identity.issuer}` : identity.code;
}

function historyTitle(event: PortableEvidenceHistoryEvent) {
  const actor = event.actorAddress;
  switch (event.type) {
    case 'request_created': return actor ? `${actor} created the proposal` : 'Proposal created';
    case 'approval_added': return actor ? `${actor} signed` : 'Signature added · signer not recorded';
    case 'approval_declined': return actor ? `${actor} declined` : 'Proposal declined · signer not recorded';
    case 'transaction_submitted': return actor ? `${actor} submitted to Stellar` : 'Submitted to Stellar';
    case 'transaction_confirmed': return event.ledger ? `System confirmed · Ledger ${event.ledger.toLocaleString()}` : 'System confirmed on Stellar';
    default: return 'Recorded event';
  }
}

function PortableTransactionBody({ inspection }: { inspection: TransactionXdrInspection }) {
  const semantics = projectTransactionSemantics(inspection);
  const payment = semantics.kind === 'payment' ? semantics.payment : null;
  const payments = semantics.kind === 'batch_payment' || semantics.kind === 'multi_party' ? semantics.payments : [];
  const claimablePayment = semantics.kind === 'claimable_payment' ? semantics.claimablePayment : null;
  const memo = inspection.memo.type !== 'none' && inspection.memo.value != null ? inspection.memo : null;

  return (
    <section className="transaction-evidence-summary">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">Transaction</div>
      {payment && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div><div className="portable-evidence-label">From</div><div className="portable-evidence-address">{inspection.transactionSourceAccount}</div></div>
          <div><div className="portable-evidence-label">To</div><div className="portable-evidence-address">{payment.destination}</div></div>
          <div><div className="portable-evidence-label">Amount</div><div className="font-semibold tabular-nums">{payment.amount}</div></div>
          <div><div className="portable-evidence-label">Asset</div><div className="portable-evidence-address">{assetLabel(payment.asset)}</div></div>
        </div>
      )}
      {payments.length > 0 && (
        <div className="mt-3 overflow-hidden rounded border border-black/10">
          <table className="w-full text-left text-xs">
            <thead><tr>{semantics.kind === 'multi_party' && <th className="px-2 py-2">From</th>}<th className="px-2 py-2">To</th><th className="px-2 py-2">Amount</th><th className="px-2 py-2">Asset</th></tr></thead>
            <tbody>{payments.map((item, index) => <tr key={`${index}:${item.sourceAccount}:${item.destination}`} className="border-t border-black/10">{semantics.kind === 'multi_party' && <td className="portable-evidence-address px-2 py-2">{item.sourceAccount}</td>}<td className="portable-evidence-address px-2 py-2">{item.destination}</td><td className="px-2 py-2 font-semibold tabular-nums">{item.amount}</td><td className="portable-evidence-address px-2 py-2">{assetLabel(item.asset)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {claimablePayment && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div><div className="portable-evidence-label">From</div><div className="portable-evidence-address">{inspection.transactionSourceAccount}</div></div>
          <div><div className="portable-evidence-label">Recipient</div><div className="portable-evidence-address">{claimablePayment.recipient}</div></div>
          <div><div className="portable-evidence-label">Recovery account</div><div className="portable-evidence-address">{claimablePayment.recoveryAccount}</div></div>
          <div><div className="portable-evidence-label">Claim window</div><div>{claimablePayment.claimWindowSeconds} seconds</div></div>
          <div><div className="portable-evidence-label">Amount</div><div className="font-semibold tabular-nums">{claimablePayment.amount}</div></div>
          <div><div className="portable-evidence-label">Asset</div><div className="portable-evidence-address">{assetLabel(claimablePayment.asset)}</div></div>
        </div>
      )}
      {(semantics.kind === 'signing_change' || semantics.kind === 'single_operation' || semantics.kind === 'multi_operation') && (
        <div data-operation-details className="mt-3 divide-y divide-black/10 border-y border-black/10">
          {inspection.operations.map((operation) => (
            <div key={operation.index} className="py-3">
              <div className="font-semibold">Operation {operation.index + 1} · {operation.title}</div>
              <div className="mt-1 text-xs text-neutral-500">{operation.summary}</div>
              <div className="mt-2 grid gap-x-5 gap-y-2 sm:grid-cols-2">
                <div><div className="portable-evidence-label">Source</div><div className="portable-evidence-address">{operation.sourceAccount}</div></div>
                {operation.fields.map((field) => <div key={`${operation.index}:${field.label}`}><div className="portable-evidence-label">{field.label}</div><div className={field.mono ? 'portable-evidence-address' : 'text-xs font-semibold'}>{field.value}</div></div>)}
              </div>
            </div>
          ))}
        </div>
      )}
      {memo && <div className="mt-3 border-t border-black/10 pt-3"><div className="portable-evidence-label">Public Stellar memo · {memo.type}</div><div className="portable-evidence-address">{memo.value}</div></div>}
    </section>
  );
}

export default function PortableEvidenceDocument({ record, inspection }: { record: PortableEvidenceRecord; inspection: TransactionXdrInspection }) {
  return (
    <div className="transaction-evidence-portable-document">
      <div className="transaction-evidence-print-brand"><strong>MultiSigTools</strong><span>Portable Stellar transaction evidence</span></div>
      <div className="transaction-evidence-heading">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">FINALIZED RECORD</div>
        <h1 className="mt-1 text-3xl font-bold">Transaction evidence</h1>
        <p>Canonical ledger and audit facts only. Workspace names, personal labels, Address Book data and Private Note plaintext are intentionally excluded.</p>
      </div>
      <div className="transaction-evidence-content space-y-3">
        <section className="transaction-evidence-record overflow-hidden rounded-xl border border-black/10 bg-white">
          <div className="transaction-evidence-record-status grid gap-2 border-b border-black/10 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div><div className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">Status</div><div className="mt-1 text-xl font-bold">{record.submission ? 'Confirmed on Stellar' : 'Recorded proposal'}</div></div>
            <div className="text-sm font-semibold">{record.network === 'public' ? 'Mainnet' : 'Testnet'}</div>
          </div>
          <dl className="transaction-evidence-record-grid grid sm:grid-cols-3">
            <div className="px-5 py-3.5"><dt className="portable-evidence-label">Proposal ID</dt><dd className="mt-1 font-mono font-semibold">{displayRequestId(record.requestId)}</dd></div>
            {record.submission ? <><div className="px-5 py-3.5"><dt className="portable-evidence-label">Ledger</dt><dd className="mt-1 font-mono font-bold">{record.submission.ledger.toLocaleString()}</dd></div><div className="px-5 py-3.5"><dt className="portable-evidence-label">Submitted</dt><dd className="mt-1 tabular-nums">{new Date(record.submission.submittedAt).toLocaleString()}</dd></div></> : <><div className="px-5 py-3.5"><dt className="portable-evidence-label">Created</dt><dd className="mt-1 tabular-nums">{new Date(record.createdAt).toLocaleString()}</dd></div><div className="px-5 py-3.5"><dt className="portable-evidence-label">Signatures</dt><dd className="mt-1 font-semibold">{record.signatureCount}</dd></div></>}
          </dl>
          <div className="transaction-evidence-record-hash border-t border-black/10 px-5 py-3.5"><div className="portable-evidence-label">Transaction hash</div><div className="portable-evidence-address mt-1">{record.transactionHash}</div></div>
        </section>

        <PortableTransactionBody inspection={inspection} />

        <section className="transaction-evidence-signatures">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">Signatures collected</div>
          <h2 className="mt-1 text-xl font-bold">{record.signatureCount} signature{record.signatureCount === 1 ? '' : 's'}</h2>
          <div className="mt-3 space-y-3">
            {record.accounts.map((account) => <div key={account.address} className="transaction-evidence-signature-account border-t border-black/10 pt-3 first:border-t-0 first:pt-0"><div className="portable-evidence-label">Account</div><div className="portable-evidence-address mt-1">{account.address}</div><div className="transaction-evidence-signature-grid mt-2 overflow-hidden rounded border border-black/10">{account.signers.map((signer) => <div key={`${account.address}:${signer.address}`} className="transaction-evidence-signature-card grid gap-1 border-b border-black/10 px-3 py-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto]"><div><div className="portable-evidence-address">{signer.address}</div></div><div className="text-xs font-semibold sm:text-right">{signer.role === 'account_key' ? 'Account key · ' : ''}{signer.decision === 'signed' ? 'Signed' : signer.decision === 'declined' ? 'Declined' : 'No recorded decision'}{signer.weight !== 1 ? ` · approval power ${signer.weight}` : ''}</div></div>)}</div></div>)}
          </div>
        </section>

        <section className="transaction-evidence-history">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">History</div>
          <div className="mt-2 divide-y divide-black/10 border-y border-black/10">{record.history.map((event) => <div key={event.eventId} className="transaction-evidence-history-row grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-2"><div><div className="text-xs font-semibold">{historyTitle(event)}</div></div><time className="whitespace-nowrap text-right text-xs tabular-nums text-neutral-400">{new Date(event.occurredAt).toLocaleString()}</time></div>)}</div>
        </section>
      </div>
      <div className="transaction-evidence-print-footer">MultiSigTools · Proposal {displayRequestId(record.requestId)} · {record.transactionHash}</div>
    </div>
  );
}
