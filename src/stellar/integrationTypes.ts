import type { AgentActorProvenance } from './agentAccessTypes.js';

export interface ServiceActorProvenance {
  type: 'service';
  id: string;
  label?: string;
}

export type CoordinationActorProvenance = AgentActorProvenance | ServiceActorProvenance;
export type RequestActorProvenance = CoordinationActorProvenance;

export interface ServiceIntegrationContext {
  version: 1;
  serviceId: string;
  serviceLabel?: string;
  executionMode: 'multisigtools' | 'external';
  correlationId?: string;
}

export type RequestIntegrationContext = ServiceIntegrationContext;
export type SorobanIntentIntegrationContext = ServiceIntegrationContext;

export interface ExternalServiceExecution {
  mode: 'external';
  executor: ServiceActorProvenance;
}

export type ExternalRequestExecution = ExternalServiceExecution;
