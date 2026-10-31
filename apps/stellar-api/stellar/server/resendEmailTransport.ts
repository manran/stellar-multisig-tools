import { readFile } from 'node:fs/promises';

export class ResendEmailTransportError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ResendEmailTransportError';
  }
}

export interface ResendEmailSendResult {
  status: number;
  providerMessageId?: string;
}

async function resendApiKey(filePath?: string): Promise<string> {
  const path = filePath?.trim() || process.env.RESEND_API_KEY_FILE?.trim();
  if (!path) {
    throw new ResendEmailTransportError(
      'RESEND_API_KEY_FILE is not configured.',
      'resend_api_key_unavailable',
    );
  }
  let value: string;
  try {
    value = (await readFile(path, 'utf8')).trim();
  } catch {
    throw new ResendEmailTransportError(
      'Unable to read the Resend API key file.',
      'resend_api_key_unavailable',
    );
  }
  if (!value) {
    throw new ResendEmailTransportError(
      'The Resend API key file is empty.',
      'resend_api_key_unavailable',
    );
  }
  return value;
}

export async function sendResendEmail(
  input: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
    idempotencyKey: string;
  },
  dependencies: {
    fetchImpl?: typeof fetch;
    apiKey?: string;
    apiKeyFile?: string;
    timeoutMs?: number;
  } = {},
): Promise<ResendEmailSendResult> {
  const apiKey = dependencies.apiKey ?? await resendApiKey(dependencies.apiKeyFile);
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html,
      tags: [{ name: 'category', value: 'signature_requested' }],
    }),
    signal: AbortSignal.timeout(dependencies.timeoutMs ?? 10_000),
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // HTTP status remains authoritative for retry classification.
  }
  const providerMessageId = body && typeof body === 'object' && 'id' in body
    && typeof body.id === 'string'
    ? body.id
    : undefined;

  if (response.ok && !providerMessageId) {
    throw new ResendEmailTransportError(
      'Resend accepted the request without returning an email id.',
      'resend_invalid_response',
    );
  }

  return {
    status: response.status,
    ...(providerMessageId ? { providerMessageId } : {}),
  };
}
