import { useState } from 'react';
import { ActionButton } from './MultiSigUi';
import { isValidStellarAccountId } from '../../../packages/stellar-core/src/horizon';
import { privateSessionAddressHeaders } from '../../../packages/stellar-core/src/privateSessionTransport';
import type { ReusableTemplateSummary } from '../../../packages/stellar-core/src/reusableTemplate';
import type { StellarNetwork } from '../../../packages/stellar-core/src/types';

export default function TemplateGrantControls({ template, sessionAddress, network }: { template: ReusableTemplateSummary; sessionAddress: string; network: StellarNetwork }) {
  const [address, setAddress] = useState('');
  const [proposers, setProposers] = useState(template.proposerAddresses ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revokeTarget, setRevokeTarget] = useState('');
  if (!sessionAddress || template.ownerAddress !== sessionAddress || template.kind !== 'payment') return null;

  async function update(action: 'grant' | 'revoke', proposerAddress: string) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/templates', {
        method: 'PATCH',
        headers: { ...privateSessionAddressHeaders(sessionAddress), 'Content-Type': 'application/json' },
        body: JSON.stringify({ network, templateId: template.id, proposerAddress, action }),
      });
      const body = await response.json() as { proposerAddresses?: string[]; error?: string };
      if (!response.ok || !Array.isArray(body.proposerAddresses)) throw new Error(body.error || 'Unable to update Template permission.');
      setProposers(body.proposerAddresses);
      if (action === 'grant') setAddress('');
      if (action === 'revoke') setRevokeTarget('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update Template permission.');
    } finally { setBusy(false); }
  }
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer font-semibold text-[var(--color-accent)]">Allow another wallet to request payments</summary>
      <p className="mt-2 leading-6 text-[var(--color-ink-2)]">This wallet can prepare payments from the Template. Treasury signers still approve each transaction.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input aria-label="Proposer G address" value={address} onChange={(event) => setAddress(event.target.value.trim())}
          placeholder="G... wallet address" className="mst-request-control min-w-0 flex-1 font-mono text-xs" />
        <ActionButton type="button" variant="secondary" disabled={!isValidStellarAccountId(address) || address === sessionAddress || busy}
          onClick={() => void update('grant', address)}>Allow</ActionButton>
      </div>
      {proposers.length > 0 && <ul className="mt-3 space-y-2">
        {proposers.map((proposer) => <li key={proposer} className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-2)] px-3 py-1.5 text-xs">
          <span className="min-w-0 flex-1 truncate font-mono" title={proposer}>
            {`${proposer.slice(0, 10)}…${proposer.slice(-8)}`}
          </span>
          {revokeTarget === proposer ? (
            <div className="flex flex-wrap items-center gap-2">
              <ActionButton type="button" variant="danger" size="sm" disabled={busy} onClick={() => void update('revoke', proposer)}>Confirm revoke</ActionButton>
              <ActionButton type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setRevokeTarget('')}>Cancel</ActionButton>
            </div>
          ) : (
            <>
              <button type="button" onClick={() => void navigator.clipboard.writeText(proposer).catch(() => setError('Could not copy this address.'))}
                className="min-h-11 shrink-0 font-semibold text-[var(--color-action)]">Copy</button>
              <button type="button" disabled={busy} onClick={() => setRevokeTarget(proposer)}
                className="min-h-11 shrink-0 font-semibold text-[var(--color-danger)] disabled:opacity-40">Revoke</button>
            </>
          )}
        </li>)}
      </ul>}
      {error && <p role="alert" className="mt-2 text-xs text-[var(--color-danger)]">{error}</p>}
    </details>
  );
}
