export type HeadlessOperationAccess =
  | 'public'
  | 'principal:read'
  | 'principal:write'
  | 'principal:sign'
  | 'integration:read'
  | 'integration:write'
  | 'browser:read'
  | 'browser:sign'
  | 'human';

export type HeadlessOperationEffect =
  | 'none'
  | 'private-state'
  | 'coordination-state'
  | 'network-submit';

export interface HeadlessOperationDescriptor {
  id: string;
  version: 1;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  access: HeadlessOperationAccess;
  effect: HeadlessOperationEffect;
  summary: string;
}

export const HEADLESS_OPERATION_CATALOG: readonly HeadlessOperationDescriptor[] = [
  {
    id: 'runtime.config.inspect', version: 1, method: 'GET', path: '/api/runtime-config',
    access: 'public', effect: 'none', summary: 'Read the deployment-owned Stellar network policy.',
  },
  {
    id: 'contract.interface.inspect', version: 1, method: 'GET', path: '/api/contract-interface',
    access: 'public', effect: 'none', summary: 'Resolve the callable interface of one Soroban contract.',
  },
  {
    id: 'contract.intent.create', version: 1, method: 'POST', path: '/api/intent',
    access: 'principal:write', effect: 'coordination-state', summary: 'Create a source-free Soroban Intent and discover its authorization plan.',
  },
  {
    id: 'integration.intent.create', version: 1, method: 'POST', path: '/api/intent',
    access: 'integration:write', effect: 'coordination-state', summary: 'Create a scoped external-service Soroban Intent without granting the service signer authority.',
  },
  {
    id: 'contract.intent.inspect', version: 1, method: 'GET', path: '/api/intent',
    access: 'principal:read', effect: 'none', summary: 'Inspect one Soroban Intent and its live authorization state.',
  },
  {
    id: 'integration.intent.inspect', version: 1, method: 'GET', path: '/api/intent',
    access: 'integration:read', effect: 'none', summary: "Inspect an external service's own Soroban Intent and live authorization state.",
  },
  {
    id: 'integration.intent.browser.inspect', version: 1, method: 'GET', path: '/api/intent',
    access: 'browser:read', effect: 'none', summary: 'Inspect one signer-scoped Browser authorization challenge for an Integration-owned Intent.',
  },
  {
    id: 'contract.intent.contribute', version: 1, method: 'PATCH', path: '/api/intent',
    access: 'principal:sign', effect: 'coordination-state', summary: 'Add one verified detached Soroban authorization signature.',
  },
  {
    id: 'integration.intent.browser.contribute', version: 1, method: 'PATCH', path: '/api/intent',
    access: 'browser:sign', effect: 'coordination-state', summary: 'Submit one signer-scoped Browser signature to the existing Soroban Authorization Core.',
  },
  {
    id: 'contract.intent.execution.prepare', version: 1, method: 'PUT', path: '/api/intent',
    access: 'principal:write', effect: 'none', summary: 'Late-bind an execution source, compare enforcing effects with reviewed evidence, and prepare the final unsigned Soroban transaction.',
  },
  {
    id: 'integration.intent.execution.prepare', version: 1, method: 'PUT', path: '/api/intent',
    access: 'integration:write', effect: 'none', summary: 'Resolve the Integration executor, enforce reviewed effects, and prepare or refresh the final unsigned Soroban execution package.',
  },
  {
    id: 'contract.intent.execution.reconcile', version: 1, method: 'PUT', path: '/api/intent',
    access: 'principal:write', effect: 'coordination-state', summary: 'Independently verify a persisted Soroban execution preparation against Stellar and retain the observed ledger result.',
  },
  {
    id: 'integration.intent.execution.reconcile', version: 1, method: 'PUT', path: '/api/intent',
    access: 'integration:write', effect: 'coordination-state', summary: 'Independently verify an Integration-owned Soroban execution preparation against Stellar and retain the observed ledger result.',
  },
  {
    id: 'contract.intent.replan', version: 1, method: 'PUT', path: '/api/intent',
    access: 'principal:write', effect: 'coordination-state', summary: 'Replace an expired or structurally changed authorization plan with a fresh revision for the same Soroban Intent.',
  },
  {
    id: 'integration.intent.replan', version: 1, method: 'PUT', path: '/api/intent',
    access: 'integration:write', effect: 'coordination-state', summary: "Refresh an external service's own AuthorizationPlan when fresh signer AUTH is required.",
  },
  {
    id: 'contract.intent.cancel', version: 1, method: 'PUT', path: '/api/intent',
    access: 'principal:write', effect: 'coordination-state', summary: 'Cancel a creator-owned Soroban Intent inside MultiSigTools coordination. Detached AUTH or prepared XDR already disclosed outside MultiSigTools is not revoked.',
  },
  {
    id: 'integration.intent.cancel', version: 1, method: 'PUT', path: '/api/intent',
    access: 'integration:write', effect: 'coordination-state', summary: "Cancel an Integration's own Soroban Intent inside MultiSigTools coordination without claiming Stellar-level AUTH revocation.",
  },
  {
    id: 'integration.intent.browser.issue', version: 1, method: 'PUT', path: '/api/intent',
    access: 'integration:write', effect: 'private-state', summary: 'Issue a short-lived signer/origin/current-plan Browser capability for an Integration-owned Intent.',
  },
  {
    id: 'contract.call.build', version: 1, method: 'POST', path: '/api/contract-call',
    access: 'public', effect: 'none', summary: 'Build an unsigned contract-call transaction from typed string inputs.',
  },
  {
    id: 'contract.call.prepare', version: 1, method: 'POST', path: '/api/contract-prepare',
    access: 'public', effect: 'none', summary: 'Record-simulate and assemble current Soroban execution resources and authorization requirements.',
  },
  {
    id: 'contract.workspace.list', version: 1, method: 'GET', path: '/api/contracts',
    access: 'principal:read', effect: 'none', summary: 'List contracts kept by one signer Principal.',
  },
  {
    id: 'contract.workspace.keep', version: 1, method: 'PUT', path: '/api/contracts',
    access: 'principal:write', effect: 'private-state', summary: 'Keep a contract in one signer workspace.',
  },
  {
    id: 'contract.workspace.forget', version: 1, method: 'DELETE', path: '/api/contracts',
    access: 'principal:write', effect: 'private-state', summary: 'Remove a contract from one signer workspace.',
  },
  {
    id: 'classic.payment.prepare', version: 1, method: 'POST', path: '/api/payment-prepare',
    access: 'principal:write', effect: 'none', summary: 'Prepare one exact unsigned Classic payment transaction from business payment inputs and fresh Stellar state.',
  },
  {
    id: 'integration.classic.payment.prepare', version: 1, method: 'POST', path: '/api/payment-prepare',
    access: 'integration:write', effect: 'none', summary: 'Prepare a scoped external-service Classic payment transaction without requiring the service to construct XDR.',
  },
  {
    id: 'classic.account.create.prepare', version: 1, method: 'POST', path: '/api/account-create-prepare',
    access: 'principal:write', effect: 'none', summary: 'Prepare one exact unsigned Classic CreateAccount transaction from explicit account-creation inputs and fresh Stellar state.',
  },
  {
    id: 'integration.classic.account.create.prepare', version: 1, method: 'POST', path: '/api/account-create-prepare',
    access: 'integration:write', effect: 'none', summary: 'Prepare a scoped external-service CreateAccount transaction without silently treating it as Payment.',
  },
  {
    id: 'proposal.create', version: 1, method: 'POST', path: '/api/request',
    access: 'principal:write', effect: 'coordination-state', summary: 'Create a Signing Request from exact transaction XDR.',
  },
  {
    id: 'integration.request.create', version: 1, method: 'POST', path: '/api/request',
    access: 'integration:write', effect: 'coordination-state', summary: 'Create a scoped external-service Classic multisig Request for configured authorization accounts.',
  },
  {
    id: 'proposal.inspect', version: 1, method: 'GET', path: '/api/request',
    access: 'principal:read', effect: 'none', summary: 'Read current Signing Request state and evidence.',
  },
  {
    id: 'integration.request.inspect', version: 1, method: 'GET', path: '/api/request',
    access: 'integration:read', effect: 'none', summary: "Read an external service's own Classic multisig Request and merged authorization evidence.",
  },
  {
    id: 'proposal.contribute', version: 1, method: 'PATCH', path: '/api/request',
    access: 'principal:sign', effect: 'coordination-state', summary: 'Add attributable Stellar authorization to a Signing Request.',
  },
  {
    id: 'proposal.submit', version: 1, method: 'PUT', path: '/api/request',
    access: 'human', effect: 'network-submit', summary: 'Submit an authorized transaction to Stellar after final review.',
  },
] as const;
