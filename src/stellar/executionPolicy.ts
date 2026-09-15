export interface ExecutionPolicy {
  mode: 'multisigtools' | 'external';
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
