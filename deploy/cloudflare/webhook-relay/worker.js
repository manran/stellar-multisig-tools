const SECRET_PREFIX = 'mrelay_';
const MAX_SKEW_SECONDS = 60;

function base64urlBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function digestBody(body) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function verifyRelayRequest(request, secret) {
  if (!secret?.startsWith(SECRET_PREFIX)) return false;
  const raw = secret.slice(SECRET_PREFIX.length);
  const keyBytes = base64urlBytes(raw);
  if (keyBytes.length !== 32) return false;

  const target = request.headers.get('x-mst-relay-target') ?? '';
  const timestamp = request.headers.get('x-mst-relay-timestamp') ?? '';
  const signature = request.headers.get('x-mst-relay-signature') ?? '';
  if (!/^\d+$/.test(timestamp) || !signature.startsWith('v1=')) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > MAX_SKEW_SECONDS) return false;

  const body = await request.clone().text();
  const digest = await digestBody(body);
  const canonical = `${timestamp}\n${target}\n${digest}`;
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    'HMAC',
    key,
    base64urlBytes(signature.slice(3)),
    new TextEncoder().encode(canonical),
  );
}

function validTarget(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;

  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
    || host.includes(':')
  ) return null;

  return url;
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
    }

    const authenticated = await verifyRelayRequest(request, env.MST_RELAY_SECRET);
    if (!authenticated) return new Response('Unauthorized', { status: 401 });

    const target = validTarget(request.headers.get('x-mst-relay-target') ?? '');
    if (!target) return new Response('Invalid target', { status: 400 });

    const body = await request.text();
    const headers = new Headers();
    for (const name of ['content-type', 'webhook-id', 'webhook-timestamp', 'webhook-signature']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    try {
      const upstream = await fetch(target, {
        method: 'POST',
        headers,
        body,
        redirect: 'manual',
      });
      return new Response(null, {
        status: upstream.status,
        headers: { 'cache-control': 'no-store' },
      });
    } catch {
      return new Response('Relay upstream unavailable', {
        status: 502,
        headers: { 'cache-control': 'no-store' },
      });
    }
  },
};
