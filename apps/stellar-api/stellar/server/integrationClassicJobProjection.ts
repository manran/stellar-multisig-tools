import { stellarWebOrigin } from '../../../../packages/stellar-core/src/deploymentOrigins.js';
import type { IntegrationClassicJobProjection, SigningRequestSnapshot } from '../../../../packages/stellar-core/src/requestTypes.js';

export function projectIntegrationClassicJob(request: SigningRequestSnapshot, externalReference?: string): IntegrationClassicJobProjection {
  const external = request.execution?.mode === 'external';
  const outcome = request.executionOutcome?.outcome;
  const final = request.status === 'submitted' || outcome === 'successful' || outcome === 'failed' || outcome === 'not_included';
  const state: IntegrationClassicJobProjection['state'] = request.status === 'submitted' || outcome === 'successful' ? 'completed'
    : outcome === 'failed' ? 'failed'
    : outcome === 'not_included' ? 'expired'
    : external && ['blocked', 'stale', 'expired'].includes(request.status) ? 'execution_unknown'
    : request.status === 'expired' ? 'expired'
    : request.status === 'blocked' || request.status === 'stale' ? 'failed'
    : request.status === 'ready' ? 'ready' : request.status === 'waiting_preconditions' ? 'waiting_preconditions' : 'waiting_for_authorization';
  const actionCalls: IntegrationClassicJobProjection['actionCalls'] = {};
  const nextActions: IntegrationClassicJobProjection['nextActions'] = [];
  if (!final && state === 'ready') {
    nextActions.push('submit_execution');
    actionCalls.submit_execution = external
      ? { transport: 'external_stellar_submission', transactionHash: request.transactionHash }
      : { operationId: 'integration.request.submit' };
  }
  if (external && !final) {
    nextActions.push('reconcile_execution');
    actionCalls.reconcile_execution = { operationId: 'integration.request.execution.reconcile', queryDefaults: { view: 'reconciliation' } };
  }
  const url = new URL('/s', stellarWebOrigin(request.network));
  url.hash = request.id;
  const receipt = request.submission ?? (request.executionOutcome?.observed ? request.executionOutcome.observation : undefined);
  return {
    version: 1, id: request.id, kind: 'classic_transaction', network: request.network, state,
    nextActions, actionCalls, reviewUrl: url.toString(), statusReason: request.statusReason,
    ...(externalReference ? { externalReference } : {}),
    ...(request.executionOutcome ? { executionOutcome: request.executionOutcome } : {}),
    ...(receipt ? { result: { transactionHash: receipt.transactionHash, ledger: receipt.ledger, successful: state === 'completed' } } : {}),
  };
}
