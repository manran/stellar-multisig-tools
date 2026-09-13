import type { InboxSorobanPreparationSnapshot, SorobanPreparationViewerAction } from './sorobanPreparationTypes.js';

export function preparationViewerActionNeedsAction(action: SorobanPreparationViewerAction): boolean {
  return action === 'authorize' || action === 'freeze';
}

export function preparationViewerActionPresentation(action: SorobanPreparationViewerAction): {
  label: string;
  detail: string;
  cta: string;
  tone: 'warning' | 'success' | 'neutral';
} {
  if (action === 'authorize') {
    return {
      label: 'Contract authorization needed',
      detail: 'Review the contract call and authorize it with this signer.',
      cta: 'Review & authorize',
      tone: 'warning',
    };
  }
  if (action === 'freeze') {
    return {
      label: 'Ready for transaction signing',
      detail: 'Contract authorization is complete. Start the immutable transaction Proposal.',
      cta: 'Continue to signing',
      tone: 'success',
    };
  }
  return {
    label: 'Waiting for another signer',
    detail: 'No action is needed from this wallet right now.',
    cta: 'View status',
    tone: 'neutral',
  };
}

export function preparationDeadlineLabel(preparation: Pick<InboxSorobanPreparationSnapshot, 'expiresAt'>): string {
  const expires = Date.parse(preparation.expiresAt);
  if (!Number.isFinite(expires)) return 'Contract authorization window';
  const minutes = Math.max(0, Math.round((expires - Date.now()) / 60_000));
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h left`;
  return `${Math.round(hours / 24)}d left`;
}
