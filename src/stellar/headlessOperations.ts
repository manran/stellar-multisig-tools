export type HeadlessOperationAccess =
  | 'public'
  | 'principal:read'
  | 'principal:write'
  | 'principal:sign'
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
    id: 'contract.intent.inspect', version: 1, method: 'GET', path: '/api/intent',
    access: 'principal:read', effect: 'none', summary: 'Inspect one Soroban Intent and its live authorization state.',
  },
  {
    id: 'contract.intent.contribute', version: 1, method: 'PATCH', path: '/api/intent',
    access: 'principal:sign', effect: 'coordination-state', summary: 'Add one verified detached Soroban authorization signature.',
  },
  {
    id: 'contract.intent.execution.prepare', version: 1, method: 'PUT', path: '/api/intent',
    access: 'principal:write', effect: 'none', summary: 'Late-bind an execution source and prepare the final unsigned Soroban transaction.',
  },
  {
    id: 'contract.intent.replan', version: 1, method: 'PUT', path: '/api/intent',
    access: 'principal:write', effect: 'coordination-state', summary: 'Replace an expired authorization plan with a fresh revision for the same Soroban Intent.',
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
    id: 'proposal.create', version: 1, method: 'POST', path: '/api/request',
    access: 'principal:write', effect: 'coordination-state', summary: 'Create a Signing Request from exact transaction XDR.',
  },
  {
    id: 'proposal.inspect', version: 1, method: 'GET', path: '/api/request',
    access: 'principal:read', effect: 'none', summary: 'Read current Signing Request state and evidence.',
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
