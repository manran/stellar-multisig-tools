export interface IntegrationWebhookWakePublisher {
  publish(eventId: string): Promise<void>;
}

export async function publishIntegrationWebhookWakeBatch(
  eventIds: readonly string[],
  publisher: IntegrationWebhookWakePublisher,
): Promise<{ published: string[]; failed: Array<{ eventId: string; error: unknown }> }> {
  const published: string[] = [];
  const failed: Array<{ eventId: string; error: unknown }> = [];
  for (const eventId of eventIds) {
    try {
      await publisher.publish(eventId);
      published.push(eventId);
    } catch (error) {
      failed.push({ eventId, error });
    }
  }
  return { published, failed };
}
