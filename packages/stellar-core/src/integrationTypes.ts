import type { ServiceCallerProvenance } from './coordinationActorTypes.js';

/** Identifies the owning external integration. This is workload identity, not Stellar authority. */
export interface ServiceIntegrationContext {
  version: 1;
  serviceId: string;
  serviceLabel?: string;
  correlationId?: string;
}

export type RequestIntegrationContext = ServiceIntegrationContext;
export type SorobanIntentIntegrationContext = ServiceIntegrationContext;

export interface ExternalServiceExecution {
  mode: 'external';
  executor: ServiceCallerProvenance;
}

export interface MultiSigToolsExecution {
  mode: 'multisigtools';
}

export type RequestExecution = ExternalServiceExecution | MultiSigToolsExecution;
