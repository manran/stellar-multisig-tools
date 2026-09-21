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
