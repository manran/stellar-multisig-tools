import { stellarAmountToStroops } from '../../../../src/stellar/reserve.js';
import type { StellarNetworkParameters } from '../../../../src/stellar/horizon.js';
import type { StellarAccountSnapshot, StellarNetwork } from '../../../../src/stellar/types.js';
import { assessClassicManagedChannelCreatorCapacity, type ClassicManagedChannelCreatorCapacity, type ClassicManagedChannelCreatorState } from './classicManagedChannelCapacity.js';
import type { ClassicManagedChannelCreatorMonitorStore } from './classicManagedChannelCreatorMonitorStore.js';

export type ClassicManagedChannelAlertEvent =
  | 'creator.low_balance'
  | 'creator.capacity_exhausted'
  | 'creator.balance_recovered';

export interface ClassicManagedChannelAlert {
  event: ClassicManagedChannelAlertEvent;
  network: StellarNetwork;
  creatorAccount: string;
  nativeBalance: string;
  lowThreshold: string;
  recoveryThreshold: string;
  requiredForNextChannel: string;
}

export type ClassicManagedChannelAlertSender = (alert: ClassicManagedChannelAlert) => Promise<void>;

function alertEvent(
  previous: ClassicManagedChannelCreatorState | null,
  current: ClassicManagedChannelCreatorState,
  previouslyAlerted: boolean,
): ClassicManagedChannelAlertEvent | null {
  if (current === previous) {
    if (!previouslyAlerted && current === 'low') return 'creator.low_balance';
    if (!previouslyAlerted && current === 'insufficient') return 'creator.capacity_exhausted';
    return null;
  }
  if (current === 'insufficient') return 'creator.capacity_exhausted';
  if (current === 'low') return previous === 'insufficient' ? null : 'creator.low_balance';
  if (current === 'ready' && (previous === 'low' || previous === 'insufficient')) return 'creator.balance_recovered';
  return null;
}

export async function sendClassicManagedChannelAlertWebhook(
  alert: ClassicManagedChannelAlert,
  options: {
    url?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<boolean> {
  const rawUrl = options.url ?? process.env.MULTISIG_CLASSIC_CHANNEL_ALERT_WEBHOOK_URL;
  if (!rawUrl?.trim()) return false;
  const url = new URL(rawUrl.trim());
  if (url.protocol !== 'https:') throw new Error('Managed Classic alert webhook must use HTTPS.');
  const text = [
    '[MultiSig Tools]',
    alert.event,
    `network=${alert.network}`,
    `creator=${alert.creatorAccount}`,
    `balance=${alert.nativeBalance} XLM`,
    `low=${alert.lowThreshold} XLM`,
    `recovery=${alert.recoveryThreshold} XLM`,
    `required_next=${alert.requiredForNextChannel} XLM`,
  ].join(' ');
  const response = await (options.fetchImpl ?? fetch)(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
  });
  if (!response.ok) throw new Error(`Managed Classic alert webhook returned HTTP ${response.status}.`);
  return true;
}

export async function observeClassicManagedChannelCreator(
  input: {
    network: StellarNetwork;
    creatorAccount: string;
    account: StellarAccountSnapshot;
    parameters: StellarNetworkParameters;
  },
  options: {
    store?: ClassicManagedChannelCreatorMonitorStore;
    alertSender?: ClassicManagedChannelAlertSender;
    now?: Date;
  } = {},
): Promise<ClassicManagedChannelCreatorCapacity> {
  let previousState: ClassicManagedChannelCreatorState | null = null;
  let previouslyAlerted = false;
  if (options.store) {
    try {
      const previous = await options.store.get(input.network);
      previousState = previous?.state ?? null;
      previouslyAlerted = Boolean(previous?.alertedAt);
    } catch (cause) {
      console.error('Unable to read managed Classic creator monitor state.', cause);
    }
  }

  const capacity = assessClassicManagedChannelCreatorCapacity(input.account, input.parameters, previousState);
  if (!options.store) return capacity;

  const observedAt = (options.now ?? new Date()).toISOString();
  try {
    const transition = await options.store.observe({
      network: input.network,
      state: capacity.state,
      nativeBalanceStroops: stellarAmountToStroops(capacity.nativeBalance),
      observedAt,
    });
    const event = alertEvent(transition.previousState, capacity.state, previouslyAlerted);
    if (event && options.alertSender) {
      try {
        await options.alertSender({
          event,
          network: input.network,
          creatorAccount: input.creatorAccount,
          nativeBalance: capacity.nativeBalance,
          lowThreshold: capacity.lowThreshold,
          recoveryThreshold: capacity.recoveryThreshold,
          requiredForNextChannel: capacity.requiredForNextChannel,
        });
        await options.store.markAlerted(input.network, capacity.state, observedAt);
      } catch (cause) {
        console.error('Managed Classic creator alert delivery failed.', cause);
      }
    }
  } catch (cause) {
    console.error('Unable to update managed Classic creator monitor state.', cause);
  }
  return capacity;
}
