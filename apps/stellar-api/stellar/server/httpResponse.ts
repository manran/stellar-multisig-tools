import { createHash } from 'node:crypto';

export function noStoreJson(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return Response.json(data, {
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
