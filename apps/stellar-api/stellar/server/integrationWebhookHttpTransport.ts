export interface IntegrationWebhookHttpRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs?: number;
}

export interface IntegrationWebhookHttpResponse {
  status: number;
}

export interface IntegrationWebhookHttpTransport {
  post(request: IntegrationWebhookHttpRequest): Promise<IntegrationWebhookHttpResponse>;
}
