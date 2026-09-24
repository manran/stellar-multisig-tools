import { blobAuthStore } from '../server/blobAuthStore.js';
import { authConfigForRequest } from '../server/authConfig.js';
import { getOrCreateAuthServerKeypair } from '../server/authService.js';

function quoteToml(value: string): string {
  return JSON.stringify(value);
}

export async function GET(request: Request): Promise<Response> {
  const config = authConfigForRequest(request);
  const signingKey = (await getOrCreateAuthServerKeypair(blobAuthStore)).publicKey();
  const endpoint = config.issuer;
  const body = [
    'VERSION="2.7.0"',
    `WEB_AUTH_ENDPOINT=${quoteToml(endpoint)}`,
    `SIGNING_KEY=${quoteToml(signingKey)}`,
    '',
  ].join('\n');

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
