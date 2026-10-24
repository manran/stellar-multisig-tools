export interface ExecutionPolicy {
  mode: 'multisigtools' | 'external';
}

export type SorobanExecutorBindingSource =
  | 'intent'
  | 'service_default'
  | 'contract_policy'
  | 'service_prepare'
  | 'multisigtools_managed';

export interface SorobanExecutorBinding {
  address: string;
  source: SorobanExecutorBindingSource;
}

export interface SorobanExecutionPolicy extends ExecutionPolicy {
  executor?: SorobanExecutorBinding;
  fallback?: 'multisigtools_managed';
}

export type SorobanExecutionRoute =
  | 'current_client'
  | 'handoff'
  | 'multisigtools'
  | 'external_service';

export function sorobanExecutionRoutes(
  policy?: ExecutionPolicy,
): readonly SorobanExecutionRoute[] {
  if (policy?.mode === 'external') return ['external_service'];
  if (policy?.mode === 'multisigtools') return ['multisigtools'];
  return ['current_client', 'handoff', 'multisigtools'];
}
