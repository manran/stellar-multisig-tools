import { useEffect, useState } from 'react';
import { useStellarWallet } from './StellarWalletContext';
import { isWalletUserRejected } from './stellar/walletKit';
import type { StellarNetwork } from '../../../packages/stellar-core/src/types';
import type { ReusableTemplateSummary } from '../../../packages/stellar-core/src/reusableTemplate';
import { privateSessionAddressHeaders } from '../../../packages/stellar-core/src/privateSessionTransport';

interface TemplateLoad {
  scope: string;
  status: 'loading' | 'ready' | 'error' | 'unlock_required';
  items: ReusableTemplateSummary[];
}

export default function useSavedTemplates(network: StellarNetwork) {
  const { sessionAddress, privateUnlocked, busy, authBusy, unlock } = useStellarWallet();
  const [templateLoad, setTemplateLoad] = useState<TemplateLoad | null>(null);
  const [templateRetry, setTemplateRetry] = useState(0);
  const [templateUnlockError, setTemplateUnlockError] = useState('');
  const templateScope = privateUnlocked && sessionAddress ? sessionAddress + ':' + network : '';
  const currentTemplates = templateScope && templateLoad?.scope === templateScope ? templateLoad : null;
  const templateLoading = Boolean(templateScope && (!currentTemplates || currentTemplates.status === 'loading'));

  useEffect(() => {
    setTemplateUnlockError('');
    if (!templateScope) {
      setTemplateLoad(null);
      return;
    }
    const controller = new AbortController();
    setTemplateLoad({ scope: templateScope, status: 'loading', items: [] });
    void fetch('/api/templates?network=' + network, {
      headers: privateSessionAddressHeaders(sessionAddress),
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          if (!controller.signal.aborted) setTemplateLoad({ scope: templateScope, status: 'unlock_required', items: [] });
          return;
        }
        const body = await response.json() as { address?: string; templates?: ReusableTemplateSummary[] };
        if (!response.ok || !Array.isArray(body.templates)) throw new Error('Unable to load templates.');
        if (controller.signal.aborted) return;
        if (body.address !== sessionAddress || body.templates.some((item) => item.network !== network)) {
          setTemplateLoad({ scope: templateScope, status: 'unlock_required', items: [] });
          return;
        }
        setTemplateLoad({ scope: templateScope, status: 'ready', items: body.templates });
      })
      .catch(() => {
        if (!controller.signal.aborted) setTemplateLoad({ scope: templateScope, status: 'error', items: [] });
      });
    return () => controller.abort();
  }, [templateScope, sessionAddress, network, templateRetry]);

  async function showTemplates() {
    setTemplateUnlockError('');
    try {
      await unlock(undefined, network);
      setTemplateRetry((value) => value + 1);
    } catch (cause) {
      if (!isWalletUserRejected(cause)) {
        setTemplateUnlockError(cause instanceof Error ? cause.message : 'Unable to confirm this wallet. Try again.');
      }
    }
  }

  return {
    sessionAddress, templateScope, currentTemplates, templateLoading,
    templateUnlockError, busy, authBusy, showTemplates,
    retryTemplates: () => setTemplateRetry((value) => value + 1),
  };
}
