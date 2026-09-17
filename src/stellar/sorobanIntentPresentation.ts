import type {
  InboxSorobanIntentSnapshot,
  SorobanIntentViewerAction,
} from './sorobanIntentApiTypes.js';

export function intentViewerActionNeedsAction(action: SorobanIntentViewerAction): boolean {
  return action === 'sign' || action === 'route_execution' || action === 'execution_failed' || action === 'attention';
}

export function intentViewerActionPresentation(action: SorobanIntentViewerAction): {
  label: string;
  detail: string;
  cta: string;
  tone: 'warning' | 'success' | 'danger' | 'neutral';
} {
  if (action === 'sign') {
    return {
      label: 'Your signature is needed',
      detail: 'Review the contract action before signing.',
      cta: 'Review & sign',
      tone: 'warning',
    };
  }
  if (action === 'route_execution') {
    return {
      label: 'Choose execution',
      detail: 'Required Soroban authorization is complete. Choose how the final transaction should be executed.',
      cta: 'Choose execution',
      tone: 'success',
    };
  }
  if (action === 'waiting_execution') {
    return {
      label: 'Authorization complete · waiting for execution',
      detail: 'The owning external service controls final execution for this Intent.',
      cta: 'View status',
      tone: 'neutral',
    };
  }
  if (action === 'execution_failed') {
    return {
      label: 'Execution failed on Stellar',
      detail: 'A prepared transaction for this Intent was observed in a ledger but did not succeed.',
      cta: 'Review result',
      tone: 'danger',
    };
  }
  if (action === 'attention') {
    return {
      label: 'Authorization needs review',
      detail: 'This Intent cannot continue normally until the authorization issue is reviewed.',
      cta: 'Review issue',
      tone: 'danger',
    };
  }
  return {
    label: 'Waiting for another signer',
    detail: 'No action is needed from this wallet right now.',
    cta: 'View status',
    tone: 'neutral',
  };
}

export function intentAuthorizationWindowLabel(
  intent: Pick<InboxSorobanIntentSnapshot, 'authorizers' | 'status'>,
): string {
  if (intent.status === 'expired') return 'Authorization expired';
  const expirations = intent.authorizers
    .map((authorizer) => authorizer.expirationLedger)
    .filter((ledger) => Number.isInteger(ledger) && ledger > 0);
  if (expirations.length === 0) return 'Authorization window';
  return `Until ledger ${Math.min(...expirations).toLocaleString()}`;
}
