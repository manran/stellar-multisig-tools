export type IntegrationWebhookFailureOutcome =
  | { outcome: 'retry'; nextAvailableAt: Date; errorCode: string }
  | { outcome: 'permanent_failure'; errorCode: string };

export type IntegrationWebhookAttemptOutcome =
  | { outcome: 'succeeded' }
  | IntegrationWebhookFailureOutcome;

const RETRY_SECONDS = [5, 30, 120, 600, 3600, 21600, 43200] as const;

export function classifyIntegrationWebhookHttpStatus(
  status: number,
  attempt: number,
  now = new Date(),
): IntegrationWebhookAttemptOutcome {
  if (status >= 200 && status <= 299) return { outcome: 'succeeded' };

  const retryable = status === 408
    || status === 425
    || status === 429
    || (status >= 500 && status <= 599);
  if (!retryable) {
    return { outcome: 'permanent_failure', errorCode: `http_${status}` };
  }

  const delay = RETRY_SECONDS[attempt - 1];
  if (delay === undefined) {
    return { outcome: 'permanent_failure', errorCode: `http_${status}_retry_exhausted` };
  }
  return {
    outcome: 'retry',
    errorCode: `http_${status}`,
    nextAvailableAt: new Date(now.getTime() + delay * 1000),
  };
}

export function classifyIntegrationWebhookTransportFailure(
  errorCode: string,
  attempt: number,
  now = new Date(),
): IntegrationWebhookFailureOutcome {
  const delay = RETRY_SECONDS[attempt - 1];
  if (delay === undefined) {
    return { outcome: 'permanent_failure', errorCode: `${errorCode}_retry_exhausted` };
  }
  return {
    outcome: 'retry',
    errorCode,
    nextAvailableAt: new Date(now.getTime() + delay * 1000),
  };
}
