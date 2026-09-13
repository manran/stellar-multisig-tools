import type { ThresholdAuthorizationSummary, ThresholdLevel } from './types.js';

export function humanAuthorizationLevelLabel(level: ThresholdLevel): string {
  if (level === 'low') return 'Limited account actions';
  if (level === 'medium') return 'Standard transactions';
  return 'Core account control';
}

export function humanAuthorizationRequirement(summary: ThresholdAuthorizationSummary): string {
  if (!summary.reachable) return 'Authorization unreachable';
  if (summary.exactNOfM) return `${summary.exactNOfM.required} of ${summary.exactNOfM.total} approvals`;
  return `${summary.threshold} approval power required · ${summary.totalActiveWeight} available`;
}

export function approvalPowerLabel(value: number): string {
  return value <= 0 ? 'No approval power' : `Approval power ${value}`;
}
