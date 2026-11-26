import { createHash } from 'node:crypto';

const INPUT_DETAILS: Record<string, { field: string; allowedValues?: readonly (string | number)[]; expectedType?: string }> = {
  invalid_network: { field: 'network', allowedValues: ['public', 'testnet'] },
  invalid_proposal_decision: { field: 'decision', allowedValues: ['decline'] },
  invalid_payment_amount: { field: 'amount', expectedType: 'decimal string' },
  invalid_transaction_lifetime: { field: 'lifetimeSeconds', allowedValues: [3600, 86400, 604800] },
  integration_service_id_required: { field: 'serviceId', expectedType: 'string' },
  invalid_integration_service_id: { field: 'serviceId', expectedType: 'lowercase service identifier' },
  invalid_execution_source: { field: 'executor' },
  executor_required: { field: 'executor' },
  invalid_browser_origin: { field: 'origin' },
};

export function apiErrorBody(cause: { message: string; code: string; name?: string; field?: unknown }) {
  return {
    error: cause.message,
    code: cause.code,
    ...(cause.name === 'RequestBodyError' && typeof cause.field === 'string' && cause.field ? { details: { field: cause.field } } : {}),
  };
}

export function noStoreJson(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  let payload = data;
  if (status === 400 && data && typeof data === 'object' && 'code' in data && typeof data.code === 'string'
    && !('details' in data) && Object.hasOwn(INPUT_DETAILS, data.code)) {
    const details = INPUT_DETAILS[data.code];
    const fixed = process.env.VITE_STELLAR_DEPLOYMENT_NETWORK;
    const network = data.code === 'invalid_network' && (fixed === 'testnet' || fixed === 'public');
    payload = { ...data, ...(network ? { error: 'network must be ' + fixed + ' on this deployment.' } : {}),
      details: { ...details, ...(network ? { allowedValues: [fixed] } : {}) } };
  }
  return Response.json(payload, {
    status,
    headers: {
      ...headers,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export function publicCorsHeaders(methods: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': methods,
  };
}

export function publicCorsJson(
  data: unknown,
  methods: string,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return noStoreJson(data, status, {
    ...headers,
    ...publicCorsHeaders(methods),
  });
}


export function publicDiscoveryJson(request: Request | undefined, data: unknown, methods: string, contentType = 'application/json; charset=utf-8'): Response {
  const payload = JSON.stringify(data);
  const etag = 'W/"' + createHash('sha256').update(payload).digest('hex') + '"';
  const headers = {
    ...publicCorsHeaders(methods),
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=60, must-revalidate',
    'ETag': etag,
    'Access-Control-Expose-Headers': 'ETag, X-Request-Id',
    'Referrer-Policy': 'no-referrer',
  };
  const candidates = request?.headers.get('if-none-match')?.split(',').map(value => value.trim().replace(/^W\//, ''));
  if (candidates?.includes('*') || candidates?.includes(etag.slice(2))) return new Response(null, { status: 304, headers });
  return new Response(request?.method === 'HEAD' ? null : payload, { status: 200, headers });
}
