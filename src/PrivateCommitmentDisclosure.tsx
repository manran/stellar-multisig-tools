import { useEffect, useState } from 'react';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { privateCommitmentMatchesHash } from './stellar/privateCommitment';
import type { PrivateCommitmentDraft, PrivateCommitmentRecord } from './stellar/privateCommitment';
import type { CreateSigningRequestResponse } from './stellar/requestTypes';
import type { TransactionXdrInspection } from './stellar/transactionXdr';

const REQUEST_ID_LENGTH = 16;
const CAPABILITY_LENGTH = 26;

type PrivateCommitmentView = PrivateCommitmentDraft | PrivateCommitmentRecord;

interface Props {
  inspection: TransactionXdrInspection;
  commitment?: PrivateCommitmentView | null;
  mode?: 'review' | 'history';
  printIncluded?: boolean;
}

function currentRequestLocator(): { id: string; capability: string } | null {
  if (!window.location.pathname.endsWith('/s')) return null;
  const fragment = window.location.hash.slice(1).trim().toUpperCase();
  if (fragment.length !== REQUEST_ID_LENGTH && fragment.length !== REQUEST_ID_LENGTH + CAPABILITY_LENGTH) return null;
  return {
    id: fragment.slice(0, REQUEST_ID_LENGTH),
    capability: fragment.slice(REQUEST_ID_LENGTH),
  };
}

export default function PrivateCommitmentDisclosure({ inspection, commitment: suppliedCommitment, mode = 'review', printIncluded = false }: Props) {
  const [loadedCommitment, setLoadedCommitment] = useState<PrivateCommitmentRecord | null>(null);
  const commitment = suppliedCommitment === undefined ? loadedCommitment : suppliedCommitment;

  useEffect(() => {
    if (suppliedCommitment !== undefined) return;
    if (inspection.memo.type !== 'hash' || typeof inspection.memo.value !== 'string') {
      setLoadedCommitment(null);
      return;
    }
    const locator = currentRequestLocator();
    if (!locator) {
      setLoadedCommitment(null);
      return;
    }
    const controller = new AbortController();
    void fetch('/api/request', {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'X-MultiSig-Request-Id': locator.id,
        ...(locator.capability ? { 'X-MultiSig-Capability': locator.capability } : {}),
      },
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return await response.json() as CreateSigningRequestResponse;
      })
      .then((body) => {
        if (controller.signal.aborted) return;
        setLoadedCommitment(body?.context?.privateCommitment ?? null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadedCommitment(null);
      });
    return () => controller.abort();
  }, [inspection.memo.type, inspection.memo.value, suppliedCommitment]);

  if (!commitment || inspection.memo.type !== 'hash' || typeof inspection.memo.value !== 'string') return null;
  const verified = commitment.hashHex === inspection.memo.value.toLowerCase()
    && privateCommitmentMatchesHash(commitment, inspection.memo.value);

  return (
    <section data-private-memo-print={printIncluded ? 'include' : 'exclude'} className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/5 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-black/5 p-2.5 text-neutral-600 dark:bg-white/10 dark:text-neutral-300"><ShieldCheck className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-semibold">Private memo · on-chain proof</div>
            {verified && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />Verified</span>}
          </div>
          <div className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-black/[0.035] p-4 text-sm leading-6 dark:bg-white/[0.04]">{commitment.text}</div>
          <p className="mt-3 text-xs leading-5 text-neutral-500 dark:text-neutral-400">{mode === 'history' ? 'The private text matches the hash recorded on Stellar.' : 'Only the hash is public on Stellar; this text stays private.'}</p>
          <details className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
            <summary className="cursor-pointer font-semibold">Verification details</summary>
            <p className="mt-2 leading-5">Stellar stores a salted MEMO_HASH. Transaction signatures bind that hash; changing the private text requires a new transaction.</p>
            <div className="mt-2 space-y-1 break-all font-mono">
              <div>v1</div>
              <div>salt {commitment.saltHex}</div>
              <div>hash {commitment.hashHex}</div>
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}
