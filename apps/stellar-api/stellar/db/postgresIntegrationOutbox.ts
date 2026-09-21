import type { PoolClient } from 'pg';

export type CoordinationResourceKind = 'classic_request' | 'soroban_intent';

export interface CoordinationOutboxChange {
  serviceId: string;
  resourceKind: CoordinationResourceKind;
  resourceId: string;
  changeKey: string;
  change: string;
  occurredAt: string;
}

export function coordinationOutboxEventId(value: CoordinationOutboxChange): string {
  return `${value.resourceKind}:${value.resourceId}:${value.changeKey}`;
}

export async function enqueueCoordinationChange(
  client: PoolClient,
  value: CoordinationOutboxChange,
): Promise<void> {
  await client.query(
    `INSERT INTO mst_stellar.integration_outbox (
       event_id, service_id, resource_kind, resource_id, event_type,
       payload, created_at, available_at
     ) VALUES ($1, $2, $3, $4, 'coordination.changed', $5, $6, $6)
     ON CONFLICT (event_id) DO NOTHING`,
    [
      coordinationOutboxEventId(value),
      value.serviceId,
      value.resourceKind,
      value.resourceId,
      { version: 1, change: value.change },
      value.occurredAt,
    ],
  );
}
