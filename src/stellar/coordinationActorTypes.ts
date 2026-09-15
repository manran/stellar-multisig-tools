import type { AgentActorProvenance } from './agentAccessTypes.js';

/** Durable provenance for a non-Human machine caller. Never grants chain authority by itself. */
export interface ServiceCallerProvenance {
  type: 'service';
  id: string;
  label?: string;
}

export type MachineCallerProvenance = AgentActorProvenance | ServiceCallerProvenance;
